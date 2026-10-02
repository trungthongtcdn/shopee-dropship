import { CancelReceiptStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fetchMessages, type ZaloMessage } from "@/lib/zalo/bridge";
import { extractOrderCodes } from "@/lib/zalo/cancelReceiptDetect";

// ZaloWatchConfig.purpose for this flow — see lib/zalo/poller.ts for the
// other one ("waybill_confirm").
export const CANCEL_RECEIPT_CONFIRM_PURPOSE = "cancel_receipt_confirm";

// Zalo's `ts` is epoch milliseconds per zca-js convention, but the bridge
// doesn't document this explicitly, and in production sends it as a
// numeric STRING rather than a number (e.g. "1790326992116") — confirmed
// by a real crash: new Date("1790326992116") is Invalid Date, since Date's
// string constructor parses that as a date string, not a numeric
// timestamp, while new Date(1790326992116) (the number) works fine. Coerce
// first, always. Guard against a seconds-scale value slipping through
// instead of assuming blindly: ms timestamps for any real date are always
// >= 10^12, second timestamps stay below 10^11 until the year 2286, so
// this threshold cleanly tells the two apart.
export function tsToDate(ts: number | string): Date {
  const numeric = typeof ts === "number" ? ts : Number(ts);
  const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(ms);
}

export interface CancelReceiptMatch {
  codes: string[];
  messageContent: string;
  confirmedByName: string;
  confirmedAt: Date;
}

export interface CancelReceiptPlanResult {
  matches: CancelReceiptMatch[];
  lastMsgId: string | null;
}

// Pure decision logic — no HTTP/DB I/O — so it's unit testable directly
// against a list of messages. Unlike the waybill-confirm flow (poller.ts),
// there's no "pending link, then a separate confirm phrase" state machine
// here: any message naming an order id and/or tracking code IS the
// confirmation, dated to when that message itself was sent (message.ts),
// not processing time — the whole point of this flow is an accurate
// received-date, unlike waybill-confirm where only the day matters and ts's
// unit ambiguity wasn't worth the risk.
//
// `is_self` is NOT skipped, same reasoning as poller.ts: this bridge only
// ever reads, and the operator's own account is usually the one logged in.
export function planCancelReceiptMessages(messages: ZaloMessage[]): CancelReceiptPlanResult {
  const matches: CancelReceiptMatch[] = [];
  let lastMsgId: string | null = null;

  for (const message of messages) {
    lastMsgId = message.msg_id;

    // Non-text messages (stickers, images, system notices) come through
    // with non-string content — the bridge passes raw Zalo payloads
    // through uncoerced. Skip rather than crash the whole cycle (this was
    // the actual production bug: one non-text message in the batch threw
    // and aborted the loop, so nothing after it — including real
    // cancel-receipt confirmations — ever got applied, silently, forever,
    // since lastProcessedMsgId also never advanced past it).
    if (typeof message.content !== "string") continue;

    const codes = extractOrderCodes(message.content);
    if (codes.length === 0) continue;

    matches.push({
      codes,
      messageContent: message.content,
      confirmedByName: message.from_name,
      confirmedAt: tsToDate(message.ts),
    });
  }

  return { matches, lastMsgId };
}

export interface ApplyCancelReceiptCodesParams {
  codes: string[];
  messageContent: string;
  confirmedByName: string | null;
  confirmedAt: Date;
  threadId: string;
  // Optional because every existing caller (the Zalo group flow) means one
  // thing only: the group message itself IS the "received it" confirmation,
  // always received_full. The manual barcode-scan entry point is the only
  // caller that lets staff pick a different status (e.g. received_partial).
  cancelReceiptStatus?: CancelReceiptStatus;
  // Optional for the same reason: only the manual barcode-scan flow lets
  // staff record a "% hỏng" alongside the receipt confirmation. Omitted
  // entirely by the Zalo group flow, which must never touch this column.
  defectRate?: number | null;
}

export interface ApplyCancelReceiptCodesResult {
  matchedCount: number;
}

// Matches by shopeeOrderId OR trackingCode (a message can name either), and
// updateMany naturally covers every line of a multi-line order regardless
// of which of the two matched — same effect as receiving the whole package
// back. Simpler than applyCancelReceiptPayload's (lib/sync/apply.ts)
// ambiguous-tracking-code guard: that one exists because a sheet row only
// ever supplies a tracking code, so a collision is silent; here staff can
// (and are told to) include the order id too, and matching by either code
// directly is unambiguous per code.
//
// For a "trả hàng hoàn tiền" order, the physical package staff actually
// receives is labeled with Cancellation.returnTrackingCode, NOT the
// order's own (outbound) trackingCode — those are two different codes. A
// scan/message naming only the return code would otherwise match zero
// orders (confirmed in production: SPXVN060152102809 never matched order
// 260918CPKS97XC). Resolve it to a shopeeOrderId first, same cross-table
// pattern as loadReportRows.ts's return-tracking-code search.
export async function applyCancelReceiptCodes(
  params: ApplyCancelReceiptCodesParams
): Promise<ApplyCancelReceiptCodesResult> {
  const { codes, messageContent, confirmedByName, confirmedAt, threadId, cancelReceiptStatus = "received_full", defectRate } = params;

  const returnTrackingMatches = await prisma.cancellation.findMany({
    where: { isActive: true, returnTrackingCode: { in: codes } },
    select: { shopeeOrderId: true },
  });
  const returnMatchedOrderIds = [...new Set(returnTrackingMatches.map((c) => c.shopeeOrderId))];

  const result = await prisma.order.updateMany({
    where: {
      isActive: true,
      OR: [
        { shopeeOrderId: { in: codes } },
        { trackingCode: { in: codes } },
        ...(returnMatchedOrderIds.length > 0 ? [{ shopeeOrderId: { in: returnMatchedOrderIds } }] : []),
      ],
    },
    data: {
      cancelReceiptStatus,
      cancelReceivedAt: confirmedAt,
      ...(defectRate !== undefined ? { defectRate } : {}),
    },
  });

  await prisma.zaloCancelReceiptLog.create({
    data: {
      threadId,
      messageContent,
      codes,
      matchedCount: result.count,
      confirmedByName,
      confirmedAt,
    },
  });

  return { matchedCount: result.count };
}

export interface CancelReceiptPollCycleResult {
  processed: number;
  matched: number;
}

export async function runCancelReceiptPollCycle(): Promise<CancelReceiptPollCycleResult | null> {
  const config = await prisma.zaloWatchConfig.findUnique({ where: { purpose: CANCEL_RECEIPT_CONFIRM_PURPOSE } });
  if (!config) return null;

  const messages = await fetchMessages(config.threadId, config.threadType as "user" | "group", config.lastProcessedMsgId);
  if (messages.length === 0) return { processed: 0, matched: 0 };

  const { matches, lastMsgId } = planCancelReceiptMessages(messages);

  let matchedTotal = 0;
  for (const match of matches) {
    const { matchedCount } = await applyCancelReceiptCodes({ ...match, threadId: config.threadId });
    matchedTotal += matchedCount;
  }

  await prisma.zaloWatchConfig.update({
    where: { purpose: CANCEL_RECEIPT_CONFIRM_PURPOSE },
    data: { lastProcessedMsgId: lastMsgId ?? config.lastProcessedMsgId },
  });

  return { processed: messages.length, matched: matchedTotal };
}

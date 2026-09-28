import { prisma } from "@/lib/db";
import { fetchMessages, type ZaloMessage } from "@/lib/zalo/bridge";
import { extractOrderCodes } from "@/lib/zalo/cancelReceiptDetect";

// ZaloWatchConfig.purpose for this flow — see lib/zalo/poller.ts for the
// other one ("waybill_confirm").
export const CANCEL_RECEIPT_CONFIRM_PURPOSE = "cancel_receipt_confirm";

// Zalo's `ts` is epoch milliseconds per zca-js convention, but the bridge
// doesn't document this explicitly. Guard against a seconds-scale value
// slipping through instead of assuming blindly: ms timestamps for any real
// date are always >= 10^12, second timestamps stay below 10^11 until the
// year 2286, so this threshold cleanly tells the two apart.
export function tsToDate(ts: number): Date {
  const ms = ts < 10_000_000_000 ? ts * 1000 : ts;
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
export async function applyCancelReceiptCodes(
  params: ApplyCancelReceiptCodesParams
): Promise<ApplyCancelReceiptCodesResult> {
  const { codes, messageContent, confirmedByName, confirmedAt, threadId } = params;

  const result = await prisma.order.updateMany({
    where: {
      isActive: true,
      OR: [{ shopeeOrderId: { in: codes } }, { trackingCode: { in: codes } }],
    },
    data: { cancelReceiptStatus: "received_full", cancelReceivedAt: confirmedAt },
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

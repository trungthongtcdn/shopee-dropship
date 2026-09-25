import { prisma } from "@/lib/db";
import { fetchMessages, type ZaloMessage } from "@/lib/zalo/bridge";
import { findPdfUrl, isConfirmationMessage } from "@/lib/zalo/detect";
import { downloadAndExtractOrderIds } from "@/lib/zalo/parseWaybill";

export interface PollState {
  pendingPdfUrl: string | null;
  pendingPdfMsgId: string | null;
}

export interface ConfirmationEvent {
  pdfUrl: string;
  confirmedByName: string;
  confirmedAt: number;
}

export interface PlanResult {
  state: PollState;
  confirmations: ConfirmationEvent[];
  lastMsgId: string | null;
}

// Pure decision logic — no HTTP/DB/PDF I/O — so the confirmation matching
// rules can be unit tested directly against a list of messages. Messages
// are assumed oldest-first (matches the bridge's since_msg_id cursor
// semantics: "messages after this id", i.e. forward in time).
//
// There is no reply-chain info from the bridge, so a PDF link message just
// becomes "the pending link" for the thread; the next confirmation-phrase
// message resolves it. A second PDF link before a confirmation replaces the
// pending one — only the most recent unconfirmed link is tracked.
//
// `is_self` messages are NOT skipped: this bridge only ever reads (see
// lib/zalo/bridge.ts — fetchMessages/searchGroups, no send capability), so
// is_self never means "a message our own bot posted". In real deployments
// the bridge is logged into the operator's own personal Zalo account (the
// same one they use to send the waybill link and type "đã đóng"), so
// skipping is_self would silently ignore every message from the one person
// actually running this workflow.
export function planFromMessages(messages: ZaloMessage[], initialState: PollState): PlanResult {
  let state: PollState = { ...initialState };
  const confirmations: ConfirmationEvent[] = [];
  let lastMsgId: string | null = null;

  for (const message of messages) {
    lastMsgId = message.msg_id;

    const pdfUrl = findPdfUrl(message.content);
    if (pdfUrl) {
      state = { pendingPdfUrl: pdfUrl, pendingPdfMsgId: message.msg_id };
      continue;
    }

    if (state.pendingPdfUrl && isConfirmationMessage(message.content)) {
      confirmations.push({ pdfUrl: state.pendingPdfUrl, confirmedByName: message.from_name, confirmedAt: message.ts });
      state = { pendingPdfUrl: null, pendingPdfMsgId: null };
    }
  }

  return { state, confirmations, lastMsgId };
}

export interface PollCycleResult {
  processed: number;
  confirmed: number;
}

export interface ApplyWaybillConfirmationParams {
  orderIds: string[];
  confirmedAt: Date;
  confirmedByName: string | null;
  pdfUrl: string;
  threadId: string;
}

export interface ApplyWaybillConfirmationResult {
  matchedCount: number;
}

// Shared by the automatic Zalo poller below and the manual-entry API route
// (app/api/zalo/manual-confirm) — same effect either way: mark the given
// orders sent as of confirmedAt, and log what happened. The manual route
// exists because the bridge's /messages endpoint is a forward-only live
// buffer (see lib/zalo/bridge.ts) that can miss messages, so staff need a
// way to paste/upload the waybill PDF directly when that happens.
export async function applyWaybillConfirmation(
  params: ApplyWaybillConfirmationParams
): Promise<ApplyWaybillConfirmationResult> {
  const { orderIds, confirmedAt, confirmedByName, pdfUrl, threadId } = params;

  const result = await prisma.order.updateMany({
    where: { shopeeOrderId: { in: orderIds } },
    data: { sendStatus: "sent", sentAt: confirmedAt },
  });

  await prisma.zaloConfirmationLog.create({
    data: { threadId, pdfUrl, orderIds, matchedCount: result.count, confirmedByName, confirmedAt },
  });

  return { matchedCount: result.count };
}

export async function runPollCycle(): Promise<PollCycleResult | null> {
  const config = await prisma.zaloWatchConfig.findUnique({ where: { id: 1 } });
  if (!config) return null;

  const messages = await fetchMessages(config.threadId, config.threadType as "user" | "group", config.lastProcessedMsgId);
  if (messages.length === 0) return { processed: 0, confirmed: 0 };

  const { state, confirmations, lastMsgId } = planFromMessages(messages, {
    pendingPdfUrl: config.pendingPdfUrl,
    pendingPdfMsgId: config.pendingPdfMsgId,
  });

  let confirmedCount = 0;
  for (const confirmation of confirmations) {
    const orderIds = await downloadAndExtractOrderIds(confirmation.pdfUrl);
    if (orderIds.length === 0) continue;

    // Uses processing time, not the message's own `ts` — the bridge API
    // doesn't document ts's unit (seconds vs ms), and getting that wrong
    // would write a wildly incorrect sentAt onto real orders. The poller
    // runs every ~20s, so "now" is close enough for a date-level field.
    const confirmedAt = new Date();

    await applyWaybillConfirmation({
      orderIds,
      confirmedAt,
      confirmedByName: confirmation.confirmedByName,
      pdfUrl: confirmation.pdfUrl,
      threadId: config.threadId,
    });
    confirmedCount += 1;
  }

  await prisma.zaloWatchConfig.update({
    where: { id: 1 },
    data: {
      lastProcessedMsgId: lastMsgId ?? config.lastProcessedMsgId,
      pendingPdfUrl: state.pendingPdfUrl,
      pendingPdfMsgId: state.pendingPdfMsgId,
    },
  });

  return { processed: messages.length, confirmed: confirmedCount };
}

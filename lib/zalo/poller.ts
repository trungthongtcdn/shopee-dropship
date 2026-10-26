import { prisma } from "@/lib/db";
import { fetchMessages, sendGroupMessage, type ZaloMessage } from "@/lib/zalo/bridge";
import { findPdfUrl, isConfirmationMessage } from "@/lib/zalo/detect";
import { isBotMessage } from "@/lib/zalo/botMessage";
import { downloadWaybillPdf, parseWaybillPdf, type ParsedWaybill, type WaybillOrder } from "@/lib/zalo/parseWaybill";
import { sendSortedWaybillPdf, sendWaybillExcel, storeWaybillFiles } from "@/lib/waybill/deliver";
import { tsToDate } from "@/lib/zalo/cancelReceiptPoller";
import { createPollerGuard } from "@/lib/zalo/pollerGuard";
import { assertWaybillSize, MAX_WAYBILL_BYTES, WaybillTooLargeError, megabytes } from "@/lib/zalo/waybillLimits";

// ZaloWatchConfig.purpose for this flow — see lib/zalo/cancelReceiptPoller.ts
// for the other one ("cancel_receipt_confirm").
export const WAYBILL_CONFIRM_PURPOSE = "waybill_confirm";

export interface PollState {
  pendingPdfUrl: string | null;
  pendingPdfMsgId: string | null;
}

export interface ConfirmationEvent {
  pdfUrl: string;
  confirmedByName: string;
  // Raw message.ts, kept for reference only — never turned into a Date
  // here (see the comment above `const confirmedAt = new Date()` further
  // down). Same number|string ambiguity as ZaloMessage.ts.
  confirmedAt: number | string;
}

// A message carrying a waybill PDF link, whether or not anyone ever confirms it.
export interface PdfMessage {
  pdfUrl: string;
  msgId: string;
  ts: number | string;
}

export interface PlanResult {
  state: PollState;
  confirmations: ConfirmationEvent[];
  // Every PDF link seen in this batch — the grouped Excel is posted back for
  // each as soon as it arrives, independently of the "Đã in" confirmation.
  pdfMessages: PdfMessage[];
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
// `is_self` messages are NOT skipped: the bridge is logged into the operator's own
// personal Zalo account (the same one they use to send the waybill link and type "Đã
// in ..."), so skipping is_self would silently ignore every message from the one
// person actually running this workflow. The app's own posts come back as is_self too
// (see botMessage.ts) — those are told apart by their "[Bot]" tag and skipped.
export function planFromMessages(messages: ZaloMessage[], initialState: PollState): PlanResult {
  let state: PollState = { ...initialState };
  const confirmations: ConfirmationEvent[] = [];
  const pdfMessages: PdfMessage[] = [];
  let lastMsgId: string | null = null;

  for (const message of messages) {
    lastMsgId = message.msg_id;

    // Non-text messages (stickers, images, system notices like "đã ghim
    // tin nhắn") come through with non-string content — the bridge passes
    // raw Zalo payloads through uncoerced. Skip rather than crash the cycle.
    if (typeof message.content !== "string") continue;
    // Our own posts (the grouped Excel's caption, warnings…) are never input.
    if (isBotMessage(message.content)) continue;

    const pdfUrl = findPdfUrl(message.content);
    if (pdfUrl) {
      state = { pendingPdfUrl: pdfUrl, pendingPdfMsgId: message.msg_id };
      pdfMessages.push({ pdfUrl, msgId: message.msg_id, ts: message.ts });
      continue;
    }

    if (state.pendingPdfUrl && isConfirmationMessage(message.content)) {
      confirmations.push({ pdfUrl: state.pendingPdfUrl, confirmedByName: message.from_name, confirmedAt: message.ts });
      state = { pendingPdfUrl: null, pendingPdfMsgId: null };
    }
  }

  return { state, confirmations, pdfMessages, lastMsgId };
}

export interface PollCycleResult {
  processed: number;
  confirmed: number;
}

export interface ApplyWaybillConfirmationParams {
  orders: WaybillOrder[];
  confirmedAt: Date;
  confirmedByName: string | null;
  pdfUrl: string;
  threadId: string;
}

export interface ApplyWaybillConfirmationResult {
  matchedCount: number;
  createdCount: number;
  // The zalo_confirmation_logs row just written — the grouped Excel is stored
  // against it.
  logId: number;
}

// Shared by the automatic Zalo poller below and the manual-entry API route
// (app/api/zalo/manual-confirm) — same effect either way: mark the given
// orders sent as of confirmedAt, and log what happened. The manual route
// exists because the bridge's /messages endpoint is a forward-only live
// buffer (see lib/zalo/bridge.ts) that can miss messages, so staff need a
// way to paste/upload the waybill PDF directly when that happens.
//
// An order the PDF names that hasn't synced in from the main Shopee sheet
// yet gets a placeholder row (shopeeOrderId + trackingCode + sendStatus
// "sent" only — categoryName "" since the PDF has no line-item breakdown).
// applyOrdersPayload (lib/sync/apply.ts) replaces it with the real line(s)
// once that order actually syncs in, carrying sendStatus/sentAt (and any
// other operational field set in the meantime) forward first.
export async function applyWaybillConfirmation(
  params: ApplyWaybillConfirmationParams
): Promise<ApplyWaybillConfirmationResult> {
  const { orders, confirmedAt, confirmedByName, pdfUrl, threadId } = params;
  const orderIds = orders.map((order) => order.shopeeOrderId);

  const result = await prisma.order.updateMany({
    where: { shopeeOrderId: { in: orderIds } },
    data: { sendStatus: "sent", sentAt: confirmedAt },
  });

  const existing = await prisma.order.findMany({
    where: { shopeeOrderId: { in: orderIds }, isActive: true },
    select: { shopeeOrderId: true },
  });
  const existingIds = new Set(existing.map((order) => order.shopeeOrderId));
  const seen = new Set<string>();
  const missing = orders.filter((order) => {
    if (existingIds.has(order.shopeeOrderId) || seen.has(order.shopeeOrderId)) return false;
    seen.add(order.shopeeOrderId);
    return true;
  });

  let createdCount = 0;
  for (const order of missing) {
    try {
      await prisma.order.create({
        data: {
          shopeeOrderId: order.shopeeOrderId,
          trackingCode: order.trackingCode,
          categoryName: "",
          status: "Chưa đồng bộ",
          sendStatus: "sent",
          sentAt: confirmedAt,
          isPlaceholder: true,
          rawRowHash: "zalo-placeholder",
          sheetRowIndex: 0,
        },
      });
      createdCount += 1;
    } catch {
      // Duplicate placeholder race (two confirmations naming the same new
      // order back-to-back) — the unique (shopeeOrderId, categoryName)
      // constraint already stopped it, nothing more to do here.
    }
  }

  const log = await prisma.zaloConfirmationLog.create({
    data: {
      threadId,
      pdfUrl,
      orderIds,
      matchedCount: result.count + createdCount,
      confirmedByName,
      confirmedAt,
    },
  });

  return { matchedCount: result.count, createdCount, logId: log.id };
}

// A PDF message older than this is backlog (poller was down, or the watched
// group was just changed and the bridge still buffers the old group's history),
// not something the warehouse is waiting on — posting an Excel for each old one
// would spam the group.
const EXCEL_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// PDF messages whose Excel was already handled. A cycle that fails after posting the file
// (say the DB hiccups while applying the confirmation) leaves the cursor where it was and is
// retried every 20s; without this the same file would be posted on every retry. Claimed BEFORE
// the attempt, so a failing send isn't retried into a flood either. The record lives in a file
// (ZALO_POLLER_STATE_FILE) so it also survives the process being killed mid-cycle: a restart
// reads the same messages again, and re-posting the Excel + PDF on every restart is how the
// group once got the same two files 15 times in 8 minutes.
const guard = createPollerGuard(process.env.ZALO_POLLER_STATE_FILE);
const pdfKey = (threadId: string, msgId: string) => `${threadId}:${msgId}`;

// A confirmation that fails or kills the process this many times is given up on: the cursor
// moves past it, the group is told, and staff confirm by hand (Đóng đơn → nhập tay) — one bad
// file must not hold every shop's Zalo work hostage by restarting the poller forever.
export const MAX_CONFIRM_ATTEMPTS = 3;

function isStalePdfMessage(ts: number | string): boolean {
  const sentAt = tsToDate(ts).getTime();
  // An unreadable timestamp is treated as fresh — the guard is only there to
  // stop backlog floods, not to withhold a file for a parsing quirk.
  return !Number.isNaN(sentAt) && Date.now() - sentAt > EXCEL_MAX_AGE_MS;
}

export async function runPollCycle(): Promise<PollCycleResult | null> {
  const config = await prisma.zaloWatchConfig.findUnique({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
  if (!config) return null;

  const messages = await fetchMessages(config.threadId, config.threadType as "user" | "group", config.lastProcessedMsgId);
  if (messages.length === 0) return { processed: 0, confirmed: 0 };

  const { state, confirmations, pdfMessages, lastMsgId } = planFromMessages(messages, {
    pendingPdfUrl: config.pendingPdfUrl,
    pendingPdfMsgId: config.pendingPdfMsgId,
  });

  // One download + parse per URL per cycle, shared by the Excel/PDF post and the
  // confirmation of the same PDF. `pdf` keeps the downloaded bytes: the
  // re-ordered copy is cut from them.
  const waybills = new Map<string, Promise<ParsedWaybill & { pdf: Buffer }>>();
  const loadWaybill = (url: string) => {
    let waybill = waybills.get(url);
    if (!waybill) {
      waybill = downloadWaybillPdf(url).then(async (pdf) => {
        const parsed = await parseWaybillPdf(pdf);
        assertWaybillSize(parsed);
        return { ...parsed, pdf };
      });
      waybills.set(url, waybill);
    }
    return waybill;
  };

  // Warehouse copies: the same orders regrouped so identical ones sit together —
  // as an Excel list and as the PDF itself with its pages in that order — posted
  // back into the thread as soon as the PDF shows up. Packing starts from these,
  // before (and regardless of whether) anyone types "Đã in". Best effort:
  // nothing here may fail the cycle.
  const thread = { id: config.threadId, type: config.threadType as "user" | "group" };
  // A line in the group, once per `key`. Best effort, and only where the bridge can post text.
  const tellGroup = async (key: string, text: string) => {
    if (thread.type !== "group" || !guard.claim(`notice:${key}`)) return;
    try {
      await sendGroupMessage(thread.id, text);
    } catch (error) {
      console.error("[zalo-poller] could not post the notice:", error);
    }
  };
  const tooLargeNotice = (found: string) =>
    `⚠️ File PDF quá lớn (${found}, bot chỉ xử lý file tối đa ${megabytes(MAX_WAYBILL_BYTES)} và 1000 phiếu) nên bot bỏ qua file này. Vui lòng chia nhỏ file rồi gửi lại.`;

  for (const pdfMessage of pdfMessages) {
    if (!guard.claim(pdfKey(config.threadId, pdfMessage.msgId))) continue;
    if (isStalePdfMessage(pdfMessage.ts)) continue;
    try {
      const { pages, pdf, layout, labelCount } = await loadWaybill(pdfMessage.pdfUrl);
      // One timestamp so the two files share a name stem and pair up visibly.
      const at = new Date();
      await sendWaybillExcel({ pages, at, thread, labelCount });
      const sentPdf = await sendSortedWaybillPdf({ pages, at, sourcePdf: pdf, layout, thread, labelCount });
      if (sentPdf.tooLarge) {
        await tellGroup(
          `pdf-send:${pdfKey(config.threadId, pdfMessage.msgId)}`,
          `⚠️ File PDF đã xếp nặng ${sentPdf.tooLarge}, vượt giới hạn gửi qua Zalo nên bot chỉ gửi được file Excel. Bạn mở trang Đóng đơn để lấy PDF đã xếp.`
        );
      }
    } catch (error) {
      if (error instanceof WaybillTooLargeError) {
        console.error(`[zalo-poller] message ${pdfMessage.msgId} skipped: ${error.message} (${error.found})`);
        await tellGroup(pdfKey(config.threadId, pdfMessage.msgId), tooLargeNotice(error.found));
      } else {
        console.error(`[zalo-poller] grouped Excel for message ${pdfMessage.msgId} failed:`, error);
      }
    }
  }

  let confirmedCount = 0;
  for (const confirmation of confirmations) {
    const key = `confirm:${config.threadId}:${confirmation.pdfUrl}`;
    // Written down before the work starts: a crash inside it (the OOM killer) still counts.
    const attempt = guard.beginAttempt(key);
    if (attempt > MAX_CONFIRM_ATTEMPTS) {
      console.error(`[zalo-poller] giving up on the confirmation for ${confirmation.pdfUrl} after ${attempt - 1} attempts`);
      await tellGroup(
        key,
        "⚠️ Bot không xác nhận được file này (xử lý nhiều lần vẫn lỗi). Vui lòng xác nhận tay ở trang Đóng đơn."
      );
      guard.finishAttempt(key);
      continue;
    }

    let waybill: Awaited<ReturnType<typeof loadWaybill>>;
    try {
      waybill = await loadWaybill(confirmation.pdfUrl);
    } catch (error) {
      if (!(error instanceof WaybillTooLargeError)) throw error;
      console.error(`[zalo-poller] confirmation skipped: ${error.message} (${error.found})`);
      await tellGroup(key, `${tooLargeNotice(error.found)} Đơn của file này chưa được ghi nhận "Đã in", hãy xác nhận tay ở trang Đóng đơn.`);
      guard.finishAttempt(key);
      continue;
    }
    const { orders, pages, pdf, layout, labelCount } = waybill;
    if (orders.length === 0) {
      guard.finishAttempt(key);
      continue;
    }

    // Uses processing time, not the message's own `ts` — the bridge API
    // doesn't document ts's unit (seconds vs ms), and getting that wrong
    // would write a wildly incorrect sentAt onto real orders. The poller
    // runs every ~20s, so "now" is close enough for a date-level field.
    const confirmedAt = new Date();

    const { logId } = await applyWaybillConfirmation({
      orders,
      confirmedAt,
      confirmedByName: confirmation.confirmedByName,
      pdfUrl: confirmation.pdfUrl,
      threadId: config.threadId,
    });
    confirmedCount += 1;

    // Keep the Excel and the re-ordered PDF with the log row for the buttons on
    // the Đóng đơn page. Both were already posted to the group when the PDF
    // arrived, so no second post.
    await storeWaybillFiles({ logId, pages, at: confirmedAt, sourcePdf: pdf, layout, labelCount });
    guard.finishAttempt(key);
  }

  await prisma.zaloWatchConfig.update({
    where: { purpose: WAYBILL_CONFIRM_PURPOSE },
    data: {
      lastProcessedMsgId: lastMsgId ?? config.lastProcessedMsgId,
      pendingPdfUrl: state.pendingPdfUrl,
      pendingPdfMsgId: state.pendingPdfMsgId,
    },
  });

  return { processed: messages.length, confirmed: confirmedCount };
}

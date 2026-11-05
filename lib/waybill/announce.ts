import { currentShopSlug } from "@/lib/shops/context";
import { countHandFill, createDraft, draftUrl, markDraftSent, pruneDrafts, type WaybillDraft } from "./drafts";
import { mapKiot, sendKhoWaybillFiles, sendSortedWaybillPdf, sendWaybillExcel } from "./deliver";
import type { PerPage } from "./compose";
import type { SheetLayout } from "./layout";
import type { WaybillPage } from "./items";

// What the bot does when a waybill PDF shows up in the Zalo group: read the Kiot code, store and
// kho gửi of every order off the price sheet, keep the PDF as a draft the team can edit, and then
//  - post the files (overall Excel + PDF, and one Excel + PDF per kho when the orders are at several
//    kho) with the link to the draft under the Excel — or
//  - when some order's kho gửi is for people to decide (its Kiot codes are in different kho), hold
//    the files back and post only the link, so they are sent once it is filled in.

export interface ZaloThread {
  id: string;
  type: "user" | "group";
}

export interface SendDraftResult {
  excelSent: boolean;
  pdfSent: boolean;
  // Set when the overall PDF is past what the bridge can carry ("20,7 MB").
  tooLarge?: string;
  khoSent: number;
  khoFailed: number;
}

// Posts a draft's files with its edits applied into `thread`. Never throws.
export async function sendDraftFiles(draft: WaybillDraft, pdf: Buffer, thread: ZaloThread, link: string | null, at: Date = new Date(), perPage?: PerPage | null): Promise<SendDraftResult> {
  const common = { pages: draft.pages, at, thread, labelCount: draft.labelCount, sourcePdf: pdf, layout: draft.layout, perPage, overrides: draft.overrides, link };
  const excel = await sendWaybillExcel(common);
  const sortedPdf = await sendSortedWaybillPdf(common);
  const kho = await sendKhoWaybillFiles(common);
  return { excelSent: excel.sent, pdfSent: sortedPdf.sent, ...(sortedPdf.tooLarge ? { tooLarge: sortedPdf.tooLarge } : {}), khoSent: kho.sent, khoFailed: kho.failed };
}

export function holdMessage(blank: number, link: string): string {
  return `⏸ File PDF này có ${blank} đơn chưa có kho gửi (các mã Kiot của đơn nằm ở 2 kho khác nhau). Bot chưa gửi file Excel/PDF. Mở link để chọn kho gửi rồi bấm "Gửi file vào nhóm": ${link}`;
}

export interface AnnounceParams {
  thread: ZaloThread;
  pdfUrl: string;
  pages: WaybillPage[];
  pdf: Buffer;
  layout?: SheetLayout;
  labelCount: number;
  at: Date;
  // Posts a line of text into the group (once per `key`); only called when there is something to tell.
  tell: (key: string, text: string) => Promise<void>;
}

export interface AnnounceResult {
  // True when the files were held back for the team to fill in kho gửi.
  held: boolean;
  draftId: number | null;
  tooLarge?: string;
}

// Never throws: this runs inside the poller cycle, which must not fail over it.
export async function announceWaybill(params: AnnounceParams): Promise<AnnounceResult> {
  const { thread, pdfUrl, pages, pdf, layout, labelCount, at, tell } = params;
  if (pages.length === 0) return { held: false, draftId: null };

  const kiot = await mapKiot(pages);
  let draft: WaybillDraft | null = null;
  try {
    // The same link posted again is the same draft, edits and all (the poller's own record of the
    // messages it answered, not this table, keeps a retried cycle from answering twice).
    const made = await createDraft({ threadId: thread.id, threadType: thread.type, pdfUrl, pdf, pages: kiot.pages, layout, labelCount, khoOptions: kiot.khoOptions });
    draft = made.draft;
    if (made.created) await pruneDrafts().catch(() => undefined);
  } catch (error) {
    console.error("[waybill-draft] could not keep the draft:", error);
  }

  const link = draft ? draftUrl(draft.id, currentShopSlug()) : null;
  const target: WaybillDraft = draft ?? {
    id: 0, threadId: thread.id, threadType: thread.type, pdfUrl, pages: kiot.pages, layout, labelCount, khoOptions: kiot.khoOptions, overrides: new Map(), createdAt: at, sentAt: null,
  };

  // Held back only where the link can be posted (a group) and opened (the site's address is set).
  const waiting = countHandFill(target.pages, target.overrides);
  if (draft && link && thread.type === "group" && waiting > 0) {
    await tell(`draft:${draft.id}`, holdMessage(waiting, link));
    return { held: true, draftId: draft.id };
  }

  const sent = await sendDraftFiles(target, pdf, thread, link, at);
  if (draft) await markDraftSent(draft.id, at).catch(() => undefined);
  return { held: false, draftId: draft?.id ?? null, ...(sent.tooLarge ? { tooLarge: sent.tooLarge } : {}) };
}

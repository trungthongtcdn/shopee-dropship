import { prisma } from "@/lib/db";
import { sendFile } from "@/lib/zalo/bridge";
import { kiotCatalog } from "@/lib/kiot";
import { labelMismatchMessage, type WaybillPage } from "./items";
import type { PerPage } from "./compose";
import type { SheetLayout } from "./layout";
import { NO_KHO_LABEL } from "./khoGiao";
import { buildWaybillFileSet, type KhoFiles, type WaybillFileSet } from "./files";
import { MAX_SEND_BYTES, megabytes } from "@/lib/zalo/waybillLimits";

// Captions the warehouse sees with the files in the Zalo group.
export const WAYBILL_EXCEL_MESSAGE = "Đây là danh sách đơn đã gom các đơn giống nhau đứng gần nhau";
export const WAYBILL_SORTED_PDF_MESSAGE = "Đây là file PDF phiếu gửi hàng đã sắp xếp lại theo đúng thứ tự trong file Excel";

// What goes with a file in the Zalo group: the caption, and under it the warning when the
// PDF has more labels than orders were read (the Excel carries the same line in red).
function captionWith(caption: string, alert: string | null): string {
  return alert ? `${caption}\n⚠️ ${alert}` : caption;
}

// Every entry point below NEVER throws. They run next to flows that must not be
// derailed by a bad PDF layout, Zalo being down or a deleted log row: the Zalo
// poller would otherwise fail its cycle without advancing its cursor and redo
// the same work every 20 seconds, and the manual route has already saved the
// confirmation by the time it gets here.
//
// The Excel and the re-ordered PDF are both derived from the same kho-by-kho group list (see
// files.ts) — the Excel rows and the PDF pages walk the very same groups — so the two can never
// disagree about the order.

// The orders with the Kiot code, Kiot store and kho gửi the price sheet gives each (see kiot.ts).
// Never throws: the codes are an improvement to the files, and a sheet that can't be reached must
// not stop the PDF being sorted.
export async function mapKiot(pages: WaybillPage[]): Promise<{ pages: WaybillPage[]; notices: string[]; khoOptions: string[] }> {
  try {
    const mapped = await kiotCatalog().mapPages(pages);
    return { pages: mapped.pages, notices: mapped.notices, khoOptions: mapped.khoOptions ?? [] };
  } catch (error) {
    console.error("[kiot] mapping the orders failed:", error);
    return { pages, notices: [], khoOptions: [] };
  }
}

export interface FilesParams {
  pages: WaybillPage[];
  at: Date;
  // Labels the PDF holds; more than pages.length raises the red alert.
  labelCount?: number | null;
  // The PDF the pages were read from; the re-ordered copies are made from it.
  sourcePdf?: Buffer;
  // Set when the PDF has several labels tiled on each sheet (see ParsedWaybill).
  layout?: SheetLayout;
  // Labels per A4 sheet wanted for the re-ordered PDF; null/absent keeps the source's layout.
  perPage?: PerPage | null;
  // Edits to the price sheet's kho gửi: order id → kho.
  overrides?: ReadonlyMap<string, string>;
}

async function buildSet(label: string, params: FilesParams, options: { overallPdf: boolean; splitKho: boolean }): Promise<WaybillFileSet | null> {
  if (params.pages.length === 0) return null;
  try {
    return await buildWaybillFileSet({ ...params, ...options });
  } catch (error) {
    console.error(`[waybill-excel] build failed (${label}):`, error);
    return null;
  }
}

export interface StoreWaybillFilesParams extends FilesParams {
  // The zalo_confirmation_logs row these files belong to.
  logId: number;
  // The PDF the pages were read from; the re-ordered copy is made from it.
  sourcePdf: Buffer;
  // Set only for a hand-uploaded PDF, which has no URL to open later — then the
  // original is kept too. A pasted or Zalo link stays reachable at its own URL,
  // so it isn't copied.
  uploadedPdfName?: string;
}

export interface StoreWaybillFilesResult {
  stored: boolean;
  sortedPdfStored: boolean;
}

// Keeps the grouped Excel and the re-ordered PDF (and the original PDF, for an
// upload) in the database so the buttons on the Đóng đơn page can open them
// later. The Excel is the anchor: if it can't be built nothing is stored; if
// only the PDF can't be re-ordered, the Excel is still kept.
export async function storeWaybillFiles(params: StoreWaybillFilesParams): Promise<StoreWaybillFilesResult> {
  const { logId, sourcePdf, uploadedPdfName } = params;
  const set = await buildSet(`log ${logId}`, params, { overallPdf: true, splitKho: false });
  if (!set) return { stored: false, sortedPdfStored: false };

  try {
    const data = {
      xlsxName: set.excel.name,
      xlsxData: set.excel.data,
      pdfName: uploadedPdfName ?? null,
      pdfData: uploadedPdfName ? sourcePdf : null,
      sortedPdfName: set.pdf?.name ?? null,
      sortedPdfData: set.pdf?.data ?? null,
    };
    await prisma.waybillFile.upsert({
      where: { confirmationLogId: logId },
      create: { confirmationLogId: logId, ...data },
      update: data,
    });
    return { stored: true, sortedPdfStored: set.pdf !== null };
  } catch (error) {
    console.error(`[waybill-excel] storing failed for log ${logId}:`, error);
    return { stored: false, sortedPdfStored: false };
  }
}

interface ZaloThread {
  id: string;
  type: "user" | "group";
}

export interface SendWaybillExcelParams extends FilesParams {
  thread: ZaloThread;
  // The page where the kho gửi can be edited and the files sent again; written under the Excel.
  link?: string | null;
}

// Posts the grouped Excel into the Zalo thread the PDF arrived in.
export async function sendWaybillExcel(params: SendWaybillExcelParams): Promise<{ sent: boolean }> {
  const { thread, link } = params;
  const set = await buildSet(`thread ${thread.id}`, { ...params, sourcePdf: undefined }, { overallPdf: false, splitKho: false });
  if (!set) return { sent: false };

  try {
    const alert = captionWith(WAYBILL_EXCEL_MESSAGE, labelMismatchMessage(params.pages.length, params.labelCount));
    const caption = link ? `${alert}\n🔗 Xem / sửa kho gửi: ${link}` : alert;
    await sendFile(thread.id, thread.type, set.excel.name, set.excel.data, caption);
    return { sent: true };
  } catch (error) {
    console.error(`[waybill-excel] sending to Zalo thread ${thread.id} failed:`, error);
    return { sent: false };
  }
}

export interface SendSortedWaybillPdfParams extends SendWaybillExcelParams {
  sourcePdf: Buffer;
}

// Posts the PDF, its pages re-ordered like the Excel rows, into the same thread.
export async function sendSortedWaybillPdf(params: SendSortedWaybillPdfParams): Promise<{ sent: boolean; tooLarge?: string }> {
  const { thread } = params;
  const set = await buildSet(`thread ${thread.id}`, params, { overallPdf: true, splitKho: false });
  if (!set?.pdf) return { sent: false };
  // One file, one post: past what the bridge can carry it is not even tried (the bridge would
  // answer 413 after the whole upload). The caller says so in the group.
  if (set.pdf.data.length > MAX_SEND_BYTES) {
    console.error(`[waybill-pdf] ${megabytes(set.pdf.data.length)} is over the ${megabytes(MAX_SEND_BYTES)} the bridge can send (thread ${thread.id})`);
    return { sent: false, tooLarge: megabytes(set.pdf.data.length) };
  }

  try {
    const caption = captionWith(WAYBILL_SORTED_PDF_MESSAGE, labelMismatchMessage(params.pages.length, params.labelCount));
    await sendFile(thread.id, thread.type, set.pdf.name, set.pdf.data, caption);
    return { sent: true };
  } catch (error) {
    console.error(`[waybill-pdf] sending to Zalo thread ${thread.id} failed:`, error);
    return { sent: false };
  }
}

export interface SendKhoFilesResult {
  // Files posted, and files that couldn't be (too big, or the bridge refused).
  sent: number;
  failed: number;
}

function khoLabel(file: KhoFiles): string {
  return file.kho === "" ? NO_KHO_LABEL : `kho ${file.kho}`;
}

// Posts each kho's own Excel and PDF into the thread — nothing when every order is at one kho,
// where the overall files are that kho's files. Each file is tried on its own: one that fails
// doesn't stop the others.
export async function sendKhoWaybillFiles(params: SendSortedWaybillPdfParams): Promise<SendKhoFilesResult> {
  const { thread } = params;
  const set = await buildSet(`thread ${thread.id} (per kho)`, params, { overallPdf: false, splitKho: true });
  const result: SendKhoFilesResult = { sent: 0, failed: 0 };
  if (!set) return result;

  const post = async (file: { name: string; data: Buffer }, caption: string) => {
    if (file.data.length > MAX_SEND_BYTES) {
      console.error(`[waybill-pdf] ${file.name}: ${megabytes(file.data.length)} is over what the bridge can send`);
      result.failed += 1;
      return;
    }
    try {
      await sendFile(thread.id, thread.type, file.name, file.data, caption);
      result.sent += 1;
    } catch (error) {
      console.error(`[waybill-excel] sending ${file.name} to Zalo thread ${thread.id} failed:`, error);
      result.failed += 1;
    }
  };

  for (const file of set.perKho) {
    await post(file.excel, `Danh sách đơn ${khoLabel(file)} (${file.orderCount} đơn)`);
    if (file.pdf) await post(file.pdf, `PDF phiếu gửi hàng ${khoLabel(file)} (${file.orderCount} đơn), đúng thứ tự file Excel cùng tên`);
  }
  return result;
}

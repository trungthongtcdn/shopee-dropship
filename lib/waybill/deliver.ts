import { prisma } from "@/lib/db";
import { sendFile } from "@/lib/zalo/bridge";
import { buildWaybillExcel, waybillExcelFileName } from "./excel";
import { groupWaybillPages, orderedPageIndexes, type WaybillPage } from "./items";
import { composeLabelsPdf, type PerPage } from "./compose";
import type { SheetLayout } from "./layout";
import { reorderPdfLabels, reorderPdfPages, waybillSortedPdfFileName } from "./pdf";

// Captions the warehouse sees with the files in the Zalo group.
export const WAYBILL_EXCEL_MESSAGE = "Đây là danh sách đơn đã gom các đơn giống nhau đứng gần nhau";
export const WAYBILL_SORTED_PDF_MESSAGE = "Đây là file PDF phiếu gửi hàng đã sắp xếp lại theo đúng thứ tự trong file Excel";

// Every entry point below NEVER throws. They run next to flows that must not be
// derailed by a bad PDF layout, Zalo being down or a deleted log row: the Zalo
// poller would otherwise fail its cycle without advancing its cursor and redo
// the same work every 20 seconds, and the manual route has already saved the
// confirmation by the time it gets here.
//
// The Excel and the re-ordered PDF are both derived from groupWaybillPages(pages)
// — the Excel rows and the PDF pages walk the very same group list — so the two
// can never disagree about the order.

async function buildExcel(label: string, pages: WaybillPage[], at: Date): Promise<{ xlsx: Buffer; fileName: string } | null> {
  if (pages.length === 0) return null;
  try {
    return { xlsx: await buildWaybillExcel(groupWaybillPages(pages)), fileName: waybillExcelFileName(at) };
  } catch (error) {
    console.error(`[waybill-excel] build failed (${label}):`, error);
    return null;
  }
}

async function buildSortedPdf(
  label: string,
  pages: WaybillPage[],
  sourcePdf: Buffer,
  at: Date,
  layout?: SheetLayout,
  perPage?: PerPage | null
): Promise<{ pdf: Buffer; fileName: string } | null> {
  if (pages.length === 0) return null;
  try {
    const order = orderedPageIndexes(groupWaybillPages(pages));
    // A layout was asked for: N labels per A4 sheet, whatever the source looked like.
    // Otherwise keep the source's own: several labels per sheet move label (cell) by
    // label, one label per page moves whole pages.
    const pdf = perPage
      ? await composeLabelsPdf(sourcePdf, layout ?? null, order, perPage)
      : layout
        ? await reorderPdfLabels(sourcePdf, layout, order)
        : await reorderPdfPages(sourcePdf, order);
    return { pdf, fileName: waybillSortedPdfFileName(at) };
  } catch (error) {
    console.error(`[waybill-pdf] re-ordering failed (${label}):`, error);
    return null;
  }
}

export interface StoreWaybillFilesParams {
  // The zalo_confirmation_logs row these files belong to.
  logId: number;
  pages: WaybillPage[];
  at: Date;
  // The PDF the pages were read from; the re-ordered copy is made from it.
  sourcePdf: Buffer;
  // Set when the PDF has several labels tiled on each sheet (see ParsedWaybill).
  layout?: SheetLayout;
  // Labels per A4 sheet wanted for the re-ordered PDF; null/absent keeps the source's layout.
  perPage?: PerPage | null;
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
  const { logId, pages, at, sourcePdf, uploadedPdfName, layout, perPage } = params;
  const label = `log ${logId}`;

  const excel = await buildExcel(label, pages, at);
  if (!excel) return { stored: false, sortedPdfStored: false };
  const sorted = await buildSortedPdf(label, pages, sourcePdf, at, layout, perPage);

  try {
    const data = {
      xlsxName: excel.fileName,
      xlsxData: excel.xlsx,
      pdfName: uploadedPdfName ?? null,
      pdfData: uploadedPdfName ? sourcePdf : null,
      sortedPdfName: sorted?.fileName ?? null,
      sortedPdfData: sorted?.pdf ?? null,
    };
    await prisma.waybillFile.upsert({
      where: { confirmationLogId: logId },
      create: { confirmationLogId: logId, ...data },
      update: data,
    });
    return { stored: true, sortedPdfStored: sorted !== null };
  } catch (error) {
    console.error(`[waybill-excel] storing failed for ${label}:`, error);
    return { stored: false, sortedPdfStored: false };
  }
}

interface ZaloThread {
  id: string;
  type: "user" | "group";
}

export interface SendWaybillExcelParams {
  pages: WaybillPage[];
  at: Date;
  thread: ZaloThread;
}

// Posts the grouped Excel into the Zalo thread the PDF arrived in.
export async function sendWaybillExcel(params: SendWaybillExcelParams): Promise<{ sent: boolean }> {
  const { pages, at, thread } = params;
  const built = await buildExcel(`thread ${thread.id}`, pages, at);
  if (!built) return { sent: false };

  try {
    await sendFile(thread.id, thread.type, built.fileName, built.xlsx, WAYBILL_EXCEL_MESSAGE);
    return { sent: true };
  } catch (error) {
    console.error(`[waybill-excel] sending to Zalo thread ${thread.id} failed:`, error);
    return { sent: false };
  }
}

export interface SendSortedWaybillPdfParams extends SendWaybillExcelParams {
  sourcePdf: Buffer;
  layout?: SheetLayout;
  perPage?: PerPage | null;
}

// Posts the PDF, its pages re-ordered like the Excel rows, into the same thread.
export async function sendSortedWaybillPdf(params: SendSortedWaybillPdfParams): Promise<{ sent: boolean }> {
  const { pages, at, sourcePdf, thread, layout, perPage } = params;
  const built = await buildSortedPdf(`thread ${thread.id}`, pages, sourcePdf, at, layout, perPage);
  if (!built) return { sent: false };

  try {
    await sendFile(thread.id, thread.type, built.fileName, built.pdf, WAYBILL_SORTED_PDF_MESSAGE);
    return { sent: true };
  } catch (error) {
    console.error(`[waybill-pdf] sending to Zalo thread ${thread.id} failed:`, error);
    return { sent: false };
  }
}

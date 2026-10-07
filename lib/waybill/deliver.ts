import { prisma } from "@/lib/db";
import { sendFile } from "@/lib/zalo/bridge";
import { buildWaybillExcel, waybillExcelFileName } from "./excel";
import { groupWaybillPages, type WaybillPage } from "./items";

// Caption the warehouse sees with the file in the Zalo group.
export const WAYBILL_EXCEL_MESSAGE = "Đây là danh sách đơn đã gom các đơn giống nhau đứng gần nhau";

// Both entry points below NEVER throw. They run next to flows that must not be
// derailed by a bad PDF layout, Zalo being down or a deleted log row: the Zalo
// poller would otherwise fail its cycle without advancing its cursor and redo
// the same work every 20 seconds, and the manual route has already saved the
// confirmation by the time it gets here.

async function buildExcel(label: string, pages: WaybillPage[], at: Date): Promise<{ xlsx: Buffer; fileName: string } | null> {
  if (pages.length === 0) return null;
  try {
    return { xlsx: await buildWaybillExcel(groupWaybillPages(pages)), fileName: waybillExcelFileName(at) };
  } catch (error) {
    console.error(`[waybill-excel] build failed (${label}):`, error);
    return null;
  }
}

export interface StoreWaybillExcelParams {
  // The zalo_confirmation_logs row this file belongs to.
  logId: number;
  pages: WaybillPage[];
  at: Date;
  // Only for a hand-uploaded PDF, which has no URL to open later. A pasted or
  // Zalo link stays reachable at its own URL, so it isn't copied.
  pdf?: { fileName: string; data: Buffer };
}

// Keeps the grouped Excel (and the PDF, if given) in the database so the
// "Xem excel" / "Xem PDF" buttons on the Đóng đơn page can open them later.
export async function storeWaybillExcel(params: StoreWaybillExcelParams): Promise<{ stored: boolean }> {
  const { logId, pages, at, pdf } = params;
  const built = await buildExcel(`log ${logId}`, pages, at);
  if (!built) return { stored: false };

  try {
    const data = {
      xlsxName: built.fileName,
      xlsxData: built.xlsx,
      pdfName: pdf?.fileName ?? null,
      pdfData: pdf?.data ?? null,
    };
    await prisma.waybillFile.upsert({
      where: { confirmationLogId: logId },
      create: { confirmationLogId: logId, ...data },
      update: data,
    });
    return { stored: true };
  } catch (error) {
    console.error(`[waybill-excel] storing failed for log ${logId}:`, error);
    return { stored: false };
  }
}

export interface SendWaybillExcelParams {
  pages: WaybillPage[];
  at: Date;
  thread: { id: string; type: "user" | "group" };
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

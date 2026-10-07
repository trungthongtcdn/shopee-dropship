import { prisma } from "@/lib/db";
import { sendFile } from "@/lib/zalo/bridge";
import { buildWaybillExcel, waybillExcelFileName } from "./excel";
import { groupWaybillPages, type WaybillPage } from "./items";

export interface DeliverWaybillExcelParams {
  // The zalo_confirmation_logs row this file belongs to.
  logId: number;
  pages: WaybillPage[];
  at: Date;
  // Only for a hand-uploaded PDF, which has no URL to open later. A pasted or
  // Zalo link stays reachable at its own URL, so it isn't copied.
  pdf?: { fileName: string; data: Buffer };
  // Where to post the Excel — set for the Zalo flow, omitted for manual entry
  // (staff open it from the Đóng đơn page instead).
  zaloThread?: { id: string; type: "user" | "group" };
}

export interface DeliverWaybillExcelResult {
  stored: boolean;
  sent: boolean;
}

// Builds the grouped Excel, keeps it (and the PDF, if given) in the database,
// and posts it to the Zalo thread. NEVER throws: this runs right after the
// order confirmation has already been applied, so a failure here (bad PDF
// layout, Zalo down, a deleted log row) must not undo that, nor stop the Zalo
// poller from advancing its cursor — it would re-apply the same confirmation
// on every cycle forever. Each stage is isolated: storing doesn't depend on
// Zalo, and a failed send doesn't lose the stored file.
export async function deliverWaybillExcel(params: DeliverWaybillExcelParams): Promise<DeliverWaybillExcelResult> {
  const { logId, pages, at, pdf, zaloThread } = params;
  const result: DeliverWaybillExcelResult = { stored: false, sent: false };
  if (pages.length === 0) return result;

  const groups = groupWaybillPages(pages);
  const fileName = waybillExcelFileName(at);

  let xlsx: Buffer;
  try {
    xlsx = await buildWaybillExcel(groups);
  } catch (error) {
    console.error(`[waybill-excel] build failed for log ${logId}:`, error);
    return result;
  }

  try {
    const data = {
      xlsxName: fileName,
      xlsxData: xlsx,
      pdfName: pdf?.fileName ?? null,
      pdfData: pdf?.data ?? null,
    };
    await prisma.waybillFile.upsert({
      where: { confirmationLogId: logId },
      create: { confirmationLogId: logId, ...data },
      update: data,
    });
    result.stored = true;
  } catch (error) {
    console.error(`[waybill-excel] storing failed for log ${logId}:`, error);
  }

  if (zaloThread) {
    const groupedCount = groups.filter((group) => group.pages.length > 1).length;
    const message =
      `Danh sách ${pages.length} đơn đã gom thành ${groups.length} nhóm` +
      (groupedCount > 0 ? ` (đơn giống nhau đứng cạnh nhau)` : "") +
      ` — file Excel đính kèm.`;
    try {
      await sendFile(zaloThread.id, zaloThread.type, fileName, xlsx, message);
      result.sent = true;
    } catch (error) {
      console.error(`[waybill-excel] sending to Zalo failed for log ${logId}:`, error);
    }
  }

  return result;
}

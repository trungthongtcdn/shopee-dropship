import { NextRequest, NextResponse } from "next/server";
import { downloadWaybillPdf, parseWaybillPdf, type ParsedWaybill } from "@/lib/zalo/parseWaybill";
import { storeWaybillFiles } from "@/lib/waybill/deliver";
import { parsePerPage, type PerPage } from "@/lib/waybill/compose";
import { applyWaybillConfirmation } from "@/lib/zalo/poller";

// Fallback path for when the Zalo bridge doesn't capture the group message
// (its /messages endpoint is a forward-only live buffer, see
// lib/zalo/bridge.ts) — staff paste the waybill link or upload the PDF
// directly, and pick the date/time it was actually sent. Logged under the
// "manual" thread id so it's distinguishable from real Zalo confirmations
// in zalo_confirmation_logs.
const MANUAL_THREAD_ID = "manual";

export async function POST(request: NextRequest) {
  const form = await request.formData();

  const sentAtRaw = form.get("sentAt");
  if (typeof sentAtRaw !== "string" || !sentAtRaw) {
    return NextResponse.json({ error: "sentAt is required" }, { status: 400 });
  }
  const sentAt = new Date(sentAtRaw);
  if (Number.isNaN(sentAt.getTime())) {
    return NextResponse.json({ error: "sentAt is not a valid date" }, { status: 400 });
  }

  // Labels per A4 sheet for the re-ordered PDF kept for the "Xem file" button (2, 4,
  // 6 or 9); empty / "same" keeps the layout of the PDF that was uploaded.
  let perPage: PerPage | null;
  try {
    perPage = parsePerPage(form.get("perPage"));
  } catch {
    return NextResponse.json({ error: "định dạng PDF không hợp lệ (chọn 2, 4, 6 hoặc 9 phiếu mỗi trang)" }, { status: 400 });
  }

  const file = form.get("pdfFile");
  const urlRaw = form.get("pdfUrl");
  const pdfUrl = typeof urlRaw === "string" ? urlRaw.trim() : "";

  let parsed: ParsedWaybill;
  let sourceLabel: string;
  let sourcePdf: Buffer;
  // Only an uploaded file needs keeping as-is: a pasted link can be reopened
  // from its own URL, an upload can't.
  let uploadedPdfName: string | undefined;

  try {
    if (file instanceof File && file.size > 0) {
      sourcePdf = Buffer.from(await file.arrayBuffer());
      parsed = await parseWaybillPdf(sourcePdf);
      sourceLabel = `upload:${file.name}`;
      uploadedPdfName = file.name;
    } else if (pdfUrl) {
      sourcePdf = await downloadWaybillPdf(pdfUrl);
      parsed = await parseWaybillPdf(sourcePdf);
      sourceLabel = pdfUrl;
    } else {
      return NextResponse.json({ error: "cần nhập link PDF hoặc chọn file" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "lỗi khi đọc file PDF" }, { status: 400 });
  }

  const { orders, pages, layout } = parsed;
  if (orders.length === 0) {
    return NextResponse.json({ error: "không tìm thấy mã đơn hàng nào trong file", orderIds: [] }, { status: 422 });
  }

  const { matchedCount, createdCount, logId } = await applyWaybillConfirmation({
    orders,
    confirmedAt: sentAt,
    confirmedByName: "Nhập thủ công",
    pdfUrl: sourceLabel,
    threadId: MANUAL_THREAD_ID,
  });

  // The grouped Excel and the re-ordered PDF for the warehouse; opened later from
  // the "Xem file" column. The file names carry the time they were made, not the
  // (back-datable) sent-at the user typed. Never throws — the confirmation is
  // already saved.
  const { stored: hasExcel, sortedPdfStored: hasSortedPdf } = await storeWaybillFiles({
    logId,
    pages,
    at: new Date(),
    sourcePdf,
    uploadedPdfName,
    layout,
    perPage,
  });

  return NextResponse.json({ orderIds: orders.map((o) => o.shopeeOrderId), matchedCount, createdCount, hasExcel, hasSortedPdf });
}

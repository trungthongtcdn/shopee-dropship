import { NextRequest, NextResponse } from "next/server";
import { downloadAndExtractOrders, extractOrdersFromWaybillPdf, type WaybillOrder } from "@/lib/zalo/parseWaybill";
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

  const file = form.get("pdfFile");
  const urlRaw = form.get("pdfUrl");
  const pdfUrl = typeof urlRaw === "string" ? urlRaw.trim() : "";

  let orders: WaybillOrder[];
  let sourceLabel: string;

  try {
    if (file instanceof File && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      orders = await extractOrdersFromWaybillPdf(buffer);
      sourceLabel = `upload:${file.name}`;
    } else if (pdfUrl) {
      orders = await downloadAndExtractOrders(pdfUrl);
      sourceLabel = pdfUrl;
    } else {
      return NextResponse.json({ error: "cần nhập link PDF hoặc chọn file" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "lỗi khi đọc file PDF" }, { status: 400 });
  }

  if (orders.length === 0) {
    return NextResponse.json({ error: "không tìm thấy mã đơn hàng nào trong file", orderIds: [] }, { status: 422 });
  }

  const { matchedCount, createdCount } = await applyWaybillConfirmation({
    orders,
    confirmedAt: sentAt,
    confirmedByName: "Nhập thủ công",
    pdfUrl: sourceLabel,
    threadId: MANUAL_THREAD_ID,
  });

  return NextResponse.json({ orderIds: orders.map((o) => o.shopeeOrderId), matchedCount, createdCount });
}

import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { parseReportFilters } from "@/lib/report/filters";
import { loadReportRows } from "@/lib/report/loadReportRows";
import { DELIVERY_RESULT_LABELS } from "@/lib/report/deliveryResult";

const SINGLE_KEYS = ["q", "sentFrom", "sentTo", "cancelFrom", "cancelTo", "paidFrom", "paidTo"];
const MULTI_KEYS = ["paymentMatch", "sendStatus", "cancelReceiptStatus", "status", "deliveryResult"];

const SEND_STATUS_LABEL: Record<string, string> = { sent: "Đã gửi", cancelled: "Huỷ" };
const CANCEL_RECEIPT_LABEL: Record<string, string> = {
  received_full: "Đã nhận đủ",
  not_received: "Chưa nhận",
  received_partial: "Nhận thiếu",
  not_needed: "Không cần nhận",
};
const PAYMENT_MATCH_LABEL: Record<string, string> = { matched: "Khớp", not_matched: "Không khớp" };

// En-CA locale formats as yyyy-mm-dd; explicit timeZone avoids the server's
// UTC clock shifting the calendar day near midnight VN time.
function formatDate(value: Date | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatPercent(value: number | null): number | string {
  return value === null ? "" : Number((value * 100).toFixed(1));
}

// Same filters as the Report page (see app/dashboard/report/page.tsx) —
// exports exactly the rows currently on screen, not the whole table.
export async function GET(request: NextRequest) {
  const raw: Record<string, string | string[]> = {};
  for (const key of SINGLE_KEYS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) raw[key] = value;
  }
  for (const key of MULTI_KEYS) {
    const values = request.nextUrl.searchParams.getAll(key);
    if (values.length > 0) raw[key] = values;
  }

  const filters = parseReportFilters(raw);
  const rows = await loadReportRows(filters);

  const data = rows.map((row) => ({
    "Mã đơn hàng": row.shopeeOrderId,
    "Trạng thái": row.status,
    "Kết quả giao thực tế": DELIVERY_RESULT_LABELS[row.deliveryResult],
    "Mã vận đơn": row.trackingCode ?? "",
    "Tên sản phẩm": row.productName ?? "",
    "Tên phân loại": row.categoryName ?? "",
    SL: row.quantity ?? "",
    SKU: row.sku ?? "",
    "Mã Kiot": row.kiotCode ?? "",
    "Giá cần thu về": row.amountDue ?? "",
    "Số tiền thanh toán": row.amountPaid ?? "",
    "Chênh lệch %": formatPercent(row.diffPercent),
    "Đối soát TT": row.paymentMatch ? PAYMENT_MATCH_LABEL[row.paymentMatch] : "",
    "Ngày gửi đơn": formatDate(row.sentAt),
    "Trạng thái đóng đơn": row.sendStatus ? (SEND_STATUS_LABEL[row.sendStatus] ?? row.sendStatus) : "",
    "Ngày đối soát": formatDate(row.paidAt),
    "Ngày nhận đơn huỷ": formatDate(row.cancelReceivedAt),
    "% hỏng": formatPercent(row.defectRate),
    "Trạng thái nhận huỷ": row.cancelReceiptStatus ? (CANCEL_RECEIPT_LABEL[row.cancelReceiptStatus] ?? row.cancelReceiptStatus) : "",
    "Mã vận đơn trả hàng": row.returnTrackingCode ?? "",
    "TT khiếu nại huỷ": row.cancelComplaintNote ?? "",
    "Ghi chú": row.note ?? "",
    "Luân check": row.luanCheck ? "Có" : "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Báo cáo");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `bao-cao-${formatDate(new Date())}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

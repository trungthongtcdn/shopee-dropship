import { prisma } from "@/lib/db";
import { buildReportRows } from "@/lib/report/buildReport";
import { RowEditor } from "./RowEditor";

export const dynamic = "force-dynamic";

function formatAmount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("vi-VN");
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

function formatDate(value: Date | null) {
  return value === null ? "-" : value.toISOString().slice(0, 10);
}

export default async function ReportPage() {
  const [orders, products, latestBatch, cancellations] = await Promise.all([
    prisma.order.findMany({ where: { isActive: true }, orderBy: { shopeeOrderId: "asc" } }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { categoryName: true, sku: true, kiotCode: true, collectPrice: true },
    }),
    prisma.reconciliationBatch.findFirst({ orderBy: { uploadedAt: "desc" } }),
    prisma.cancellation.findMany({
      where: { isActive: true },
      select: { shopeeOrderId: true, cancelledAt: true },
    }),
  ]);

  const results = latestBatch
    ? await prisma.reconciliationResult.findMany({
        where: { batchId: latestBatch.id, shopeeOrderId: { not: null } },
        select: { shopeeOrderId: true, excelAmount: true },
      })
    : [];

  const rows = buildReportRows(
    orders,
    products,
    results.map((result) => ({ shopeeOrderId: result.shopeeOrderId!, excelAmount: result.excelAmount })),
    cancellations
  );

  return (
    <main>
      <h1>Report (LUÂN CẦN)</h1>
      <p>
        Số tiền thanh toán lấy từ batch đối soát gần nhất{latestBatch ? ` (${latestBatch.fileName})` : " — chưa có batch nào"}.
        Chênh lệch quá 2% (cả 2 chiều) tính là không khớp.
      </p>
      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Mã đơn hàng</th>
            <th>Trạng thái</th>
            <th>Mã vận đơn</th>
            <th>Tên sản phẩm</th>
            <th>Tên phân loại</th>
            <th>SL</th>
            <th>SKU</th>
            <th>Mã Kiot</th>
            <th>Giá cần thu về</th>
            <th>Số tiền thanh toán</th>
            <th>Chênh lệch %</th>
            <th>Đối soát thanh toán</th>
            <th>Ngày nhận đơn huỷ</th>
            <th>Thao tác thủ công</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderId}>
              <td>{row.shopeeOrderId}</td>
              <td>{row.status}</td>
              <td>{row.trackingCode ?? "-"}</td>
              <td>{row.productName ?? "-"}</td>
              <td>{row.categoryName ?? "-"}</td>
              <td>{row.quantity ?? "-"}</td>
              <td>{row.sku ?? "-"}</td>
              <td>{row.kiotCode ?? "-"}</td>
              <td>{formatAmount(row.amountDue)}</td>
              <td>{formatAmount(row.amountPaid)}</td>
              <td>{formatPercent(row.diffPercent)}</td>
              <td>{row.paymentMatch === "matched" ? "khớp" : row.paymentMatch === "not_matched" ? "không khớp" : "-"}</td>
              <td>{formatDate(row.cancelReceivedAt)}</td>
              <td>
                <RowEditor
                  orderId={row.orderId}
                  sentAt={row.sentAt?.toISOString() ?? null}
                  sendStatus={row.sendStatus}
                  paidAt={row.paidAt?.toISOString() ?? null}
                  defectRate={row.defectRate}
                  cancelReceiptStatus={row.cancelReceiptStatus}
                  cancelComplaintNote={row.cancelComplaintNote}
                  note={row.note}
                  luanCheck={row.luanCheck}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

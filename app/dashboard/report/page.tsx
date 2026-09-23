import { prisma } from "@/lib/db";
import { buildReportRows } from "@/lib/report/buildReport";
import { RowEditor } from "./RowEditor";
import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";

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

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = parsePage(searchParams.page);

  const [orders, totalCount, products, payments] = await Promise.all([
    prisma.order.findMany({
      where: { isActive: true },
      orderBy: { shopeeOrderId: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where: { isActive: true } }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { categoryName: true, sku: true, kiotCode: true, collectPrice: true },
    }),
    prisma.paymentRecord.findMany({ select: { shopeeOrderId: true, sku: true, amount: true } }),
  ]);
  const totalPages = totalPagesFor(totalCount);

  const rows = buildReportRows(orders, products, payments);

  return (
    <main className="page">
      <h1>Report (LUÂN CẦN)</h1>
      <p className="page-description">
        Số tiền thanh toán đồng bộ tự động từ file thanh toán Shopee trên Drive. Chênh lệch quá 2% (cả 2 chiều) tính là không khớp.
      </p>

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />

      <div className="table-wrap">
        <table className="data-table">
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
              <th>Đối soát TT</th>
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
                <td className="cell-muted">{row.categoryName ?? "-"}</td>
                <td className="num">{row.quantity ?? "-"}</td>
                <td>{row.sku ?? "-"}</td>
                <td className="cell-muted">{row.kiotCode ?? "-"}</td>
                <td className="num">{formatAmount(row.amountDue)}</td>
                <td className="num">{formatAmount(row.amountPaid)}</td>
                <td className="num">{formatPercent(row.diffPercent)}</td>
                <td>
                  {row.paymentMatch === "matched" ? (
                    <span className="badge badge-success">khớp</span>
                  ) : row.paymentMatch === "not_matched" ? (
                    <span className="badge badge-danger">không khớp</span>
                  ) : (
                    <span className="cell-muted">-</span>
                  )}
                </td>
                <td className="cell-muted">{formatDate(row.cancelReceivedAt)}</td>
                <td>
                  <RowEditor
                    orderId={row.orderId}
                    sentAt={row.sentAt?.toISOString() ?? null}
                    sendStatus={row.sendStatus}
                    paidAt={row.paidAt?.toISOString() ?? null}
                    cancelReceivedAt={row.cancelReceivedAt?.toISOString() ?? null}
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
        {rows.length === 0 ? <p className="empty-state">Chưa có dữ liệu.</p> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />
    </main>
  );
}

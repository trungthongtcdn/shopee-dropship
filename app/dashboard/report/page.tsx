import { prisma } from "@/lib/db";
import { buildReportRows } from "@/lib/report/buildReport";
import { RowEditor, LuanCheckToggle } from "./RowEditor";
import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";
import {
  parseReportFilters,
  buildOrderWhere,
  matchesPaymentMatchFilter,
  reportFiltersToSearchParams,
  type ReportFilters,
} from "@/lib/report/filters";

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

function sendStatusBadge(value: string | null) {
  if (value === "sent") return <span className="badge badge-success">đã gửi</span>;
  if (value === "cancelled") return <span className="badge badge-danger">huỷ</span>;
  return <span className="cell-muted">-</span>;
}

function cancelReceiptStatusBadge(value: string | null) {
  if (value === "received_full") return <span className="badge badge-success">đã nhận đủ</span>;
  if (value === "received_partial") return <span className="badge badge-warning">nhận thiếu</span>;
  if (value === "not_received") return <span className="badge badge-danger">chưa nhận</span>;
  return <span className="cell-muted">-</span>;
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { page?: string } & Record<string, string | undefined>;
}) {
  const page = parsePage(searchParams.page);
  const filters = parseReportFilters(searchParams);
  const filterQuery = reportFiltersToSearchParams(filters).toString();
  const buildHref = (p: number) => (filterQuery ? `?${filterQuery}&page=${p}` : `?page=${p}`);

  const [orders, products, payments] = await Promise.all([
    prisma.order.findMany({
      where: buildOrderWhere(filters),
      orderBy: { shopeeOrderId: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { categoryName: true, sku: true, kiotCode: true, collectPrice: true },
    }),
    prisma.paymentRecord.findMany({ select: { shopeeOrderId: true, sku: true, amount: true } }),
  ]);

  const allRows = buildReportRows(orders, products, payments).filter((row) =>
    matchesPaymentMatchFilter(row.paymentMatch, filters.paymentMatch)
  );
  const totalPages = totalPagesFor(allRows.length);
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="page">
      <h1>Report (LUÂN CẦN)</h1>
      <p className="page-description">
        Số tiền thanh toán đồng bộ tự động từ file thanh toán Shopee trên Drive. Chênh lệch quá 2% (cả 2 chiều) tính là không khớp.
      </p>

      <ReportFilterForm filters={filters} />

      <p className="cell-muted" style={{ marginBottom: "var(--space-2)" }}>
        {allRows.length} đơn
      </p>

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />

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
              <th>Ngày gửi đơn</th>
              <th>Trạng thái đóng đơn</th>
              <th>Ngày thanh toán</th>
              <th>Ngày nhận đơn huỷ</th>
              <th>% hỏng</th>
              <th>Trạng thái nhận huỷ</th>
              <th>TT khiếu nại huỷ</th>
              <th>Ghi chú</th>
              <th>Luân check</th>
              <th>Sửa</th>
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
                <td className="cell-muted">{formatDate(row.sentAt)}</td>
                <td>{sendStatusBadge(row.sendStatus)}</td>
                <td className="cell-muted">{formatDate(row.paidAt)}</td>
                <td className="cell-muted">{formatDate(row.cancelReceivedAt)}</td>
                <td className="num">{formatPercent(row.defectRate)}</td>
                <td>{cancelReceiptStatusBadge(row.cancelReceiptStatus)}</td>
                <td className="cell-muted">{row.cancelComplaintNote ?? "-"}</td>
                <td className="cell-muted">{row.note ?? "-"}</td>
                <td>
                  <LuanCheckToggle orderId={row.orderId} luanCheck={row.luanCheck} />
                </td>
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
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="empty-state">Không có đơn nào khớp bộ lọc.</p> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </main>
  );
}

function ReportFilterForm({ filters }: { filters: ReportFilters }) {
  return (
    <form className="toolbar" method="get">
      <div className="field">
        <span className="field-label">Tìm kiếm</span>
        <input
          className="input"
          type="text"
          name="q"
          defaultValue={filters.q}
          placeholder="Mã đơn hàng / mã vận đơn"
          style={{ minWidth: 220 }}
        />
      </div>

      <div className="field">
        <span className="field-label">Đối soát TT</span>
        <select className="select" name="paymentMatch" defaultValue={filters.paymentMatch}>
          <option value="">Tất cả</option>
          <option value="matched">Khớp</option>
          <option value="not_matched">Không khớp</option>
          <option value="none">Chưa đối soát</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">Trạng thái đóng đơn</span>
        <select className="select" name="sendStatus" defaultValue={filters.sendStatus}>
          <option value="">Tất cả</option>
          <option value="sent">Đã gửi</option>
          <option value="cancelled">Huỷ</option>
          <option value="none">Chưa đóng đơn</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">Trạng thái nhận huỷ</span>
        <select className="select" name="cancelReceiptStatus" defaultValue={filters.cancelReceiptStatus}>
          <option value="">Tất cả</option>
          <option value="received_full">Đã nhận đủ</option>
          <option value="not_received">Chưa nhận</option>
          <option value="received_partial">Nhận thiếu</option>
          <option value="none">Chưa có</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">Ngày gửi đơn</span>
        <div style={{ display: "flex", gap: 4 }}>
          <input className="input" type="date" name="sentFrom" defaultValue={filters.sentFrom} />
          <input className="input" type="date" name="sentTo" defaultValue={filters.sentTo} />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Ngày nhận đơn huỷ</span>
        <div style={{ display: "flex", gap: 4 }}>
          <input className="input" type="date" name="cancelFrom" defaultValue={filters.cancelFrom} />
          <input className="input" type="date" name="cancelTo" defaultValue={filters.cancelTo} />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Ngày thanh toán</span>
        <div style={{ display: "flex", gap: 4 }}>
          <input className="input" type="date" name="paidFrom" defaultValue={filters.paidFrom} />
          <input className="input" type="date" name="paidTo" defaultValue={filters.paidTo} />
        </div>
      </div>

      <div className="field" style={{ flexDirection: "row", gap: "var(--space-2)" }}>
        <button type="submit" className="btn btn-primary btn-sm">
          Lọc
        </button>
        <a href="/dashboard/report" className="btn btn-secondary btn-sm">
          Xoá lọc
        </a>
      </div>
    </form>
  );
}

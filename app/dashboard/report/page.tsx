import { RowEditor, LuanCheckToggle } from "./RowEditor";
import { FilterDropdown } from "../FilterDropdown";
import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";
import {
  parseReportFilters,
  reportFiltersToSearchParams,
  SEND_STATUS_FILTER_OPTIONS,
  CANCEL_RECEIPT_FILTER_OPTIONS,
  PAYMENT_MATCH_FILTER_OPTIONS,
  type ReportFilters,
} from "@/lib/report/filters";
import { loadReportRows, loadOrderStatusFilterOptions, type StatusFilterOption } from "@/lib/report/loadReportRows";
import { DELIVERY_RESULT_LABELS, DELIVERY_RESULT_VALUES, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

function formatAmount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("vi-VN");
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

const formatDate = formatDateVN;

function sendStatusBadge(value: string | null) {
  if (value === "sent") return <span className="badge badge-success">đã gửi</span>;
  if (value === "cancelled") return <span className="badge badge-danger">huỷ</span>;
  return <span className="cell-muted">-</span>;
}

function cancelReceiptStatusBadge(value: string | null) {
  if (value === "received_full") return <span className="badge badge-success">đã nhận đủ</span>;
  if (value === "received_partial") return <span className="badge badge-warning">nhận thiếu</span>;
  if (value === "not_received") return <span className="badge badge-danger">chưa nhận</span>;
  if (value === "not_needed") return <span className="badge">không cần nhận</span>;
  return <span className="cell-muted">-</span>;
}

// Only "giao thất bại" và "trả hàng hoàn tiền" count as a real outcome worth
// flagging here — "delivered" và "cancelled" đều để trống theo yêu cầu.
function deliveryResultBadge(result: DeliveryResult) {
  if (result !== "delivery_failed" && result !== "returned_refunded") return <span className="cell-muted">-</span>;
  const className = result === "delivery_failed" ? "badge badge-danger" : "badge badge-warning";
  return <span className={className}>{DELIVERY_RESULT_LABELS[result]}</span>;
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { page?: string } & Record<string, string | string[] | undefined>;
}) {
  const page = parsePage(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const filters = parseReportFilters(searchParams);
  const filterQuery = reportFiltersToSearchParams(filters).toString();
  const buildHref = (p: number) => (filterQuery ? `?${filterQuery}&page=${p}` : `?page=${p}`);
  const exportHref = filterQuery ? `/api/report/export?${filterQuery}` : "/api/report/export";

  const [allRows, orderStatusOptions] = await Promise.all([loadReportRows(filters), loadOrderStatusFilterOptions()]);
  const totalPages = totalPagesFor(allRows.length);
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="page">
      <h1>Report (LUÂN CẦN)</h1>
      <p className="page-description">
        Số tiền thanh toán đồng bộ tự động từ file thanh toán Shopee trên Drive. Chênh lệch quá 2% (cả 2 chiều) tính là không khớp.
      </p>

      <ReportFilterForm filters={filters} orderStatusOptions={orderStatusOptions} />

      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <p className="cell-muted" style={{ margin: 0 }}>
          {allRows.length} đơn
        </p>
        <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
        <a className="btn btn-secondary btn-sm" href={exportHref}>
          Xuất Excel
        </a>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ngày tạo đơn</th>
              <th>Mã đơn hàng</th>
              <th>Mã vận đơn</th>
              <th>Tên sản phẩm</th>
              <th>Tên phân loại</th>
              <th>SL</th>
              <th>SKU</th>
              <th>Mã Kiot</th>
              <th>Giá cần thu về</th>
              <th>Số tiền thanh toán</th>
              <th>Chênh lệch %</th>
              <th>Trạng thái</th>
              <th>Kết quả giao thực tế</th>
              <th>Đối soát TT</th>
              <th>Ngày gửi đơn</th>
              <th>Trạng thái đóng đơn</th>
              <th>Ngày đối soát</th>
              <th>Ngày nhận đơn huỷ</th>
              <th>% hỏng</th>
              <th>Trạng thái nhận huỷ</th>
              <th>Mã vận đơn trả hàng</th>
              <th>TT khiếu nại huỷ</th>
              <th>Ghi chú</th>
              <th>Luân check</th>
              <th>Sửa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.orderId}>
                <td className="cell-muted">{formatDate(row.orderDate)}</td>
                <td>{row.shopeeOrderId}</td>
                <td>{row.trackingCode ?? "-"}</td>
                <td className="cell-truncate" title={row.productName ?? "-"}>
                  {row.productName ?? "-"}
                </td>
                <td className="cell-muted">{row.categoryName ?? "-"}</td>
                <td className="num">{row.quantity ?? "-"}</td>
                <td>{row.sku ?? "-"}</td>
                <td className="cell-muted">{row.kiotCode ?? "-"}</td>
                <td className="num">{formatAmount(row.amountDue)}</td>
                <td className="num">{formatAmount(row.amountPaid)}</td>
                <td className="num">{formatPercent(row.diffPercent)}</td>
                <td className="cell-truncate" title={row.status}>
                  {row.status}
                </td>
                <td>{deliveryResultBadge(row.deliveryResult)}</td>
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
                <td>{row.returnTrackingCode ?? "-"}</td>
                <td className="cell-muted cell-truncate" title={row.cancelComplaintNote ?? "-"}>
                  {row.cancelComplaintNote ?? "-"}
                </td>
                <td className="cell-muted cell-truncate" title={row.note ?? "-"}>
                  {row.note ?? "-"}
                </td>
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
                    paidAmountOverride={row.paidAmountOverride}
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

const SEND_STATUS_LABELS: Record<(typeof SEND_STATUS_FILTER_OPTIONS)[number], string> = {
  sent: "Đã gửi",
  cancelled: "Huỷ",
  none: "Chưa đóng đơn",
};

const CANCEL_RECEIPT_LABELS: Record<(typeof CANCEL_RECEIPT_FILTER_OPTIONS)[number], string> = {
  received_full: "Đã nhận đủ",
  not_received: "Chưa nhận",
  received_partial: "Nhận thiếu",
  not_needed: "Không cần nhận",
  none: "Chưa có",
};

const PAYMENT_MATCH_LABELS: Record<(typeof PAYMENT_MATCH_FILTER_OPTIONS)[number], string> = {
  matched: "Khớp",
  not_matched: "Không khớp",
  none: "Chưa đối soát",
};

function ReportFilterForm({
  filters,
  orderStatusOptions,
}: {
  filters: ReportFilters;
  orderStatusOptions: StatusFilterOption[];
}) {
  const dropdownFieldStyle = { width: 170 };

  return (
    <form method="get">
      <div className="toolbar" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <span className="field-label">Tìm kiếm</span>
          <input
            className="input"
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder="Mã đơn hàng / mã vận đơn / mã vận đơn hoàn"
            style={{ minWidth: 200 }}
          />
        </div>

        <div className="field" style={dropdownFieldStyle}>
          <span className="field-label">Trạng thái đơn</span>
          <FilterDropdown name="status" label="Trạng thái đơn" options={orderStatusOptions} selected={filters.status} />
        </div>

        <div className="field" style={dropdownFieldStyle}>
          <span className="field-label">Đối soát TT</span>
          <FilterDropdown
            name="paymentMatch"
            label="Đối soát TT"
            options={PAYMENT_MATCH_FILTER_OPTIONS.map((value) => ({ value, label: PAYMENT_MATCH_LABELS[value] }))}
            selected={filters.paymentMatch}
          />
        </div>

        <div className="field" style={dropdownFieldStyle}>
          <span className="field-label">Trạng thái đóng đơn</span>
          <FilterDropdown
            name="sendStatus"
            label="Trạng thái đóng đơn"
            options={SEND_STATUS_FILTER_OPTIONS.map((value) => ({ value, label: SEND_STATUS_LABELS[value] }))}
            selected={filters.sendStatus}
          />
        </div>

        <div className="field" style={dropdownFieldStyle}>
          <span className="field-label">Trạng thái nhận huỷ</span>
          <FilterDropdown
            name="cancelReceiptStatus"
            label="Trạng thái nhận huỷ"
            options={CANCEL_RECEIPT_FILTER_OPTIONS.map((value) => ({ value, label: CANCEL_RECEIPT_LABELS[value] }))}
            selected={filters.cancelReceiptStatus}
          />
        </div>

        <div className="field" style={dropdownFieldStyle}>
          <span className="field-label">Kết quả giao thực tế</span>
          <FilterDropdown
            name="deliveryResult"
            label="Kết quả giao thực tế"
            options={DELIVERY_RESULT_VALUES.map((value) => ({ value, label: DELIVERY_RESULT_LABELS[value] }))}
            selected={filters.deliveryResult}
          />
        </div>
      </div>

      <div className="toolbar" style={{ alignItems: "flex-end" }}>
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
          <span className="field-label">Ngày đối soát</span>
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
      </div>
    </form>
  );
}

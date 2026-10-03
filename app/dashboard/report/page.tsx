import { ReportTableRow, type ReportRowDisplay } from "./ReportTableRow";
import type { RowEditorProps } from "./RowEditor";
import { ColumnVisibilityMenu } from "./ColumnVisibilityMenu";
import { FilterDropdown } from "../FilterDropdown";
import { DateRangeDropdown } from "../DateRangeDropdown";
import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import {
  parseReportFilters,
  reportFiltersToSearchParams,
  SEND_STATUS_FILTER_OPTIONS,
  CANCEL_RECEIPT_FILTER_OPTIONS,
  PAYMENT_MATCH_FILTER_OPTIONS,
  STATUS_OTHER_VALUE,
  type ReportFilters,
} from "@/lib/report/filters";
import { loadReportRows, loadOrderStatusFilterOptions, type StatusFilterOption } from "@/lib/report/loadReportRows";
import { DELIVERY_RESULT_LABELS, DELIVERY_RESULT_VALUES, type DeliveryResult } from "@/lib/report/deliveryResult";
import type { ReportRow } from "@/lib/report/buildReport";
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

function paymentMatchBadge(value: ReportRow["paymentMatch"]) {
  if (value === "matched") return <span className="badge badge-success">khớp</span>;
  if (value === "not_matched") return <span className="badge badge-danger">không khớp</span>;
  return <span className="cell-muted">-</span>;
}

// Only "giao thất bại" và "trả hàng hoàn tiền" count as a real outcome worth
// flagging here — "delivered" và "cancelled" đều để trống theo yêu cầu.
function deliveryResultLine(result: DeliveryResult) {
  if (result !== "delivery_failed" && result !== "returned_refunded") return null;
  const className = result === "delivery_failed" ? "badge badge-danger" : "badge badge-warning";
  return (
    <span className="cell-sub">
      Thực tế: <span className={className}>{DELIVERY_RESULT_LABELS[result]}</span>
    </span>
  );
}

function toReportRowDisplay(row: ReportRow): ReportRowDisplay {
  return {
    shopeeOrderId: row.shopeeOrderId,
    orderMeta: `${formatDate(row.orderDate)} · ${row.trackingCode ?? "-"}`,
    productName: row.productName ?? "-",
    categoryMeta: `${row.categoryName ?? "-"} · SL ${row.quantity ?? "-"}`,
    sku: row.sku ?? "-",
    kiotCode: row.kiotCode ?? "-",
    amountDueLabel: formatAmount(row.amountDue),
    amountPaidLabel: formatAmount(row.amountPaid),
    paymentMatchBadge: paymentMatchBadge(row.paymentMatch),
    diffPercentLabel: formatPercent(row.diffPercent),
    paidAtLabel: formatDate(row.paidAt),
    status: row.status,
    deliveryResultLine: deliveryResultLine(row.deliveryResult),
    sendStatusBadge: sendStatusBadge(row.sendStatus),
    sentAtLabel: formatDate(row.sentAt),
    cancelReceiptStatusBadge: cancelReceiptStatusBadge(row.cancelReceiptStatus),
    cancelReceivedAtLabel: formatDate(row.cancelReceivedAt),
    returnTrackingCode: row.returnTrackingCode ?? "-",
    defectRateLabel: formatPercent(row.defectRate),
    note: row.note ?? "-",
    cancelComplaintNote: row.cancelComplaintNote ?? "-",
  };
}

function toEditableProps(row: ReportRow): RowEditorProps {
  return {
    orderId: row.orderId,
    sentAt: row.sentAt?.toISOString() ?? null,
    sendStatus: row.sendStatus,
    paidAt: row.paidAt?.toISOString() ?? null,
    cancelReceivedAt: row.cancelReceivedAt?.toISOString() ?? null,
    defectRate: row.defectRate,
    cancelReceiptStatus: row.cancelReceiptStatus,
    cancelComplaintNote: row.cancelComplaintNote,
    note: row.note,
    paidAmountOverride: row.paidAmountOverride,
    shopeeOrderId: row.shopeeOrderId,
    productMeta: "",
    amountSummary: "",
    paymentMatchBadge: null,
  };
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: { page?: string } & Record<string, string | string[] | undefined>;
}) {
  const page = parsePage(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const pageSize = parsePageSize(Array.isArray(searchParams.pageSize) ? searchParams.pageSize[0] : searchParams.pageSize);
  const filters = parseReportFilters(searchParams);
  const filterQuery = reportFiltersToSearchParams(filters).toString();
  const exportHref = filterQuery ? `/api/report/export?${filterQuery}` : "/api/report/export";

  const [allRows, orderStatusOptions] = await Promise.all([loadReportRows(filters), loadOrderStatusFilterOptions()]);
  const totalPages = totalPagesFor(allRows.length, pageSize);
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <main className="page">
      <h1>Report (LUÂN CẦN)</h1>

      <QuickFilterBar filters={filters} pageSize={pageSize} />
      <ActiveFilterChips filters={filters} pageSize={pageSize} orderStatusOptions={orderStatusOptions} />

      <ReportFilterForm filters={filters} orderStatusOptions={orderStatusOptions} />

      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <p className="cell-muted" style={{ margin: 0 }}>
          {allRows.length} đơn
        </p>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={allRows.length}
          baseQuery={filterQuery}
        />
        <a className="btn btn-secondary btn-sm" href={exportHref}>
          Xuất Excel
        </a>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Luân check</th>
              <th className="col-order">Đơn hàng</th>
              <th className="col-product">Sản phẩm</th>
              <th className="col-sku">SKU · Mã Kiot</th>
              <th className="col-amount">Cần thu / Đã TT</th>
              <th className="col-match">Đối soát TT</th>
              <th className="col-paidAt">Ngày đối soát</th>
              <th className="col-status">Trạng thái đơn</th>
              <th className="col-send">Đóng đơn</th>
              <th className="col-cancel">Nhận huỷ · VĐ trả hàng</th>
              <th className="col-defect">% hỏng</th>
              <th className="col-note">Ghi chú · Khiếu nại huỷ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ReportTableRow
                key={row.orderId}
                luanCheck={row.luanCheck}
                display={toReportRowDisplay(row)}
                editable={toEditableProps(row)}
              />
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="empty-state">Không có đơn nào khớp bộ lọc.</p> : null}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalCount={allRows.length}
        baseQuery={filterQuery}
      />
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

// The 5 quick-filter cards each control only these 4 dimensions, leaving
// search/status-dropdown/date-ranges untouched — they're a shortcut layered
// on top of the detailed filter bar below, not a full reset of it.
function quickFilterHref(
  filters: ReportFilters,
  pageSize: number,
  overrides: Partial<Pick<ReportFilters, "paymentMatch" | "sendStatus" | "cancelReceiptStatus" | "luanCheck">>
) {
  const next: ReportFilters = {
    ...filters,
    paymentMatch: [],
    sendStatus: [],
    cancelReceiptStatus: [],
    luanCheck: false,
    ...overrides,
  };
  const qs = reportFiltersToSearchParams(next).toString();
  return qs ? `?${qs}&pageSize=${pageSize}` : `?pageSize=${pageSize}`;
}

function QuickFilterBar({ filters, pageSize }: { filters: ReportFilters; pageSize: number }) {
  const quickClear = filters.paymentMatch.length === 0 && filters.sendStatus.length === 0 && filters.cancelReceiptStatus.length === 0;
  const cards = [
    { label: "Tất cả đơn", active: quickClear && !filters.luanCheck, href: quickFilterHref(filters, pageSize, {}) },
    {
      label: "Không khớp thanh toán",
      active: quickClear === false && filters.paymentMatch.length === 1 && filters.paymentMatch[0] === "not_matched",
      href: quickFilterHref(filters, pageSize, { paymentMatch: ["not_matched"] }),
    },
    {
      label: "Chưa đóng đơn",
      active: filters.sendStatus.length === 1 && filters.sendStatus[0] === "none",
      href: quickFilterHref(filters, pageSize, { sendStatus: ["none"] }),
    },
    {
      label: "Chờ nhận hàng huỷ",
      active: filters.cancelReceiptStatus.length === 1 && filters.cancelReceiptStatus[0] === "not_received",
      href: quickFilterHref(filters, pageSize, { cancelReceiptStatus: ["not_received"] }),
    },
    {
      label: "Chưa Luân check",
      active: filters.luanCheck,
      href: quickFilterHref(filters, pageSize, { luanCheck: true }),
    },
  ];

  return (
    <div className="toolbar">
      {cards.map((card) => (
        <a key={card.label} className={`filter-pill${card.active ? " active" : ""}`} href={card.href}>
          {card.label}
        </a>
      ))}
    </div>
  );
}

interface Chip {
  key: string;
  label: string;
  href: string;
}

function ActiveFilterChips({
  filters,
  pageSize,
  orderStatusOptions,
}: {
  filters: ReportFilters;
  pageSize: number;
  orderStatusOptions: StatusFilterOption[];
}) {
  const hrefFor = (patch: Partial<ReportFilters>) => {
    const qs = reportFiltersToSearchParams({ ...filters, ...patch }).toString();
    return qs ? `?${qs}&pageSize=${pageSize}` : `?pageSize=${pageSize}`;
  };
  const statusLabel = (value: string) =>
    value === STATUS_OTHER_VALUE ? "Khác" : orderStatusOptions.find((o) => o.value === value)?.label ?? value;

  const chips: Chip[] = [];

  if (filters.q) chips.push({ key: "q", label: `Tìm: "${filters.q}"`, href: hrefFor({ q: "" }) });

  for (const value of filters.status) {
    chips.push({
      key: `status-${value}`,
      label: `Trạng thái: ${statusLabel(value)}`,
      href: hrefFor({ status: filters.status.filter((v) => v !== value) }),
    });
  }
  for (const value of filters.paymentMatch) {
    chips.push({
      key: `paymentMatch-${value}`,
      label: `Đối soát TT: ${PAYMENT_MATCH_LABELS[value as keyof typeof PAYMENT_MATCH_LABELS]}`,
      href: hrefFor({ paymentMatch: filters.paymentMatch.filter((v) => v !== value) }),
    });
  }
  for (const value of filters.sendStatus) {
    chips.push({
      key: `sendStatus-${value}`,
      label: `Đóng đơn: ${SEND_STATUS_LABELS[value as keyof typeof SEND_STATUS_LABELS]}`,
      href: hrefFor({ sendStatus: filters.sendStatus.filter((v) => v !== value) }),
    });
  }
  for (const value of filters.cancelReceiptStatus) {
    chips.push({
      key: `cancelReceiptStatus-${value}`,
      label: `Nhận huỷ: ${CANCEL_RECEIPT_LABELS[value as keyof typeof CANCEL_RECEIPT_LABELS]}`,
      href: hrefFor({ cancelReceiptStatus: filters.cancelReceiptStatus.filter((v) => v !== value) }),
    });
  }
  for (const value of filters.deliveryResult) {
    chips.push({
      key: `deliveryResult-${value}`,
      label: `Kết quả giao: ${DELIVERY_RESULT_LABELS[value as DeliveryResult]}`,
      href: hrefFor({ deliveryResult: filters.deliveryResult.filter((v) => v !== value) }),
    });
  }
  if (filters.luanCheck) {
    chips.push({ key: "luanCheck", label: "Chưa Luân check", href: hrefFor({ luanCheck: false }) });
  }
  if (filters.sentFrom || filters.sentTo) {
    chips.push({
      key: "sent-range",
      label: `Ngày gửi: ${filters.sentFrom || "…"} – ${filters.sentTo || "…"}`,
      href: hrefFor({ sentFrom: "", sentTo: "" }),
    });
  }
  if (filters.cancelFrom || filters.cancelTo) {
    chips.push({
      key: "cancel-range",
      label: `Ngày nhận huỷ: ${filters.cancelFrom || "…"} – ${filters.cancelTo || "…"}`,
      href: hrefFor({ cancelFrom: "", cancelTo: "" }),
    });
  }
  if (filters.paidFrom || filters.paidTo) {
    chips.push({
      key: "paid-range",
      label: `Ngày đối soát: ${filters.paidFrom || "…"} – ${filters.paidTo || "…"}`,
      href: hrefFor({ paidFrom: "", paidTo: "" }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="toolbar">
      {chips.map((chip) => (
        <a key={chip.key} className="filter-pill active" href={chip.href}>
          {chip.label} ×
        </a>
      ))}
      <a href="/dashboard/report" className="filter-pill">
        Xoá tất cả
      </a>
    </div>
  );
}

function ReportFilterForm({
  filters,
  orderStatusOptions,
}: {
  filters: ReportFilters;
  orderStatusOptions: StatusFilterOption[];
}) {
  const dropdownFieldStyle = { width: 170 };
  const sentCount = filters.sentFrom || filters.sentTo ? 1 : 0;
  const cancelCount = filters.cancelFrom || filters.cancelTo ? 1 : 0;
  const paidCount = filters.paidFrom || filters.paidTo ? 1 : 0;

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

        <div className="field">
          <span className="field-label">Khoảng ngày</span>
          <DateRangeDropdown label="Khoảng ngày" count={sentCount + cancelCount + paidCount}>
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
          </DateRangeDropdown>
        </div>

        <div className="field" style={{ flexDirection: "row", gap: "var(--space-2)" }}>
          <button type="submit" className="btn btn-primary btn-sm">
            Lọc
          </button>
          <a href="/dashboard/report" className="btn btn-secondary btn-sm">
            Xoá lọc
          </a>
          <ColumnVisibilityMenu />
        </div>
      </div>
    </form>
  );
}

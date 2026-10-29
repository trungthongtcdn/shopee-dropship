import { prisma } from "@/lib/db";
import { FilterDropdown } from "../FilterDropdown";
import { Pagination } from "../Pagination";
import { ZaloGroupPicker } from "../ZaloGroupPicker";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import { HoanHuyRow, type HoanHuySummary, type HoanHuyDetails } from "./HoanHuyRow";
import { loadOverdueWarnings } from "@/lib/cancellation/overdueWarnings";
import { loadCancellationRows, parseCancellationFilters, showsCancelledOrders } from "@/lib/cancellation/loadCancellationRows";
import { RECEIPT_LABELS, loadReceiptStatuses } from "@/lib/cancellation/receiptStatus";
import {
  NO_VALUE,
  matchesReceiptFilter,
  matchesRefundStatusFilter,
  parseOverdueFilter,
  parseReceiptRefundFilters,
  refundStatusOptions,
} from "@/lib/cancellation/hoanHuyFilters";
import { allReturnTrackingCodes } from "@/lib/cancellation/returnTrackingCodes";
import { currentShopSlug } from "@/lib/shops/context";
import { DELIVERY_RESULT_LABELS, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN, formatDateTimeVN } from "@/lib/format/datetime";
import { OVERDUE_WARNING_PURPOSE } from "@/lib/zalo/overdueWarningPoller";
import type { Cancellation, CancelReceiptStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const formatDate = formatDateVN;

function formatAmount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("vi-VN");
}

function typeLabel(type: string) {
  return DELIVERY_RESULT_LABELS[type as DeliveryResult] ?? type;
}

function typeClassName(type: string) {
  return type === "returned_refunded" ? "badge badge-warning" : "badge badge-danger";
}

// "Phản hồi trước" deadline: đỏ nếu còn dưới 24h, vàng nếu còn dưới 48h,
// còn lại hiện như text thường (không phải cảnh báo gấp).
function respondByClassName(respondByAt: Date | null): string {
  if (!respondByAt) return "cell-muted";
  const hoursLeft = (respondByAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft < 24) return "badge badge-danger";
  if (hoursLeft < 48) return "badge badge-warning";
  return "cell-muted";
}

function receiptLabelOf(status: CancelReceiptStatus | undefined): string {
  return status ? RECEIPT_LABELS[status] : "";
}

function toSummary(row: Cancellation, receiptLabel: string): HoanHuySummary {
  return {
    id: row.id,
    typeLabel: typeLabel(row.type),
    typeClassName: typeClassName(row.type),
    shopeeOrderId: row.shopeeOrderId,
    trackingCode: row.trackingCode ?? "-",
    productName: row.productName ?? "-",
    quantityMeta: `SL ${row.lineQuantity ?? "-"} · Hoàn ${row.returnedQuantity ?? "-"}`,
    returnTrackingCode: allReturnTrackingCodes(row).join("\n") || "-",
    returnMeta: `${row.returnStatus ?? "-"} · ${formatDate(row.returnCompletedAt)}`,
    returnRefundStatus: row.returnRefundStatus ?? "-",
    refundAmountLabel: formatAmount(row.refundAmount),
    complaintReason: row.complaintReason ?? "-",
    complaintStatus: row.complaintStatus ?? "-",
    respondByLabel: formatDate(row.respondByAt),
    respondByClassName: respondByClassName(row.respondByAt),
    receiptLabel,
  };
}

function toDetails(row: Cancellation): HoanHuyDetails {
  return {
    returnReason: row.returnReason ?? "-",
    buyerNote: row.buyerNote ?? "-",
    shopeeNote: row.shopeeNote ?? "-",
    supplierNote: row.supplierNote ?? "-",
    complaintAtLabel: formatDate(row.complaintAt),
    cancelledAtLabel: formatDate(row.cancelledAt),
  };
}

export default async function HoanHuyPage({
  searchParams,
}: {
  searchParams: { page?: string } & Record<string, string | string[] | undefined>;
}) {
  const page = parsePage(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const pageSize = parsePageSize(Array.isArray(searchParams.pageSize) ? searchParams.pageSize[0] : searchParams.pageSize);
  const filters = parseCancellationFilters(searchParams);
  const { receipt, refundStatus } = parseReceiptRefundFilters(searchParams);
  const overdueOnly = parseOverdueFilter(searchParams);
  const types = filters.types;
  // The tabs below set exactly one type; the "Loại" dropdown can set several.
  const activeType = types.length === 1 ? types[0] : undefined;

  // Loaded once, unfiltered by type — the tab counts need every type's
  // count regardless of which tab is active, and the active tab's rows are
  // just a slice of this same set (in-memory, same convention as the other
  // computed-filter fields on the Report page).
  const includeCancelled = showsCancelledOrders(currentShopSlug());
  const [allRows, overdueWarningConfig, overdueWarnings] = await Promise.all([
    loadCancellationRows({ q: filters.q, types: [], includeCancelled }),
    prisma.zaloWatchConfig.findUnique({ where: { purpose: OVERDUE_WARNING_PURPOSE } }),
    loadOverdueWarnings(),
  ]);
  // The same rows the header banner counts, so "Quá hạn (n)" matches its number.
  const overdueIds = new Set(overdueWarnings.map((warning) => warning.cancellationId));
  // "Trạng thái nhận" is derived per order from its lines, so it (like the
  // return/refund status) is filtered here rather than in the query. The tab
  // counts follow those two filters, but not the type itself.
  const receiptStatuses = await loadReceiptStatuses(allRows.map((row) => row.shopeeOrderId));
  const receiptRefundRows = allRows.filter(
    (row) =>
      matchesReceiptFilter(receiptStatuses.get(row.shopeeOrderId) ?? null, receipt) &&
      matchesRefundStatusFilter(row.returnRefundStatus, refundStatus)
  );
  const overdueCount = receiptRefundRows.filter((row) => overdueIds.has(row.id)).length;
  const facetRows = overdueOnly ? receiptRefundRows.filter((row) => overdueIds.has(row.id)) : receiptRefundRows;
  const countCancelled = facetRows.filter((r) => r.type === "cancelled").length;
  const countDeliveryFailed = facetRows.filter((r) => r.type === "delivery_failed").length;
  const countReturned = facetRows.filter((r) => r.type === "returned_refunded").length;
  const filteredRows = types.length > 0 ? facetRows.filter((r) => types.includes(r.type)) : facetRows;

  const typeOptions = (includeCancelled ? ["cancelled", "delivery_failed", "returned_refunded"] : ["delivery_failed", "returned_refunded"]).map(
    (value) => ({ value, label: typeLabel(value) })
  );
  const receiptOptions = [
    ...(["received_full", "received_partial", "not_received", "not_needed"] as const).map((value) => ({ value, label: RECEIPT_LABELS[value] })),
    { value: NO_VALUE, label: "(Trống)" },
  ];
  const refundStatusChoices = refundStatusOptions(
    allRows.map((row) => row.returnRefundStatus),
    refundStatus
  );

  // Every filter except the type, as a query string: the tab links add one
  // type to it, the pagination links add the selected types.
  const otherFilterParams = new URLSearchParams();
  if (filters.q) otherFilterParams.set("q", filters.q);
  for (const value of receipt) otherFilterParams.append("receipt", value);
  for (const value of refundStatus) otherFilterParams.append("refundStatus", value);
  if (overdueOnly) otherFilterParams.set("overdue", "1");
  const otherFilterQuery = otherFilterParams.toString();
  const tabHref = (type: string | undefined) => {
    const params = new URLSearchParams(otherFilterQuery);
    if (type) params.set("type", type);
    return `?${params.toString()}`;
  };

  // The "Quá hạn" pill toggles the filter and keeps every other one, the types included.
  const overdueToggleParams = new URLSearchParams(otherFilterQuery);
  overdueToggleParams.delete("overdue");
  for (const type of types) overdueToggleParams.append("type", type);
  if (!overdueOnly) overdueToggleParams.set("overdue", "1");
  const overdueToggleHref = `?${overdueToggleParams.toString()}`;

  const totalPages = totalPagesFor(filteredRows.length, pageSize);
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  // "đã nhận" comes from the receipt typed in the Zalo group or on the Nhận đơn huỷ
  // page (stored on the order's lines).
  const baseQueryParams = new URLSearchParams(otherFilterQuery);
  for (const type of types) baseQueryParams.append("type", type);
  const baseQuery = baseQueryParams.toString();

  return (
    <main className="page">
      <h1>Đơn hoàn huỷ</h1>

      <ZaloGroupPicker
        purpose={OVERDUE_WARNING_PURPOSE}
        threadName={overdueWarningConfig?.threadName ?? null}
        updatedAt={overdueWarningConfig ? formatDateTimeVN(overdueWarningConfig.updatedAt) : null}
        extra={<span className="cell-sub">(nhóm nhận cảnh báo đơn quá hạn)</span>}
      />

      <div className="toolbar">
        <a className={`filter-pill${types.length === 0 ? " active" : ""}`} href={tabHref(undefined)}>
          Tất cả ({facetRows.length})
        </a>
        {includeCancelled ? (
          <a className={`filter-pill${activeType === "cancelled" ? " active" : ""}`} href={tabHref("cancelled")}>
            Đã huỷ ({countCancelled})
          </a>
        ) : null}
        <a className={`filter-pill${activeType === "delivery_failed" ? " active" : ""}`} href={tabHref("delivery_failed")}>
          Giao thất bại ({countDeliveryFailed})
        </a>
        <a className={`filter-pill${activeType === "returned_refunded" ? " active" : ""}`} href={tabHref("returned_refunded")}>
          Trả hàng hoàn tiền ({countReturned})
        </a>
        <a className={`filter-pill${overdueOnly ? " active" : ""}`} href={overdueToggleHref}>
          ⚠️ Quá hạn ({overdueCount})
        </a>
      </div>

      <form method="get" className="toolbar" style={{ alignItems: "flex-end" }}>
        {overdueOnly ? <input type="hidden" name="overdue" value="1" /> : null}
        <div className="field">
          <span className="field-label">Tìm kiếm</span>
          <input
            className="input"
            type="text"
            name="q"
            defaultValue={filters.q}
            placeholder="Mã đơn hàng / mã vận đơn chiều đi / mã vận đơn hoàn"
            style={{ minWidth: 280 }}
          />
        </div>
        <div className="field" style={{ width: 140 }}>
          <span className="field-label">Loại</span>
          <FilterDropdown name="type" label="Loại" options={typeOptions} selected={types} />
        </div>
        <div className="field" style={{ width: 140 }}>
          <span className="field-label">Trạng thái nhận</span>
          <FilterDropdown name="receipt" label="Trạng thái nhận" options={receiptOptions} selected={receipt} />
        </div>
        <div className="field" style={{ width: 170 }}>
          <span className="field-label">Trạng thái trả hàng/hoàn tiền</span>
          <FilterDropdown
            name="refundStatus"
            label="Trạng thái trả hàng/hoàn tiền"
            options={refundStatusChoices}
            selected={refundStatus}
          />
        </div>
        <div className="field" style={{ flexDirection: "row" }}>
          <button type="submit" className="btn btn-primary btn-sm">
            Lọc
          </button>
          <a href="/dashboard/hoan-huy" className="btn btn-secondary btn-sm">
            Xoá lọc
          </a>
        </div>
      </form>

      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <p className="cell-muted" style={{ margin: 0 }}>
          {filteredRows.length} đơn
        </p>
        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={filteredRows.length}
          baseQuery={baseQuery}
        />
      </div>

      <div className="table-wrap hoan-huy-wrap">
        <table className="data-table hoan-huy-table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Đơn hàng</th>
              <th>Sản phẩm</th>
              <th>Trả hàng</th>
              <th>Trạng thái Trả hàng/Hoàn tiền</th>
              <th>Số tiền hoàn</th>
              <th>Khiếu nại</th>
              <th>Phản hồi trước</th>
              <th>Trạng thái nhận</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <HoanHuyRow key={row.id} summary={toSummary(row, receiptLabelOf(receiptStatuses.get(row.shopeeOrderId)))} details={toDetails(row)} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="empty-state">Không có đơn nào.</p> : null}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        pageSize={pageSize}
        totalCount={filteredRows.length}
        baseQuery={baseQuery}
      />
    </main>
  );
}

import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import { HoanHuyRow, type HoanHuySummary, type HoanHuyDetails } from "./HoanHuyRow";
import { loadCancellationRows, parseCancellationFilters } from "@/lib/cancellation/loadCancellationRows";
import { DELIVERY_RESULT_LABELS, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN } from "@/lib/format/datetime";
import type { Cancellation } from "@prisma/client";

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

function toSummary(row: Cancellation): HoanHuySummary {
  return {
    id: row.id,
    typeLabel: typeLabel(row.type),
    typeClassName: typeClassName(row.type),
    shopeeOrderId: row.shopeeOrderId,
    trackingCode: row.trackingCode ?? "-",
    productName: row.productName ?? "-",
    quantityMeta: `SL ${row.lineQuantity ?? "-"} · Hoàn ${row.returnedQuantity ?? "-"}`,
    returnTrackingCode: row.returnTrackingCode ?? "-",
    returnMeta: `${row.returnStatus ?? "-"} · ${formatDate(row.returnCompletedAt)}`,
    refundAmountLabel: formatAmount(row.refundAmount),
    complaintReason: row.complaintReason ?? "-",
    complaintStatus: row.complaintStatus ?? "-",
    respondByLabel: formatDate(row.respondByAt),
    respondByClassName: respondByClassName(row.respondByAt),
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
  const activeType = filters.types[0];

  // Loaded once, unfiltered by type — the tab counts need every type's
  // count regardless of which tab is active, and the active tab's rows are
  // just a slice of this same set (in-memory, same convention as the other
  // computed-filter fields on the Report page).
  const allRows = await loadCancellationRows({ q: filters.q, types: [] });
  const countDeliveryFailed = allRows.filter((r) => r.type === "delivery_failed").length;
  const countReturned = allRows.filter((r) => r.type === "returned_refunded").length;
  const filteredRows = activeType ? allRows.filter((r) => r.type === activeType) : allRows;

  const filterParams = new URLSearchParams();
  if (filters.q) filterParams.set("q", filters.q);
  const filterQuery = filterParams.toString();
  const tabHref = (type: string | undefined) => {
    const params = new URLSearchParams(filterQuery);
    if (type) params.set("type", type);
    return `?${params.toString()}`;
  };

  const totalPages = totalPagesFor(filteredRows.length, pageSize);
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const baseQueryParams = new URLSearchParams(filterQuery);
  if (activeType) baseQueryParams.set("type", activeType);
  const baseQuery = baseQueryParams.toString();

  return (
    <main className="page">
      <h1>Đơn hoàn huỷ</h1>

      <div className="toolbar">
        <a className={`filter-pill${!activeType ? " active" : ""}`} href={tabHref(undefined)}>
          Tất cả ({allRows.length})
        </a>
        <a className={`filter-pill${activeType === "delivery_failed" ? " active" : ""}`} href={tabHref("delivery_failed")}>
          Giao thất bại ({countDeliveryFailed})
        </a>
        <a className={`filter-pill${activeType === "returned_refunded" ? " active" : ""}`} href={tabHref("returned_refunded")}>
          Trả hàng hoàn tiền ({countReturned})
        </a>
      </div>

      <form method="get" className="toolbar" style={{ alignItems: "flex-end" }}>
        {activeType ? <input type="hidden" name="type" value={activeType} /> : null}
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

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Đơn hàng</th>
              <th>Sản phẩm</th>
              <th>Trả hàng</th>
              <th>Số tiền hoàn</th>
              <th>Khiếu nại</th>
              <th>Phản hồi trước</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <HoanHuyRow key={row.id} summary={toSummary(row)} details={toDetails(row)} />
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

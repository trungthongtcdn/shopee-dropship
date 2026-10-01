import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";
import { FilterDropdown } from "../FilterDropdown";
import { loadCancellationRows, parseCancellationFilters } from "@/lib/cancellation/loadCancellationRows";
import { DELIVERY_RESULT_LABELS, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

// "cancelled" (4.1 Đơn hủy) isn't offered here — those orders are excluded
// from this page entirely (see loadCancellationRows), so a filter option
// that always returns zero rows would just be confusing.
const TYPE_FILTER_OPTIONS = [
  { value: "delivery_failed", label: "Giao thất bại" },
  { value: "returned_refunded", label: "Trả hàng hoàn tiền" },
];

function typeBadge(type: string) {
  const label = DELIVERY_RESULT_LABELS[type as DeliveryResult] ?? type;
  const className = type === "returned_refunded" ? "badge badge-warning" : "badge badge-danger";
  return <span className={className}>{label}</span>;
}

const formatDate = formatDateVN;

function formatAmount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("vi-VN");
}

export default async function HoanHuyPage({
  searchParams,
}: {
  searchParams: { page?: string } & Record<string, string | string[] | undefined>;
}) {
  const page = parsePage(Array.isArray(searchParams.page) ? searchParams.page[0] : searchParams.page);
  const filters = parseCancellationFilters(searchParams);
  const filterParams = new URLSearchParams();
  if (filters.q) filterParams.set("q", filters.q);
  for (const t of filters.types) filterParams.append("type", t);
  const filterQuery = filterParams.toString();
  const buildHref = (p: number) => (filterQuery ? `?${filterQuery}&page=${p}` : `?page=${p}`);

  const allRows = await loadCancellationRows(filters);
  const totalPages = totalPagesFor(allRows.length);
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="page">
      <h1>Đơn hoàn huỷ</h1>
      <p className="page-description">
        Gộp các đơn không giao thành công thật sự dù trạng thái sheet chính vẫn ghi "Hoàn thành": Giao thất bại (4.2
        Giao thất bại), Trả hàng hoàn tiền (5. Trả hàng/hoàn tiền). Đơn thuộc 4.1 Đơn hủy không hiển thị ở đây.
      </p>

      <form method="get" className="toolbar" style={{ alignItems: "flex-end" }}>
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
        <div className="field" style={{ width: 170 }}>
          <span className="field-label">Loại</span>
          <FilterDropdown name="type" label="Loại" options={TYPE_FILTER_OPTIONS} selected={filters.types} />
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
          {allRows.length} đơn
        </p>
        <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Ngày đặt hàng</th>
              <th>Mã đơn hàng</th>
              <th>Mã vận đơn</th>
              <th>Tên sản phẩm</th>
              <th>Tên phân loại</th>
              <th>SL</th>
              <th>SL hoàn</th>
              <th>Trạng thái</th>
              <th>Ngày huỷ thành công</th>
              <th>Thời gian khiếu nại</th>
              <th>Mã vận đơn trả hàng</th>
              <th>Trạng thái trả hàng</th>
              <th>Ngày hoàn trả thành công</th>
              <th>Số tiền hoàn</th>
              <th>Lí do khiếu nại</th>
              <th>Lí do trả hàng</th>
              <th>Cần phản hồi trước</th>
              <th>Trạng thái xử lý khiếu nại</th>
              <th>Ghi chú NCC</th>
              <th>Ghi chú Shopee</th>
              <th>Ghi chú người mua</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{typeBadge(row.type)}</td>
                <td className="cell-muted">{formatDate(row.orderDate)}</td>
                <td>{row.shopeeOrderId}</td>
                <td>{row.trackingCode ?? "-"}</td>
                <td className="cell-truncate" title={row.productName ?? "-"}>
                  {row.productName ?? "-"}
                </td>
                <td className="cell-muted">{row.categoryName ?? "-"}</td>
                <td className="num">{row.lineQuantity ?? "-"}</td>
                <td className="num">{row.returnedQuantity ?? "-"}</td>
                <td className="cell-truncate" title={row.status ?? row.returnRefundStatus ?? "-"}>
                  {row.status ?? row.returnRefundStatus ?? "-"}
                </td>
                <td className="cell-muted">{formatDate(row.cancelledAt)}</td>
                <td className="cell-muted">{formatDate(row.complaintAt)}</td>
                <td>{row.returnTrackingCode ?? "-"}</td>
                <td className="cell-muted">{row.returnStatus ?? "-"}</td>
                <td className="cell-muted">{formatDate(row.returnCompletedAt)}</td>
                <td className="num">{formatAmount(row.refundAmount)}</td>
                <td className="cell-muted cell-truncate" title={row.complaintReason ?? "-"}>
                  {row.complaintReason ?? "-"}
                </td>
                <td className="cell-muted cell-truncate" title={row.returnReason ?? "-"}>
                  {row.returnReason ?? "-"}
                </td>
                <td className="cell-muted">{formatDate(row.respondByAt)}</td>
                <td className="cell-muted">{row.complaintStatus ?? "-"}</td>
                <td className="cell-muted cell-truncate" title={row.supplierNote ?? "-"}>
                  {row.supplierNote ?? "-"}
                </td>
                <td className="cell-muted cell-truncate" title={row.shopeeNote ?? "-"}>
                  {row.shopeeNote ?? "-"}
                </td>
                <td className="cell-muted cell-truncate" title={row.buyerNote ?? "-"}>
                  {row.buyerNote ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="empty-state">Không có đơn nào.</p> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} buildHref={buildHref} />
    </main>
  );
}

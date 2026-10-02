import { prisma } from "@/lib/db";
import { Pagination, parsePage, parsePageSize, totalPagesFor } from "../Pagination";
import { loadCancellationSummaries } from "@/lib/report/cancellationLookup";
import { deriveDeliveryResult, DELIVERY_RESULT_LABELS, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes("hủy") || s.includes("huỷ") || s.includes("thất bại")) return "badge badge-danger";
  if (s.includes("hoàn thành") || s.includes("đã giao")) return "badge badge-success";
  return "badge";
}

// Chỉ hiển thị badge cho "giao thất bại" và "trả hàng hoàn tiền" — còn lại để trống.
function deliveryResultBadge(result: DeliveryResult) {
  if (result !== "delivery_failed" && result !== "returned_refunded") return <span className="cell-muted">-</span>;
  const className = result === "delivery_failed" ? "badge badge-danger" : "badge badge-warning";
  return <span className={className}>{DELIVERY_RESULT_LABELS[result]}</span>;
}

function formatDateTime(value: Date) {
  return value.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { page?: string; pageSize?: string };
}) {
  const page = parsePage(searchParams.page);
  const pageSize = parsePageSize(searchParams.pageSize);

  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: { isActive: true },
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where: { isActive: true } }),
  ]);
  const totalPages = totalPagesFor(totalCount, pageSize);
  const buildHref = (p: number) => `?pageSize=${pageSize}&page=${p}`;
  const onPageSizeHref = (size: number) => `?pageSize=${size}&page=1`;
  const cancellationByOrderId = await loadCancellationSummaries([...new Set(orders.map((o) => o.shopeeOrderId))]);

  return (
    <main className="page">
      <h1>Orders</h1>
      <p className="page-description">Mỗi dòng là 1 sản phẩm trong đơn — 1 mã đơn hàng có thể xuất hiện nhiều dòng.</p>

      <Pagination
        page={page}
        totalPages={totalPages}
        buildHref={buildHref}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageSizeHref={onPageSizeHref}
      />

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ngày tạo đơn</th>
              <th>Mã đơn hàng</th>
              <th>Sản phẩm</th>
              <th>Phân loại</th>
              <th>SL</th>
              <th>Trạng thái</th>
              <th>Kết quả giao thực tế</th>
              <th>Mã vận đơn</th>
              <th>Đơn vị VC</th>
              <th>Giao dự kiến</th>
              <th>Đồng bộ lần cuối</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const deliveryResult = deriveDeliveryResult(cancellationByOrderId.get(order.shopeeOrderId)?.types ?? []);
              return (
              <tr key={order.id}>
                <td className="cell-muted">{formatDateVN(order.orderDate)}</td>
                <td>{order.shopeeOrderId}</td>
                <td className="cell-truncate" title={order.productName ?? "-"}>
                  {order.productName ?? "-"}
                </td>
                <td className="cell-muted">{order.categoryName || "-"}</td>
                <td className="num">{order.lineQuantity ?? "-"}</td>
                <td className="cell-truncate" title={order.status}>
                  <span className={statusBadgeClass(order.status)}>{order.status}</span>
                </td>
                <td>{deliveryResultBadge(deliveryResult)}</td>
                <td>{order.trackingCode ?? "-"}</td>
                <td className="cell-muted">{order.carrier ?? "-"}</td>
                <td className="cell-muted">{formatDateVN(order.expectedDeliveryDate)}</td>
                <td className="cell-muted">{formatDateTime(order.lastSyncedAt)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 0 ? <p className="empty-state">Chưa có dữ liệu.</p> : null}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        buildHref={buildHref}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageSizeHref={onPageSizeHref}
      />
    </main>
  );
}

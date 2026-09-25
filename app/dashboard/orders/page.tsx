import { prisma } from "@/lib/db";
import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";

export const dynamic = "force-dynamic";

function statusBadgeClass(status: string) {
  const s = status.toLowerCase();
  if (s.includes("hủy") || s.includes("huỷ") || s.includes("thất bại")) return "badge badge-danger";
  if (s.includes("hoàn thành") || s.includes("đã giao")) return "badge badge-success";
  return "badge";
}

function formatDateTime(value: Date) {
  return value.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { page?: string };
}) {
  const page = parsePage(searchParams.page);

  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where: { isActive: true },
      orderBy: { lastSyncedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where: { isActive: true } }),
  ]);
  const totalPages = totalPagesFor(totalCount);

  return (
    <main className="page">
      <h1>Orders</h1>
      <p className="page-description">Mỗi dòng là 1 sản phẩm trong đơn — 1 mã đơn hàng có thể xuất hiện nhiều dòng.</p>

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Mã đơn hàng</th>
              <th>Sản phẩm</th>
              <th>Phân loại</th>
              <th>SL</th>
              <th>Trạng thái</th>
              <th>Mã vận đơn</th>
              <th>Đơn vị VC</th>
              <th>Giao dự kiến</th>
              <th>Đồng bộ lần cuối</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.shopeeOrderId}</td>
                <td className="cell-truncate" title={order.productName ?? "-"}>
                  {order.productName ?? "-"}
                </td>
                <td className="cell-muted">{order.categoryName || "-"}</td>
                <td className="num">{order.lineQuantity ?? "-"}</td>
                <td>
                  <span className={statusBadgeClass(order.status)}>{order.status}</span>
                </td>
                <td>{order.trackingCode ?? "-"}</td>
                <td className="cell-muted">{order.carrier ?? "-"}</td>
                <td className="cell-muted">{order.expectedDeliveryDate?.toISOString().slice(0, 10) ?? "-"}</td>
                <td className="cell-muted">{formatDateTime(order.lastSyncedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 ? <p className="empty-state">Chưa có dữ liệu.</p> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />
    </main>
  );
}

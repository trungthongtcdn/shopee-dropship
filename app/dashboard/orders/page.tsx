import { prisma } from "@/lib/db";
import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import { loadCancellationSummaries } from "@/lib/report/cancellationLookup";
import { deriveDeliveryResult, DELIVERY_RESULT_LABELS, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN } from "@/lib/format/datetime";
import type { Prisma } from "@prisma/client";

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
  searchParams: { page?: string; pageSize?: string; q?: string };
}) {
  const page = parsePage(searchParams.page);
  const pageSize = parsePageSize(searchParams.pageSize);
  const q = searchParams.q?.trim() ?? "";

  // One row per product line (same as before this redesign) — DB-level
  // skip/take keeps this page O(pageSize) regardless of table size, instead
  // of fetching every active order to group multi-line orders in memory.
  const where: Prisma.OrderWhereInput = q
    ? {
        isActive: true,
        OR: [
          { shopeeOrderId: { contains: q, mode: "insensitive" } },
          { trackingCode: { contains: q, mode: "insensitive" } },
        ],
      }
    : { isActive: true };

  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.order.count({ where }),
  ]);
  const totalPages = totalPagesFor(totalCount, pageSize);
  const cancellationByOrderId = await loadCancellationSummaries([...new Set(orders.map((o) => o.shopeeOrderId))]);

  return (
    <main className="page">
      <h1>Orders</h1>

      <form method="get" className="toolbar" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <span className="field-label">Tìm kiếm</span>
          <input
            className="input"
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Mã đơn hàng / mã vận đơn"
            style={{ minWidth: 240 }}
          />
        </div>
        <div className="field" style={{ flexDirection: "row" }}>
          <button type="submit" className="btn btn-primary btn-sm">
            Lọc
          </button>
          <a href="/dashboard/orders" className="btn btn-secondary btn-sm">
            Xoá lọc
          </a>
        </div>
      </form>

      <Pagination page={page} totalPages={totalPages} pageSize={pageSize} totalCount={totalCount} baseQuery={q ? `q=${encodeURIComponent(q)}` : ""} />

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ngày tạo đơn</th>
              <th>Đơn hàng</th>
              <th>Sản phẩm</th>
              <th>Phân loại</th>
              <th>SL</th>
              <th>Trạng thái</th>
              <th>Kết quả giao thực tế</th>
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
                  <td>
                    <div className="cell-stack">
                      <strong>{order.shopeeOrderId}</strong>
                      <span className="cell-sub">
                        {order.trackingCode ?? "-"} · {order.carrier ?? "-"}
                      </span>
                    </div>
                  </td>
                  <td className="cell-truncate" title={order.productName ?? "-"}>
                    {order.productName ?? "-"}
                  </td>
                  <td className="cell-muted">{order.categoryName || "-"}</td>
                  <td className="num">{order.lineQuantity ?? "-"}</td>
                  <td className="cell-truncate" title={order.status}>
                    <span className={statusBadgeClass(order.status)}>{order.status}</span>
                  </td>
                  <td>{deliveryResultBadge(deliveryResult)}</td>
                  <td className="cell-muted">{formatDateVN(order.expectedDeliveryDate)}</td>
                  <td className="cell-muted">{formatDateTime(order.lastSyncedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 0 ? <p className="empty-state">Chưa có dữ liệu.</p> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} pageSize={pageSize} totalCount={totalCount} baseQuery={q ? `q=${encodeURIComponent(q)}` : ""} />
    </main>
  );
}

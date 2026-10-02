import { prisma } from "@/lib/db";
import { Pagination } from "../Pagination";
import { parsePage, parsePageSize, totalPagesFor } from "../pageSize";
import { loadCancellationSummaries } from "@/lib/report/cancellationLookup";
import { deriveDeliveryResult, DELIVERY_RESULT_LABELS, type DeliveryResult } from "@/lib/report/deliveryResult";
import { formatDateVN } from "@/lib/format/datetime";
import type { Order } from "@prisma/client";

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

// One entry per distinct shopeeOrderId — `extraLineCount` is how many other
// product lines that same order has, shown as "+n sản phẩm cùng đơn"
// instead of rendering every line as its own row.
interface OrderGroup {
  shopeeOrderId: string;
  firstLine: Order;
  extraLineCount: number;
}

function groupByOrder(orders: Order[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const order of orders) {
    const existing = groups.get(order.shopeeOrderId);
    if (existing) {
      existing.extraLineCount += 1;
    } else {
      groups.set(order.shopeeOrderId, { shopeeOrderId: order.shopeeOrderId, firstLine: order, extraLineCount: 0 });
    }
  }
  return [...groups.values()];
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: { page?: string; pageSize?: string; q?: string };
}) {
  const page = parsePage(searchParams.page);
  const pageSize = parsePageSize(searchParams.pageSize);
  const q = searchParams.q?.trim() ?? "";

  // Fetched in full (same convention as the Report/Đơn hoàn huỷ pages) —
  // grouping by shopeeOrderId has to happen before pagination, otherwise a
  // multi-line order could get split across two pages.
  const orders = await prisma.order.findMany({
    where: q
      ? {
          isActive: true,
          OR: [
            { shopeeOrderId: { contains: q, mode: "insensitive" } },
            { trackingCode: { contains: q, mode: "insensitive" } },
          ],
        }
      : { isActive: true },
    orderBy: [{ orderDate: "desc" }, { id: "asc" }],
  });

  const groups = groupByOrder(orders);
  const totalPages = totalPagesFor(groups.length, pageSize);
  const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);
  const cancellationByOrderId = await loadCancellationSummaries(pageGroups.map((g) => g.shopeeOrderId));

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

      <Pagination page={page} totalPages={totalPages} pageSize={pageSize} totalCount={groups.length} baseQuery={q ? `q=${encodeURIComponent(q)}` : ""} />

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
            {pageGroups.map((group) => {
              const order = group.firstLine;
              const deliveryResult = deriveDeliveryResult(cancellationByOrderId.get(order.shopeeOrderId)?.types ?? []);
              return (
                <tr key={order.shopeeOrderId}>
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
                    <div className="cell-stack">
                      <span>{order.productName ?? "-"}</span>
                      {group.extraLineCount > 0 ? (
                        <span className="cell-sub">+{group.extraLineCount} sản phẩm cùng đơn</span>
                      ) : null}
                    </div>
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
        {pageGroups.length === 0 ? <p className="empty-state">Chưa có dữ liệu.</p> : null}
      </div>

      <Pagination page={page} totalPages={totalPages} pageSize={pageSize} totalCount={groups.length} baseQuery={q ? `q=${encodeURIComponent(q)}` : ""} />
    </main>
  );
}

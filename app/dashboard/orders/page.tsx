import { prisma } from "@/lib/db";
import { PAGE_SIZE, Pagination, parsePage, totalPagesFor } from "../Pagination";

export const dynamic = "force-dynamic";

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
    <main>
      <h1>Orders</h1>
      <p>Each row is one product line — an order id can appear more than once.</p>
      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Product</th>
            <th>Category</th>
            <th>Line Qty</th>
            <th>Status</th>
            <th>Tracking Code</th>
            <th>Carrier</th>
            <th>Expected Delivery</th>
            <th>Last synced</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{order.shopeeOrderId}</td>
              <td>{order.productName ?? "-"}</td>
              <td>{order.categoryName ?? "-"}</td>
              <td>{order.lineQuantity ?? "-"}</td>
              <td>{order.status}</td>
              <td>{order.trackingCode ?? "-"}</td>
              <td>{order.carrier ?? "-"}</td>
              <td>{order.expectedDeliveryDate?.toISOString().slice(0, 10) ?? "-"}</td>
              <td>{order.lastSyncedAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} totalPages={totalPages} buildHref={(p) => `?page=${p}`} />
    </main>
  );
}

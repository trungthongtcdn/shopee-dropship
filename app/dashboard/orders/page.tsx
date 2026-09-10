import { prisma } from "@/lib/db";

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    where: { isActive: true },
    orderBy: { lastSyncedAt: "desc" },
    take: 200,
  });

  return (
    <main>
      <h1>Orders</h1>
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>SKU</th>
            <th>Quantity</th>
            <th>Total</th>
            <th>Status</th>
            <th>Last synced</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{order.shopeeOrderId}</td>
              <td>{order.sku}</td>
              <td>{order.quantity}</td>
              <td>{order.totalAmount}</td>
              <td>{order.status}</td>
              <td>{order.lastSyncedAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

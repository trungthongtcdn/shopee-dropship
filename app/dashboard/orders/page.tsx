import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

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
            <th>Package Code</th>
            <th>Quantity</th>
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
              <td>{order.packageCode ?? "-"}</td>
              <td>{order.quantity ?? "-"}</td>
              <td>{order.status}</td>
              <td>{order.trackingCode ?? "-"}</td>
              <td>{order.carrier ?? "-"}</td>
              <td>{order.expectedDeliveryDate?.toISOString().slice(0, 10) ?? "-"}</td>
              <td>{order.lastSyncedAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

import { prisma } from "@/lib/db";
import { buildReportRows, type ReportRow } from "@/lib/report/buildReport";
import { buildOrderWhere, matchesPaymentMatchFilter, type ReportFilters } from "@/lib/report/filters";

// Shared by the Report page and the Excel export route so both apply
// exactly the same filters — paymentMatch is computed after the
// Product/PaymentRecord join (see buildReportRows) so it can't be pushed
// into the DB query and is filtered here, in memory, after that join.
export async function loadReportRows(filters: ReportFilters): Promise<ReportRow[]> {
  const [orders, products, payments] = await Promise.all([
    prisma.order.findMany({
      where: buildOrderWhere(filters),
      orderBy: { shopeeOrderId: "asc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { categoryName: true, sku: true, kiotCode: true, collectPrice: true },
    }),
    prisma.paymentRecord.findMany({ select: { shopeeOrderId: true, sku: true, amount: true } }),
  ]);

  return buildReportRows(orders, products, payments).filter((row) =>
    matchesPaymentMatchFilter(row.paymentMatch, filters.paymentMatch)
  );
}

// Real Shopee status *categories* are all short (confirmed against
// production: "Chờ giao hàng", "Đã giao", "Hoàn thành", etc. — none over
// ~20 chars). Some orders instead carry a full auto-generated sentence with
// a dynamic date baked in (the post-delivery return-window notice, e.g.
// "Người mua xác nhận đã nhận được hàng, ... tới ngày 2026-09-10."), and a
// fresh one of those appears basically every day — treating each as its own
// filter option make the list grow without bound (1209 orders in
// production already produced dozens of these). They're excluded from the
// filter's option list entirely, not just visually shortened: there's no
// real "category" to filter by here (the date makes each one almost
// unique), and the full text is still visible in the table's own Trạng
// thái column. Anyone actually named a distinct filterable category always
// gets one under this threshold.
const STATUS_OPTION_MAX_LENGTH = 30;

export async function loadDistinctOrderStatuses(): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { isActive: true },
    select: { status: true },
    distinct: ["status"],
    orderBy: { status: "asc" },
  });
  return rows.map((row) => row.status).filter((status) => status && status.length <= STATUS_OPTION_MAX_LENGTH);
}

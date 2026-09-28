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

// Order.status is free text synced straight from the Shopee sheet, not a
// fixed enum — the "Trạng thái đơn" filter's option list is whatever
// distinct values are actually in the DB right now, not a hardcoded guess.
export async function loadDistinctOrderStatuses(): Promise<string[]> {
  const rows = await prisma.order.findMany({
    where: { isActive: true },
    select: { status: true },
    distinct: ["status"],
    orderBy: { status: "asc" },
  });
  return rows.map((row) => row.status).filter(Boolean);
}

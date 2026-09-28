import { prisma } from "@/lib/db";
import { buildReportRows, type ReportRow } from "@/lib/report/buildReport";
import {
  buildOrderWhere,
  isNoiseCancelledOrder,
  matchesPaymentMatchFilter,
  matchesStatusFilter,
  STATUS_OPTION_MAX_LENGTH,
  STATUS_OTHER_VALUE,
  type ReportFilters,
} from "@/lib/report/filters";

// Shared by the Report page and the Excel export route so both apply
// exactly the same filters — paymentMatch and status are both computed/
// grouped in memory (see matchesPaymentMatchFilter, matchesStatusFilter)
// rather than pushed fully into the DB query, so they're filtered here
// after the fetch. isNoiseCancelledOrder is always applied (not a
// togglable filter) — see its own comment in filters.ts.
export async function loadReportRows(filters: ReportFilters): Promise<ReportRow[]> {
  const [orders, products, payments] = await Promise.all([
    prisma.order.findMany({
      where: buildOrderWhere(filters),
      orderBy: { orderDate: "desc" },
    }),
    prisma.product.findMany({
      where: { isActive: true },
      select: { categoryName: true, sku: true, kiotCode: true, collectPrice: true },
    }),
    prisma.paymentRecord.findMany({ select: { shopeeOrderId: true, sku: true, amount: true } }),
  ]);

  return buildReportRows(orders, products, payments).filter(
    (row) =>
      !isNoiseCancelledOrder(row) &&
      matchesPaymentMatchFilter(row.paymentMatch, filters.paymentMatch) &&
      matchesStatusFilter(row.status, filters.status)
  );
}

export interface StatusFilterOption {
  value: string;
  label: string;
}

export async function loadOrderStatusFilterOptions(): Promise<StatusFilterOption[]> {
  const rows = await prisma.order.findMany({
    where: { isActive: true },
    select: { status: true },
    distinct: ["status"],
    orderBy: { status: "asc" },
  });
  const statuses = rows.map((row) => row.status).filter(Boolean);
  const options: StatusFilterOption[] = statuses
    .filter((status) => status.length <= STATUS_OPTION_MAX_LENGTH)
    .map((status) => ({ value: status, label: status }));

  if (statuses.some((status) => status.length > STATUS_OPTION_MAX_LENGTH)) {
    options.push({ value: STATUS_OTHER_VALUE, label: "Khác" });
  }
  return options;
}

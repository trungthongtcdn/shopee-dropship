import type { MatchStatus } from "@prisma/client";
import type { ParsedExcelRow } from "@/lib/reconcile/parseExcel";

// The Prisma enum is the single source of truth for match statuses; re-exported
// here so callers of the matcher do not have to reach into @prisma/client and
// cannot drift out of sync with the database enum.
export type { MatchStatus };

export interface OrderRecord {
  shopeeOrderId: string;
  status: string;
  isActive: boolean;
}

export interface MatchResult {
  shopeeOrderId: string;
  matchStatus: MatchStatus;
  sheetAmount: number | null;
  excelAmount: number | null;
  diffDetail: Record<string, unknown> | null;
}

export function matchReconciliation(excelRows: ParsedExcelRow[], orders: OrderRecord[]): MatchResult[] {
  const ordersById = new Map(orders.map((order) => [order.shopeeOrderId, order]));
  const matchedOrderIds = new Set<string>();
  const results: MatchResult[] = [];

  for (const excelRow of excelRows) {
    const order = ordersById.get(excelRow.shopeeOrderId);
    if (!order) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "missing_in_sheet",
        sheetAmount: null,
        excelAmount: excelRow.amount,
        diffDetail: null,
      });
      continue;
    }

    matchedOrderIds.add(order.shopeeOrderId);

    // The order sheet carries no per-order amount (it only tracks shipping
    // status), so the only comparable field against the settlement file is
    // status — sheetAmount stays null, excelAmount is informational only.
    if (order.status !== excelRow.status) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "status_mismatch",
        sheetAmount: null,
        excelAmount: excelRow.amount,
        diffDetail: { sheetStatus: order.status, excelStatus: excelRow.status },
      });
      continue;
    }

    results.push({
      shopeeOrderId: excelRow.shopeeOrderId,
      matchStatus: "matched",
      sheetAmount: null,
      excelAmount: excelRow.amount,
      diffDetail: null,
    });
  }

  // Only ACTIVE orders can be "missing from the excel file". An inactive order
  // was already removed from the Shopee sheet, so Shopee legitimately omitting
  // it from the reconciliation file is not a discrepancy.
  for (const order of orders) {
    if (order.isActive && !matchedOrderIds.has(order.shopeeOrderId)) {
      results.push({
        shopeeOrderId: order.shopeeOrderId,
        matchStatus: "missing_in_excel",
        sheetAmount: null,
        excelAmount: null,
        diffDetail: null,
      });
    }
  }

  return results;
}

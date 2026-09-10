import type { ParsedExcelRow } from "@/lib/reconcile/parseExcel";

export interface OrderRecord {
  shopeeOrderId: string;
  totalAmount: number;
  status: string;
}

export type MatchStatus =
  | "matched"
  | "missing_in_sheet"
  | "missing_in_excel"
  | "amount_mismatch"
  | "status_mismatch";

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

    if (order.totalAmount !== excelRow.amount) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "amount_mismatch",
        sheetAmount: order.totalAmount,
        excelAmount: excelRow.amount,
        diffDetail: { sheetAmount: order.totalAmount, excelAmount: excelRow.amount },
      });
      continue;
    }

    if (order.status !== excelRow.status) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "status_mismatch",
        sheetAmount: order.totalAmount,
        excelAmount: excelRow.amount,
        diffDetail: { sheetStatus: order.status, excelStatus: excelRow.status },
      });
      continue;
    }

    results.push({
      shopeeOrderId: excelRow.shopeeOrderId,
      matchStatus: "matched",
      sheetAmount: order.totalAmount,
      excelAmount: excelRow.amount,
      diffDetail: null,
    });
  }

  for (const order of orders) {
    if (!matchedOrderIds.has(order.shopeeOrderId)) {
      results.push({
        shopeeOrderId: order.shopeeOrderId,
        matchStatus: "missing_in_excel",
        sheetAmount: order.totalAmount,
        excelAmount: null,
        diffDetail: null,
      });
    }
  }

  return results;
}

import { describe, it, expect } from "vitest";
import { matchReconciliation } from "@/lib/reconcile/matcher";

describe("matchReconciliation", () => {
  const orders = [
    { shopeeOrderId: "SP001", totalAmount: 20000, status: "completed" },
    { shopeeOrderId: "SP002", totalAmount: 15000, status: "completed" },
    { shopeeOrderId: "SP003", totalAmount: 30000, status: "shipped" },
  ];

  it("marks an exact match as matched", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP001", amount: 20000, status: "completed" }],
      orders
    );
    expect(results.find((r) => r.shopeeOrderId === "SP001")?.matchStatus).toBe("matched");
  });

  it("marks an excel row with unknown order id as missing_in_sheet", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP999", amount: 1000, status: "completed" }],
      orders
    );
    expect(results[0].matchStatus).toBe("missing_in_sheet");
  });

  it("marks amount mismatch", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP002", amount: 99999, status: "completed" }],
      orders
    );
    expect(results.find((r) => r.shopeeOrderId === "SP002")?.matchStatus).toBe("amount_mismatch");
  });

  it("marks status mismatch", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP003", amount: 30000, status: "completed" }],
      orders
    );
    expect(results.find((r) => r.shopeeOrderId === "SP003")?.matchStatus).toBe("status_mismatch");
  });

  it("marks an order missing from the excel file as missing_in_excel", () => {
    const results = matchReconciliation([], orders);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.matchStatus === "missing_in_excel")).toBe(true);
  });
});

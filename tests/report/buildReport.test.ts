import { describe, it, expect } from "vitest";
import { buildReportRows, type ReportOrderInput } from "@/lib/report/buildReport";

function order(overrides: Partial<ReportOrderInput> = {}): ReportOrderInput {
  return {
    id: 1,
    shopeeOrderId: "SP001",
    status: "Hoàn thành",
    trackingCode: "SPXVN001",
    productName: "Product 1",
    categoryName: "D100",
    lineQuantity: 1,
    sentAt: null,
    sendStatus: null,
    paidAt: null,
    cancelReceivedAt: null,
    defectRate: null,
    cancelReceiptStatus: null,
    cancelComplaintNote: null,
    note: null,
    luanCheck: false,
    ...overrides,
  };
}

describe("buildReportRows", () => {
  it("computes amountDue from quantity x collectPrice via category-name join", () => {
    const rows = buildReportRows(
      [order({ lineQuantity: 3 })],
      [{ categoryName: "D100", sku: "SKU1", kiotCode: "Kiot1", collectPrice: 1000 }],
      []
    );
    expect(rows[0].sku).toBe("SKU1");
    expect(rows[0].kiotCode).toBe("Kiot1");
    expect(rows[0].amountDue).toBe(3000);
  });

  it("matches category name case-insensitively and trims whitespace", () => {
    const rows = buildReportRows(
      [order({ categoryName: "  d100 " })],
      [{ categoryName: "D100", sku: "SKU1", kiotCode: null, collectPrice: 500 }],
      []
    );
    expect(rows[0].amountDue).toBe(500);
  });

  it("marks payment matched when within 2% either direction", () => {
    const rows = buildReportRows(
      [order()],
      [{ categoryName: "D100", sku: "SKU1", kiotCode: null, collectPrice: 1000 }],
      [{ shopeeOrderId: "SP001", amount: 1020 }]
    );
    expect(rows[0].amountDue).toBe(1000);
    expect(rows[0].amountPaid).toBe(1020);
    expect(rows[0].diffPercent).toBeCloseTo(0.02);
    expect(rows[0].paymentMatch).toBe("matched");
  });

  it("marks payment not_matched when paid is more than 2% under", () => {
    const rows = buildReportRows(
      [order()],
      [{ categoryName: "D100", sku: "SKU1", kiotCode: null, collectPrice: 1000 }],
      [{ shopeeOrderId: "SP001", amount: 970 }]
    );
    expect(rows[0].paymentMatch).toBe("not_matched");
  });

  it("marks payment not_matched when paid is more than 2% over", () => {
    const rows = buildReportRows(
      [order()],
      [{ categoryName: "D100", sku: "SKU1", kiotCode: null, collectPrice: 1000 }],
      [{ shopeeOrderId: "SP001", amount: 1050 }]
    );
    expect(rows[0].paymentMatch).toBe("not_matched");
  });

  it("leaves amountDue and paymentMatch null when no product matches the category", () => {
    const rows = buildReportRows([order({ categoryName: "unknown-category" })], [], [{ shopeeOrderId: "SP001", amount: 1000 }]);
    expect(rows[0].amountDue).toBeNull();
    expect(rows[0].paymentMatch).toBeNull();
  });

  it("leaves paymentMatch null when no payment has been uploaded yet", () => {
    const rows = buildReportRows(
      [order()],
      [{ categoryName: "D100", sku: "SKU1", kiotCode: null, collectPrice: 1000 }],
      []
    );
    expect(rows[0].amountDue).toBe(1000);
    expect(rows[0].amountPaid).toBeNull();
    expect(rows[0].paymentMatch).toBeNull();
  });

  it("passes through the manual/cancel-receipt operational fields unchanged", () => {
    const paidAt = new Date("2026-06-25T00:00:00Z");
    const cancelReceivedAt = new Date("2026-06-20T17:00:00Z");
    const rows = buildReportRows(
      [
        order({
          sendStatus: "sent",
          paidAt,
          cancelReceivedAt,
          defectRate: 0.05,
          cancelReceiptStatus: "received_full",
          luanCheck: true,
          note: "ghi chú",
        }),
      ],
      [],
      []
    );
    expect(rows[0].sendStatus).toBe("sent");
    expect(rows[0].paidAt).toEqual(paidAt);
    expect(rows[0].cancelReceivedAt).toEqual(cancelReceivedAt);
    expect(rows[0].defectRate).toBe(0.05);
    expect(rows[0].cancelReceiptStatus).toBe("received_full");
    expect(rows[0].luanCheck).toBe(true);
    expect(rows[0].note).toBe("ghi chú");
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyPaymentPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function paymentRow(
  rowIndex: number,
  hash: string,
  shopeeOrderId: string,
  sku: string,
  amount: number,
  paidAtIso?: string
): IncomingRow {
  const data: Record<string, string | number> = {
    "Mã đơn hàng": shopeeOrderId,
    "Mã sản phẩm": sku,
    "Giá trị còn lại": amount,
  };
  if (paidAtIso) data["Ngày thanh toán"] = paidAtIso;
  return { rowIndex, hash, data };
}

describe("applyPaymentPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.paymentRecord.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
  });

  it("creates a payment record for a new (order id, sku) pair", async () => {
    const result = await applyPaymentPayload([paymentRow(2, "hash-1", "SP001", "SKU-A", 99590)]);

    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rowErrors).toEqual([]);

    const record = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId_sku: { shopeeOrderId: "SP001", sku: "SKU-A" } } });
    expect(record?.amount).toBe(99590);

    const log = await prisma.syncLog.findFirst({ where: { sourceTab: "payment" } });
    expect(log?.changeType).toBe("insert");
  });

  it("keeps two SKUs of the same order as separate records instead of summing them", async () => {
    await applyPaymentPayload([
      paymentRow(2, "hash-1", "SP001", "SKU-A", 60000),
      paymentRow(3, "hash-2", "SP001", "SKU-B", 40000),
    ]);

    expect(await prisma.paymentRecord.count()).toBe(2);
    const a = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId_sku: { shopeeOrderId: "SP001", sku: "SKU-A" } } });
    const b = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId_sku: { shopeeOrderId: "SP001", sku: "SKU-B" } } });
    expect(a?.amount).toBe(60000);
    expect(b?.amount).toBe(40000);
  });

  it("updates an existing (order id, sku) pair's amount instead of duplicating it", async () => {
    await prisma.paymentRecord.create({
      data: { shopeeOrderId: "SP001", sku: "SKU-A", amount: 1000, rawRowHash: "seed" },
    });

    const result = await applyPaymentPayload([paymentRow(2, "hash-2", "SP001", "SKU-A", 1500)]);

    expect(result.upserted).toBe(1);
    expect(await prisma.paymentRecord.count()).toBe(1);
    const record = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId_sku: { shopeeOrderId: "SP001", sku: "SKU-A" } } });
    expect(record?.amount).toBe(1500);

    const log = await prisma.syncLog.findFirst({ where: { sourceTab: "payment" }, orderBy: { id: "desc" } });
    expect(log?.changeType).toBe("update");
  });

  it("never deletes a payment record missing from the current payload", async () => {
    await prisma.paymentRecord.create({
      data: { shopeeOrderId: "SP001", sku: "SKU-A", amount: 1000, rawRowHash: "seed" },
    });

    await applyPaymentPayload([paymentRow(2, "hash-2", "SP002", "SKU-B", 500)]);

    const untouched = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId_sku: { shopeeOrderId: "SP001", sku: "SKU-A" } } });
    expect(untouched?.amount).toBe(1000);
  });

  it("skips a row missing an order id, sku, or a parseable amount", async () => {
    const result = await applyPaymentPayload([
      paymentRow(2, "hash-1", "", "SKU-A", 1000),
      paymentRow(3, "hash-2", "SP003", "", 1000),
      { rowIndex: 4, hash: "hash-3", data: { "Mã đơn hàng": "SP004", "Mã sản phẩm": "SKU-A", "Giá trị còn lại": "" } },
    ]);

    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(3);
    expect(await prisma.paymentRecord.count()).toBe(0);
  });

  it("patches Order.paidAt for the matching line when 'Ngày thanh toán' is present", async () => {
    await prisma.product.create({
      data: { sku: "SKU-A", productName: "P1", categoryName: "D100", importPrice: 1000, rawRowHash: "seed", sheetRowIndex: 2 },
    });
    await prisma.order.create({
      data: { shopeeOrderId: "SP001", categoryName: "D100", status: "pending", rawRowHash: "seed", sheetRowIndex: 2 },
    });

    await applyPaymentPayload([paymentRow(2, "hash-1", "SP001", "SKU-A", 99590, "2026-09-13T00:00:00.000Z")]);

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(order?.paidAt?.toISOString().slice(0, 10)).toBe("2026-09-13");
  });

  it("does not touch paidAt when 'Ngày thanh toán' is absent from the row", async () => {
    await prisma.product.create({
      data: { sku: "SKU-A", productName: "P1", categoryName: "D100", importPrice: 1000, rawRowHash: "seed", sheetRowIndex: 2 },
    });
    await prisma.order.create({
      data: { shopeeOrderId: "SP001", categoryName: "D100", status: "pending", rawRowHash: "seed", sheetRowIndex: 2 },
    });

    await applyPaymentPayload([paymentRow(2, "hash-1", "SP001", "SKU-A", 99590)]);

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(order?.paidAt).toBeNull();
  });

  it("does not error when the sku has no matching product/order yet", async () => {
    const result = await applyPaymentPayload([
      paymentRow(2, "hash-1", "SP001", "SKU-UNKNOWN", 99590, "2026-09-13T00:00:00.000Z"),
    ]);
    expect(result.upserted).toBe(1);
    expect(result.rowErrors).toEqual([]);
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.paymentRecord.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.$disconnect();
  });
});

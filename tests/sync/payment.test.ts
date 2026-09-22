import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyPaymentPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function paymentRow(rowIndex: number, hash: string, shopeeOrderId: string, amount: number): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      "Mã đơn hàng": shopeeOrderId,
      "Giá trị còn lại": amount,
    },
  };
}

describe("applyPaymentPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.paymentRecord.deleteMany();
  });

  it("creates a payment record for a new order id", async () => {
    const result = await applyPaymentPayload([paymentRow(2, "hash-1", "SP001", 99590)]);

    expect(result.upserted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rowErrors).toEqual([]);

    const record = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(record?.amount).toBe(99590);

    const log = await prisma.syncLog.findFirst({ where: { sourceTab: "payment" } });
    expect(log?.changeType).toBe("insert");
  });

  it("updates an existing order id's amount instead of duplicating it", async () => {
    await prisma.paymentRecord.create({
      data: { shopeeOrderId: "SP001", amount: 1000, rawRowHash: "seed" },
    });

    const result = await applyPaymentPayload([paymentRow(2, "hash-2", "SP001", 1500)]);

    expect(result.upserted).toBe(1);
    expect(await prisma.paymentRecord.count()).toBe(1);
    const record = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(record?.amount).toBe(1500);

    const log = await prisma.syncLog.findFirst({ where: { sourceTab: "payment" }, orderBy: { id: "desc" } });
    expect(log?.changeType).toBe("update");
  });

  it("never deletes a payment record missing from the current payload", async () => {
    await prisma.paymentRecord.create({
      data: { shopeeOrderId: "SP001", amount: 1000, rawRowHash: "seed" },
    });

    await applyPaymentPayload([paymentRow(2, "hash-2", "SP002", 500)]);

    const untouched = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(untouched?.amount).toBe(1000);
  });

  it("skips a row missing an order id or a parseable amount", async () => {
    const result = await applyPaymentPayload([
      paymentRow(2, "hash-1", "", 1000),
      { rowIndex: 3, hash: "hash-2", data: { "Mã đơn hàng": "SP003", "Giá trị còn lại": "" } },
    ]);

    expect(result.upserted).toBe(0);
    expect(result.skipped).toBe(2);
    expect(await prisma.paymentRecord.count()).toBe(0);
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.paymentRecord.deleteMany();
    await prisma.$disconnect();
  });
});

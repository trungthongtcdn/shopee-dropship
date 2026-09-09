// tests/sync/apply.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyOrdersPayload } from "@/lib/sync/apply";

describe("applyOrdersPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("inserts a new row and logs an insert", async () => {
    const diff = await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 2,
          unit_price: 10000,
          total_amount: 20000,
          status: "pending",
        },
      },
    ]);

    expect(diff.inserts).toHaveLength(1);
    const order = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(order?.rawRowHash).toBe("hash-1");
    const log = await prisma.syncLog.findFirst({ where: { changeType: "insert" } });
    expect(log?.sheetRowIndex).toBe(2);
  });

  it("updates a changed row, then soft-deletes it when it disappears", async () => {
    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 2,
          unit_price: 10000,
          total_amount: 20000,
          status: "pending",
        },
      },
    ]);

    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-2",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 3,
          unit_price: 10000,
          total_amount: 30000,
          status: "shipped",
        },
      },
    ]);

    const updated = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(updated?.status).toBe("shipped");
    expect(updated?.isActive).toBe(true);

    await applyOrdersPayload([]);

    const softDeleted = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(softDeleted?.isActive).toBe(false);
    expect(softDeleted?.deletedAt).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

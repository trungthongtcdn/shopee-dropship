// tests/sync/apply.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyOrdersPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function orderRow(rowIndex: number, hash: string, orderId: string): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      shopee_order_id: orderId,
      sku: `SKU-${orderId}`,
      product_name: `Product ${orderId}`,
      quantity: 1,
      unit_price: 1000,
      total_amount: 1000,
      status: "pending",
    },
  };
}

describe("applyOrdersPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("inserts a new row and logs an insert", async () => {
    const result = await applyOrdersPayload([
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

    expect(result.inserted).toBe(1);
    expect(result.rowErrors).toHaveLength(0);
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

    const updateResult = await applyOrdersPayload([
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

    expect(updateResult.updated).toBe(1);
    const updated = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(updated?.status).toBe("shipped");
    expect(updated?.isActive).toBe(true);

    const deleteResult = await applyOrdersPayload([]);
    expect(deleteResult.softDeleted).toBe(1);

    const softDeleted = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(softDeleted?.isActive).toBe(false);
    expect(softDeleted?.deletedAt).not.toBeNull();
  });

  it("recognizes unchanged orders that shifted sheet position, without updating them", async () => {
    // Seed a newest-first sheet: SP001 at row 2, SP002 at row 3.
    const first = await applyOrdersPayload([orderRow(2, "hash-sp001", "SP001"), orderRow(3, "hash-sp002", "SP002")]);
    expect(first.inserted).toBe(2);

    // Next cycle: a brand-new SP003 lands at the top (row 2), pushing SP001 to
    // row 3 and SP002 to row 4. Their data (and therefore hashes) are unchanged.
    const second = await applyOrdersPayload([
      orderRow(2, "hash-sp003", "SP003"),
      orderRow(3, "hash-sp001", "SP001"),
      orderRow(4, "hash-sp002", "SP002"),
    ]);

    expect(second.inserted).toBe(1);
    expect(second.updated).toBe(0);
    expect(second.softDeleted).toBe(0);
    expect(second.rowErrors).toEqual([]);

    const sp001 = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    const sp002 = await prisma.order.findUnique({ where: { shopeeOrderId: "SP002" } });
    const sp003 = await prisma.order.findUnique({ where: { shopeeOrderId: "SP003" } });

    // Untouched rows keep their original hash and stored row index, and stay active.
    expect(sp001?.isActive).toBe(true);
    expect(sp001?.rawRowHash).toBe("hash-sp001");
    expect(sp001?.sheetRowIndex).toBe(2);
    expect(sp002?.isActive).toBe(true);
    expect(sp002?.rawRowHash).toBe("hash-sp002");
    expect(sp002?.sheetRowIndex).toBe(3);
    expect(sp003?.isActive).toBe(true);

    expect(await prisma.order.count({ where: { isActive: true } })).toBe(3);
    expect(await prisma.syncLog.count({ where: { changeType: "update" } })).toBe(0);
    expect(await prisma.syncLog.count({ where: { changeType: "delete" } })).toBe(0);
  });

  it("records a row error instead of throwing when a reappearing order collides with a unique key", async () => {
    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 1,
          unit_price: 1000,
          total_amount: 1000,
          status: "pending",
        },
      },
    ]);
    await applyOrdersPayload([]);

    const result = await applyOrdersPayload([
      {
        rowIndex: 5,
        hash: "hash-2",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 1,
          unit_price: 1000,
          total_amount: 1000,
          status: "pending",
        },
      },
    ]);

    expect(result.inserted).toBe(0);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].identifier).toBe("5");
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

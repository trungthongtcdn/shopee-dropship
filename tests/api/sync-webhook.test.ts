// tests/api/sync-webhook.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sync/webhook/route";
import { prisma } from "@/lib/db";

process.env.SYNC_WEBHOOK_SECRET = "test-secret";

function makeRequest(body: unknown, secret = "test-secret") {
  return new NextRequest("http://localhost/api/sync/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sync/webhook", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("rejects a wrong secret", async () => {
    const response = await POST(makeRequest({ tab: "orders", rows: [] }, "wrong"));
    expect(response.status).toBe(401);
  });

  it("applies valid rows and reports invalid rows separately", async () => {
    const response = await POST(
      makeRequest({
        tab: "orders",
        rows: [
          {
            rowIndex: 2,
            hash: "h1",
            data: {
              "Mã đơn hàng": "SP001",
              "Số lượng sản phẩm 1 đơn": 1,
              "Trạng Thái Đơn Hàng": "pending",
            },
          },
          { rowIndex: 3, hash: "h2" },
        ],
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.inserted).toBe(1);
    expect(json.invalidRows).toHaveLength(1);
    expect(Array.isArray(json.dbErrors)).toBe(true);
  });

  it("reports only rows that actually landed when one row fails", async () => {
    // A soft-deleted SP001 still holds the unique shopee_order_id, so a fresh
    // insert of SP001 collides while SP002 inserts cleanly.
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP001",
        quantity: 1,
        status: "pending",
        rawRowHash: "old-hash",
        sheetRowIndex: 2,
        isActive: false,
        deletedAt: new Date(),
      },
    });

    const response = await POST(
      makeRequest({
        tab: "orders",
        rows: [
          {
            rowIndex: 2,
            hash: "h1",
            data: {
              "Mã đơn hàng": "SP001",
              "Số lượng sản phẩm 1 đơn": 1,
              "Trạng Thái Đơn Hàng": "pending",
            },
          },
          {
            rowIndex: 3,
            hash: "h2",
            data: {
              "Mã đơn hàng": "SP002",
              "Số lượng sản phẩm 1 đơn": 1,
              "Trạng Thái Đơn Hàng": "pending",
            },
          },
        ],
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    // Two inserts attempted, one succeeded: the count must report 1, not 2.
    expect(json.inserted).toBe(1);
    expect(json.updated).toBe(0);
    expect(json.dbErrors).toHaveLength(1);
    expect(json.dbErrors[0].identifier).toBe("2");
    expect(await prisma.order.count({ where: { isActive: true } })).toBe(1);
    const sp002 = await prisma.order.findUnique({ where: { shopeeOrderId: "SP002" } });
    expect(sp002?.isActive).toBe(true);
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

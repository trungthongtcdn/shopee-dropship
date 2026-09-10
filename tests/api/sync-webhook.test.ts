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
              shopee_order_id: "SP001",
              sku: "SKU1",
              product_name: "P1",
              quantity: 1,
              unit_price: 1000,
              total_amount: 1000,
              status: "pending",
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

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

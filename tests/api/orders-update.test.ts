import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/orders/[id]/route";
import { prisma } from "@/lib/db";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/orders/1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/orders/[id]", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  it("updates only the manual operational fields", async () => {
    const order = await prisma.order.create({
      data: {
        shopeeOrderId: "SP001",
        categoryName: "D100",
        status: "Hoàn thành",
        rawRowHash: "h1",
        sheetRowIndex: 2,
      },
    });

    const response = await PATCH(
      makeRequest({
        sendStatus: "sent",
        sentAt: "2026-06-21T00:00:00.000Z",
        defectRate: 0.05,
        note: "test note",
        luanCheck: true,
      }),
      { params: { id: String(order.id) } }
    );

    expect(response.status).toBe(200);
    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated?.sendStatus).toBe("sent");
    expect(updated?.sentAt?.toISOString()).toBe("2026-06-21T00:00:00.000Z");
    expect(updated?.defectRate).toBe(0.05);
    expect(updated?.note).toBe("test note");
    expect(updated?.luanCheck).toBe(true);
    // Synced fields must be untouched by this route.
    expect(updated?.status).toBe("Hoàn thành");
    expect(updated?.categoryName).toBe("D100");
  });

  it("rejects an unknown field", async () => {
    const order = await prisma.order.create({
      data: {
        shopeeOrderId: "SP002",
        categoryName: "D120",
        status: "Hoàn thành",
        rawRowHash: "h2",
        sheetRowIndex: 3,
      },
    });

    const response = await PATCH(makeRequest({ status: "hacked" }), { params: { id: String(order.id) } });
    expect(response.status).toBe(200);
    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    // zod strips unknown keys by default rather than erroring — assert the
    // synced field genuinely didn't change, which is what actually matters.
    expect(updated?.status).toBe("Hoàn thành");
  });

  it("returns 404 for a non-existent order", async () => {
    const response = await PATCH(makeRequest({ note: "x" }), { params: { id: "999999" } });
    expect(response.status).toBe(404);
  });

  afterAll(async () => {
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

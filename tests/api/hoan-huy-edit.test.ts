import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/hoan-huy/[id]/route";
import { prisma } from "@/lib/db";

function patch(id: string | number, body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/hoan-huy/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: { id: String(id) } }
  );
}

describe("PATCH /api/hoan-huy/[id]", () => {
  beforeEach(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
  });

  async function seed() {
    const row = await prisma.cancellation.create({ data: { shopeeOrderId: "H1", type: "delivery_failed", rawRowHash: "h", sheetRowIndex: 2 } });
    await prisma.order.create({ data: { shopeeOrderId: "H1", categoryName: "A", status: "x", rawRowHash: "h", sheetRowIndex: 1 } });
    return row;
  }

  it("saves the receipt status and the NCC note", async () => {
    const row = await seed();
    const response = await patch(row.id, { receiptStatus: "received_full", supplierNote: "đã nhận đủ" });
    expect(response.status).toBe(200);
    expect((await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "H1" } })).cancelReceiptStatus).toBe("received_full");
    expect((await prisma.cancellation.findUniqueOrThrow({ where: { id: row.id } })).supplierNoteEdit).toBe("đã nhận đủ");
  });

  it("answers 400 for a bad id, a bad status, an unreadable body and an edit with no field", async () => {
    const row = await seed();
    expect((await patch("abc", { supplierNote: "x" })).status).toBe(400);
    expect((await patch(row.id, { receiptStatus: "bogus" })).status).toBe(400);
    expect((await patch(row.id, "{not json")).status).toBe(400);
    expect((await patch(row.id, {})).status).toBe(400);
  });

  it("ignores any field that is not one of the three editable ones", async () => {
    const row = await seed();
    const response = await patch(row.id, { supplierNote: "ok", refundAmount: 1, type: "cancelled" });
    expect(response.status).toBe(200);
    const after = await prisma.cancellation.findUniqueOrThrow({ where: { id: row.id } });
    expect([after.type, after.refundAmount]).toEqual(["delivery_failed", null]);
  });

  it("answers 404 for a row that is not there", async () => {
    expect((await patch(987654, { supplierNote: "x" })).status).toBe(404);
  });
});

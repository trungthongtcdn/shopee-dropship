import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { editCancellation, parseCancellationEdit, supplierNoteOf, timeColumnOf } from "@/lib/cancellation/editCancellation";

describe("timeColumnOf", () => {
  const returned = new Date("2026-10-30T03:00:00Z");
  const cancelled = new Date("2026-10-28T03:00:00Z");

  it("is the return-completed time on a return/refund row (sheet 5, column V)", () => {
    expect(timeColumnOf({ type: "returned_refunded", returnCompletedAt: returned, cancelledAt: cancelled })).toBe(returned);
  });

  it("is the successful-cancellation date on the other rows (sheet 5.2 column J / 5.1 column L)", () => {
    expect(timeColumnOf({ type: "delivery_failed", returnCompletedAt: null, cancelledAt: cancelled })).toBe(cancelled);
    expect(timeColumnOf({ type: "cancelled", returnCompletedAt: returned, cancelledAt: cancelled })).toBe(cancelled);
  });

  it("is empty when the sheet has no such time", () => {
    expect(timeColumnOf({ type: "returned_refunded", returnCompletedAt: null, cancelledAt: cancelled })).toBeNull();
  });
});

describe("supplierNoteOf", () => {
  it("shows what the team typed over the sheet's note, and the sheet's note otherwise", () => {
    expect(supplierNoteOf({ supplierNote: "từ sheet", supplierNoteEdit: "gõ tay" })).toBe("gõ tay");
    expect(supplierNoteOf({ supplierNote: "từ sheet", supplierNoteEdit: null })).toBe("từ sheet");
    expect(supplierNoteOf({ supplierNote: null, supplierNoteEdit: null })).toBe("");
  });
});

describe("parseCancellationEdit", () => {
  it("takes the fields that were sent, trims the notes and turns an empty one into null", () => {
    expect(parseCancellationEdit({ receiptStatus: "received_full", supplierNote: "  ok  ", complaintNote: "   " })).toEqual({
      receiptStatus: "received_full",
      supplierNote: "ok",
      complaintNote: null,
    });
    expect(parseCancellationEdit({ receiptStatus: null })).toEqual({ receiptStatus: null });
  });

  it("refuses an unknown status, a non-string note, an over-long note and an empty edit", () => {
    expect(() => parseCancellationEdit({ receiptStatus: "bogus" })).toThrow();
    expect(() => parseCancellationEdit({ supplierNote: 5 })).toThrow();
    expect(() => parseCancellationEdit({ supplierNote: "x".repeat(2001) })).toThrow();
    expect(() => parseCancellationEdit({})).toThrow();
    expect(() => parseCancellationEdit(null)).toThrow();
  });
});

describe("editCancellation", () => {
  beforeEach(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
  });

  async function seed() {
    const cancellation = await prisma.cancellation.create({
      data: { shopeeOrderId: "E1", type: "returned_refunded", rawRowHash: "h", sheetRowIndex: 3, supplierNote: "từ sheet" },
    });
    for (const categoryName of ["A", "B"]) {
      await prisma.order.create({ data: { shopeeOrderId: "E1", categoryName, status: "Hoàn thành", rawRowHash: "h", sheetRowIndex: 1 } });
    }
    await prisma.order.create({ data: { shopeeOrderId: "OTHER", categoryName: "A", status: "Hoàn thành", rawRowHash: "h", sheetRowIndex: 2 } });
    return cancellation;
  }

  it("sets the receipt status on every line of that order and on no other order", async () => {
    const { id } = await seed();

    const done = await editCancellation(id, { receiptStatus: "received_full" });

    expect(done).toBe(true);
    const lines = await prisma.order.findMany({ orderBy: [{ shopeeOrderId: "asc" }, { categoryName: "asc" }] });
    expect(lines.map((l) => [l.shopeeOrderId, l.cancelReceiptStatus])).toEqual([
      ["E1", "received_full"],
      ["E1", "received_full"],
      ["OTHER", null],
    ]);
    expect(lines[0].cancelReceivedAt).toBeInstanceOf(Date);
    expect(lines[2].cancelReceivedAt).toBeNull();
  });

  it("clears the status and the received time when set back to blank, and has no received time for a 'not needed'", async () => {
    const { id } = await seed();
    await editCancellation(id, { receiptStatus: "received_full" });

    await editCancellation(id, { receiptStatus: "not_needed" });
    expect((await prisma.order.findFirst({ where: { shopeeOrderId: "E1" } }))?.cancelReceivedAt).toBeNull();

    await editCancellation(id, { receiptStatus: "received_partial" });
    expect((await prisma.order.findFirst({ where: { shopeeOrderId: "E1" } }))?.cancelReceivedAt).toBeInstanceOf(Date);

    await editCancellation(id, { receiptStatus: null });
    const line = await prisma.order.findFirst({ where: { shopeeOrderId: "E1" } });
    expect([line?.cancelReceiptStatus, line?.cancelReceivedAt]).toEqual([null, null]);
  });

  it("keeps the typed NCC note beside the sheet's, and goes back to the sheet's when it is emptied", async () => {
    const { id } = await seed();

    await editCancellation(id, { supplierNote: "đã gọi NCC" });
    let row = await prisma.cancellation.findUniqueOrThrow({ where: { id } });
    expect([row.supplierNote, row.supplierNoteEdit]).toEqual(["từ sheet", "đã gọi NCC"]);

    await editCancellation(id, { supplierNote: null });
    row = await prisma.cancellation.findUniqueOrThrow({ where: { id } });
    expect([row.supplierNote, row.supplierNoteEdit]).toEqual(["từ sheet", null]);
  });

  it("writes the complaint note onto every line of the order", async () => {
    const { id } = await seed();
    await editCancellation(id, { complaintNote: "đã khiếu nại" });
    const notes = (await prisma.order.findMany({ where: { shopeeOrderId: "E1" } })).map((l) => l.cancelComplaintNote);
    expect(notes).toEqual(["đã khiếu nại", "đã khiếu nại"]);
  });

  it("changes only what was sent", async () => {
    const { id } = await seed();
    await editCancellation(id, { receiptStatus: "received_full", supplierNote: "a" });
    await editCancellation(id, { complaintNote: "b" });
    const line = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "E1" } });
    const row = await prisma.cancellation.findUniqueOrThrow({ where: { id } });
    expect([line.cancelReceiptStatus, row.supplierNoteEdit, line.cancelComplaintNote]).toEqual(["received_full", "a", "b"]);
  });

  it("says so when the row does not exist or was retired", async () => {
    const { id } = await seed();
    expect(await editCancellation(id + 999, { supplierNote: "x" })).toBe(false);
    await prisma.cancellation.update({ where: { id }, data: { isActive: false } });
    expect(await editCancellation(id, { supplierNote: "x" })).toBe(false);
  });
});

describe("loadComplaintNotes", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  it("gives each order its first filled complaint note and leaves the others out", async () => {
    const { loadComplaintNotes } = await import("@/lib/cancellation/complaintNotes");
    const line = (shopeeOrderId: string, categoryName: string, cancelComplaintNote: string | null, isActive = true) =>
      prisma.order.create({ data: { shopeeOrderId, categoryName, status: "x", rawRowHash: "h", sheetRowIndex: 1, cancelComplaintNote, isActive } });
    await line("N1", "A", null);
    await line("N1", "B", "đã khiếu nại");
    await line("N2", "A", "retired", false);
    await line("N3", "A", null);

    const notes = await loadComplaintNotes(["N1", "N2", "N3", "NOPE"]);

    expect([...notes]).toEqual([["N1", "đã khiếu nại"]]);
    expect([...(await loadComplaintNotes([]))]).toEqual([]);
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyPaymentBatchPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function lineRow(rowIndex: number, hash: string, shopeeOrderId: string, netAmount: number): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      "Mã đơn hàng": shopeeOrderId,
      "Mã sản phẩm": "SKU1",
      "Tên hàng hóa": "[FURNI HOME] Piston ghế",
      "Số lượng": 1,
      "Giá bán": 160681,
      "Phí dịch vụ": 58681,
      "Khấu trừ thuế": 2410,
      "Giá trị còn lại": netAmount,
    },
  };
}

describe("applyPaymentBatchPayload", () => {
  beforeEach(async () => {
    await prisma.paymentBatchLine.deleteMany();
    await prisma.paymentBatch.deleteMany();
  });

  it("creates a batch and its lines on first sync", async () => {
    const result = await applyPaymentBatchPayload("07/09/2026-13/09/2026", [
      lineRow(9, "hash-1", "SP001", 99590),
      lineRow(10, "hash-2", "SP002", 29683),
    ]);

    expect(result.lineCount).toBe(2);
    expect(result.rowErrors).toEqual([]);

    const batch = await prisma.paymentBatch.findUnique({
      where: { weekLabel: "07/09/2026-13/09/2026" },
      include: { lines: true },
    });
    expect(batch?.lines).toHaveLength(2);
    expect(batch?.lines.map((line) => line.netAmount).sort()).toEqual([29683, 99590]);
  });

  it("fully replaces a batch's lines on re-sync instead of appending", async () => {
    await applyPaymentBatchPayload("07/09/2026-13/09/2026", [lineRow(9, "hash-1", "SP001", 99590)]);
    const result = await applyPaymentBatchPayload("07/09/2026-13/09/2026", [lineRow(9, "hash-1-corrected", "SP001", 95000)]);

    expect(result.lineCount).toBe(1);
    const batch = await prisma.paymentBatch.findUnique({
      where: { weekLabel: "07/09/2026-13/09/2026" },
      include: { lines: true },
    });
    expect(batch?.lines).toHaveLength(1);
    expect(batch?.lines[0].netAmount).toBe(95000);
  });

  it("keeps a different week's batch untouched", async () => {
    await applyPaymentBatchPayload("07/09/2026-13/09/2026", [lineRow(9, "hash-1", "SP001", 99590)]);
    await applyPaymentBatchPayload("01/09/2026-06/09/2026", [lineRow(9, "hash-2", "SP002", 50000)]);

    expect(await prisma.paymentBatch.count()).toBe(2);
    const first = await prisma.paymentBatch.findUnique({
      where: { weekLabel: "07/09/2026-13/09/2026" },
      include: { lines: true },
    });
    expect(first?.lines).toHaveLength(1);
    expect(first?.lines[0].shopeeOrderId).toBe("SP001");
  });

  it("skips a row missing an order id or amount", async () => {
    const result = await applyPaymentBatchPayload("07/09/2026-13/09/2026", [
      lineRow(9, "hash-1", "SP001", 99590),
      { rowIndex: 10, hash: "hash-2", data: { "Mã đơn hàng": "", "Giá trị còn lại": 1000 } },
    ]);

    expect(result.lineCount).toBe(1);
    expect(result.rowErrors).toHaveLength(1);
  });

  afterAll(async () => {
    await prisma.paymentBatchLine.deleteMany();
    await prisma.paymentBatch.deleteMany();
    await prisma.$disconnect();
  });
});

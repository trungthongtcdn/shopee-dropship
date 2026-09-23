import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyCancelReceiptPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function cancelRow(
  rowIndex: number,
  hash: string,
  data: Partial<{ "Ngày nhận đơn huỷ": string; "Mã vận đơn": string; "Tỷ lệ % hỏng": number; "Trạng thái nhận đơn huỷ": string }>
): IncomingRow {
  return { rowIndex, hash, data: data as Record<string, string | number> };
}

async function seedOrder(overrides: { shopeeOrderId: string; categoryName?: string; trackingCode: string | null }) {
  return prisma.order.create({
    data: {
      shopeeOrderId: overrides.shopeeOrderId,
      categoryName: overrides.categoryName ?? "",
      trackingCode: overrides.trackingCode,
      status: "pending",
      rawRowHash: "seed",
      sheetRowIndex: 2,
    },
  });
}

describe("applyCancelReceiptPayload", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  it("patches cancelReceivedAt/defectRate/cancelReceiptStatus by matching trackingCode", async () => {
    await seedOrder({ shopeeOrderId: "SP001", trackingCode: "SPXVN001" });

    const result = await applyCancelReceiptPayload([
      cancelRow(2, "h1", {
        "Ngày nhận đơn huỷ": "2026-06-22",
        "Mã vận đơn": "SPXVN001",
        "Tỷ lệ % hỏng": 5,
        "Trạng thái nhận đơn huỷ": "ĐÃ NHẬN ĐỦ",
      }),
    ]);

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rowErrors).toEqual([]);

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(order?.cancelReceivedAt?.toISOString().slice(0, 10)).toBe("2026-06-22");
    expect(order?.defectRate).toBe(0.05);
    expect(order?.cancelReceiptStatus).toBe("received_full");
  });

  it("updates every product line of a multi-line order sharing the same tracking code", async () => {
    await seedOrder({ shopeeOrderId: "SP002", categoryName: "D100", trackingCode: "SPXVN002" });
    await seedOrder({ shopeeOrderId: "SP002", categoryName: "D120", trackingCode: "SPXVN002" });

    const result = await applyCancelReceiptPayload([
      cancelRow(2, "h1", { "Mã vận đơn": "SPXVN002", "Trạng thái nhận đơn huỷ": "NHẬN THIẾU" }),
    ]);

    expect(result.updated).toBe(2);
    const orders = await prisma.order.findMany({ where: { shopeeOrderId: "SP002" } });
    expect(orders.every((o) => o.cancelReceiptStatus === "received_partial")).toBe(true);
  });

  it("skips a row with no tracking code (calendar template rows)", async () => {
    const result = await applyCancelReceiptPayload([cancelRow(4, "h1", {})]);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("does not error when a tracking code matches no order yet", async () => {
    const result = await applyCancelReceiptPayload([cancelRow(2, "h1", { "Mã vận đơn": "SPXVN-UNKNOWN" })]);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.rowErrors).toEqual([]);
  });

  it("leaves a field untouched when its sheet column is empty rather than overwriting it", async () => {
    await seedOrder({ shopeeOrderId: "SP003", trackingCode: "SPXVN003" });
    await prisma.order.updateMany({ where: { shopeeOrderId: "SP003" }, data: { defectRate: 0.1 } });

    await applyCancelReceiptPayload([
      cancelRow(2, "h1", { "Mã vận đơn": "SPXVN003", "Trạng thái nhận đơn huỷ": "CHƯA NHẬN" }),
    ]);

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP003" } });
    expect(order?.defectRate).toBe(0.1);
    expect(order?.cancelReceiptStatus).toBe("not_received");
  });

  afterAll(async () => {
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

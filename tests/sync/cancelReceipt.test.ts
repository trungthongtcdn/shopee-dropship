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
    await prisma.cancelReceiptSyncState.deleteMany();
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
    expect(result.skipped).toBe(1);
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

  it("skips a re-sync of an unchanged row instead of re-writing it", async () => {
    await seedOrder({ shopeeOrderId: "SP004", trackingCode: "SPXVN004" });

    const row = cancelRow(2, "same-hash", { "Mã vận đơn": "SPXVN004", "Trạng thái nhận đơn huỷ": "ĐÃ NHẬN ĐỦ" });
    const first = await applyCancelReceiptPayload([row]);
    expect(first.updated).toBe(1);
    expect(first.unchanged).toBe(0);

    // Simulate a manual correction in RowEditor between sync cycles.
    await prisma.order.updateMany({ where: { shopeeOrderId: "SP004" }, data: { cancelReceiptStatus: "not_received" } });

    const second = await applyCancelReceiptPayload([row]);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(1);

    // The manual correction must survive the unchanged re-sync.
    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP004" } });
    expect(order?.cancelReceiptStatus).toBe("not_received");
  });

  it("re-applies when the row's content actually changed (different hash)", async () => {
    await seedOrder({ shopeeOrderId: "SP005", trackingCode: "SPXVN005" });

    await applyCancelReceiptPayload([cancelRow(2, "hash-v1", { "Mã vận đơn": "SPXVN005", "Trạng thái nhận đơn huỷ": "CHƯA NHẬN" })]);
    const second = await applyCancelReceiptPayload([
      cancelRow(2, "hash-v2", { "Mã vận đơn": "SPXVN005", "Trạng thái nhận đơn huỷ": "ĐÃ NHẬN ĐỦ" }),
    ]);

    expect(second.updated).toBe(1);
    expect(second.unchanged).toBe(0);
    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP005" } });
    expect(order?.cancelReceiptStatus).toBe("received_full");
  });

  it("reports ambiguous and skips when a tracking code currently matches more than one order", async () => {
    await seedOrder({ shopeeOrderId: "SP007A", trackingCode: "SPXVN007" });
    await seedOrder({ shopeeOrderId: "SP007B", trackingCode: "SPXVN007" });

    const result = await applyCancelReceiptPayload([
      cancelRow(2, "h1", { "Mã vận đơn": "SPXVN007", "Trạng thái nhận đơn huỷ": "ĐÃ NHẬN ĐỦ" }),
    ]);

    expect(result.updated).toBe(0);
    expect(result.ambiguous).toBe(1);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].identifier).toBe("SPXVN007");

    const orderA = await prisma.order.findFirst({ where: { shopeeOrderId: "SP007A" } });
    const orderB = await prisma.order.findFirst({ where: { shopeeOrderId: "SP007B" } });
    expect(orderA?.cancelReceiptStatus).toBeNull();
    expect(orderB?.cancelReceiptStatus).toBeNull();
  });

  it("re-applies when the same tracking code now resolves to a different order, even with an unchanged hash", async () => {
    await seedOrder({ shopeeOrderId: "SP008", trackingCode: "SPXVN008" });
    const row = cancelRow(2, "same-hash", { "Mã vận đơn": "SPXVN008", "Trạng thái nhận đơn huỷ": "ĐÃ NHẬN ĐỦ" });

    const first = await applyCancelReceiptPayload([row]);
    expect(first.updated).toBe(1);

    // Tracking code reassigned: the old order moves off it, a new order
    // takes it over (carrier code reuse / correction).
    await prisma.order.updateMany({ where: { shopeeOrderId: "SP008" }, data: { trackingCode: null } });
    await seedOrder({ shopeeOrderId: "SP009", trackingCode: "SPXVN008" });

    const second = await applyCancelReceiptPayload([row]);
    expect(second.updated).toBe(1);
    expect(second.unchanged).toBe(0);

    const newOrder = await prisma.order.findFirst({ where: { shopeeOrderId: "SP009" } });
    expect(newOrder?.cancelReceiptStatus).toBe("received_full");
  });

  it("retries an unmatched tracking code instead of permanently skipping it once the order appears", async () => {
    const row = cancelRow(2, "same-hash", { "Mã vận đơn": "SPXVN006", "Trạng thái nhận đơn huỷ": "ĐÃ NHẬN ĐỦ" });

    const first = await applyCancelReceiptPayload([row]);
    expect(first.updated).toBe(0);
    expect(first.unchanged).toBe(0);

    // Order syncs in from the main Shopee sheet after the cancel-receipt row.
    await seedOrder({ shopeeOrderId: "SP006", trackingCode: "SPXVN006" });

    const second = await applyCancelReceiptPayload([row]);
    expect(second.updated).toBe(1);
    expect(second.unchanged).toBe(0);
    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP006" } });
    expect(order?.cancelReceiptStatus).toBe("received_full");
  });

  afterAll(async () => {
    await prisma.order.deleteMany();
    await prisma.cancelReceiptSyncState.deleteMany();
    await prisma.$disconnect();
  });
});

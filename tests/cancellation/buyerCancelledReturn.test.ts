import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { isBuyerCancelledReturn, markBuyerCancelledReturnsNotNeeded } from "@/lib/cancellation/buyerCancelledReturn";
import { applyOrdersPayload, applyReturnedRefundedPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

describe("isBuyerCancelledReturn", () => {
  it("matches the Shopee status text", () => {
    expect(isBuyerCancelledReturn("Yêu cầu của Người mua đã hủy")).toBe(true);
  });

  it("matches the other spelling of hủy/huỷ, casing and stray whitespace", () => {
    expect(isBuyerCancelledReturn("Yêu cầu của Người mua đã huỷ")).toBe(true);
    expect(isBuyerCancelledReturn("  yêu cầu của người mua  đã hủy ")).toBe(true);
  });

  it("matches the same text typed with decomposed (NFD) diacritics", () => {
    expect(isBuyerCancelledReturn("Yêu cầu của Người mua đã hủy".normalize("NFD"))).toBe(true);
  });

  it("rejects every other status, blank or missing", () => {
    expect(isBuyerCancelledReturn("Đã hoàn tiền")).toBe(false);
    expect(isBuyerCancelledReturn("Yêu cầu của Người mua đã được chấp nhận")).toBe(false);
    expect(isBuyerCancelledReturn("Yêu cầu của Người mua đã hủy và gửi lại")).toBe(false);
    expect(isBuyerCancelledReturn("")).toBe(false);
    expect(isBuyerCancelledReturn(null)).toBe(false);
    expect(isBuyerCancelledReturn(undefined)).toBe(false);
  });
});

describe("markBuyerCancelledReturnsNotNeeded", () => {
  const BUYER_CANCELLED = "Yêu cầu của Người mua đã hủy";

  beforeEach(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
  });

  afterAll(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });

  async function seedLine(shopeeOrderId: string, categoryName: string, extra: Record<string, unknown> = {}) {
    return prisma.order.create({
      data: { shopeeOrderId, categoryName, status: "Hoàn thành", rawRowHash: "seed", sheetRowIndex: 1, ...extra },
    });
  }

  async function seedReturn(shopeeOrderId: string, returnRefundStatus: string | null, extra: Record<string, unknown> = {}) {
    return prisma.cancellation.create({
      data: { shopeeOrderId, type: "returned_refunded", returnRefundStatus, rawRowHash: "seed", sheetRowIndex: 1, ...extra },
    });
  }

  async function statusOf(shopeeOrderId: string) {
    const lines = await prisma.order.findMany({ where: { shopeeOrderId }, orderBy: { categoryName: "asc" } });
    return lines.map((line) => line.cancelReceiptStatus);
  }

  it("sets every empty line of a buyer-cancelled return to not_needed", async () => {
    await seedLine("B1", "A");
    await seedLine("B1", "B");
    await seedReturn("B1", BUYER_CANCELLED);

    const updated = await markBuyerCancelledReturnsNotNeeded();

    expect(updated).toBe(2);
    expect(await statusOf("B1")).toEqual(["not_needed", "not_needed"]);
  });

  it("leaves a receipt someone already entered alone", async () => {
    await seedLine("B2", "A", { cancelReceiptStatus: "received_full" });
    await seedLine("B2", "B");
    await seedReturn("B2", BUYER_CANCELLED);

    await markBuyerCancelledReturnsNotNeeded();

    expect(await statusOf("B2")).toEqual(["received_full", "not_needed"]);
  });

  it("ignores returns in any other status, with no status, or on another tab", async () => {
    await seedLine("B3", "A");
    await seedLine("B4", "A");
    await seedLine("B5", "A");
    await seedLine("B6", "A");
    await seedReturn("B3", "Đã hoàn tiền");
    await seedReturn("B4", null);
    await seedReturn("B5", BUYER_CANCELLED, { isActive: false });
    await prisma.cancellation.create({
      data: { shopeeOrderId: "B6", type: "delivery_failed", returnRefundStatus: BUYER_CANCELLED, rawRowHash: "seed", sheetRowIndex: 2 },
    });

    expect(await markBuyerCancelledReturnsNotNeeded()).toBe(0);

    for (const id of ["B3", "B4", "B5", "B6"]) expect(await statusOf(id)).toEqual([null]);
  });

  it("leaves retired order lines and unrelated orders alone", async () => {
    await seedLine("B7", "A", { isActive: false });
    await seedLine("B8", "A");
    await seedReturn("B7", BUYER_CANCELLED);

    expect(await markBuyerCancelledReturnsNotNeeded()).toBe(0);

    expect(await statusOf("B7")).toEqual([null]);
    expect(await statusOf("B8")).toEqual([null]);
  });

  it("is idempotent and does nothing when there are no such returns", async () => {
    expect(await markBuyerCancelledReturnsNotNeeded()).toBe(0);

    await seedLine("B9", "A");
    await seedReturn("B9", BUYER_CANCELLED);
    expect(await markBuyerCancelledReturnsNotNeeded()).toBe(1);
    expect(await markBuyerCancelledReturnsNotNeeded()).toBe(0);
  });
});

describe("sync keeps buyer-cancelled returns at not_needed", () => {
  const BUYER_CANCELLED = "Yêu cầu của Người mua đã hủy";

  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });

  function returnRow(orderId: string, status: string): IncomingRow {
    return {
      rowIndex: 2,
      hash: `hash-${orderId}-${status}`,
      data: { "Mã đơn hàng": orderId, "Trạng thái Trả hàng/Hoàn tiền": status },
    };
  }

  function orderRow(orderId: string): IncomingRow {
    return {
      rowIndex: 2,
      hash: `hash-${orderId}`,
      data: { "Mã đơn hàng": orderId, "Trạng Thái Đơn Hàng": "HOÀN THÀNH", "Tên phân loại hàng": "D100" },
    };
  }

  async function statusOf(shopeeOrderId: string) {
    const lines = await prisma.order.findMany({ where: { shopeeOrderId, isActive: true } });
    return lines.map((line) => line.cancelReceiptStatus);
  }

  it("when the return row syncs in after the order", async () => {
    await applyOrdersPayload([orderRow("S1")]);
    expect(await statusOf("S1")).toEqual([null]);

    await applyReturnedRefundedPayload([returnRow("S1", BUYER_CANCELLED)]);

    expect(await statusOf("S1")).toEqual(["not_needed"]);
  });

  it("when the order syncs in after the return row", async () => {
    await applyReturnedRefundedPayload([returnRow("S2", BUYER_CANCELLED)]);

    await applyOrdersPayload([orderRow("S2")]);

    expect(await statusOf("S2")).toEqual(["not_needed"]);
  });

  it("leaves a return in any other status unreceived", async () => {
    await applyOrdersPayload([orderRow("S3")]);

    await applyReturnedRefundedPayload([returnRow("S3", "Đã hoàn tiền")]);

    expect(await statusOf("S3")).toEqual([null]);
  });
});

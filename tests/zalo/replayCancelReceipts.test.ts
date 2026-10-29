import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { replayCancelReceipts, lastInstantOfDayVN } from "@/lib/zalo/replayCancelReceipts";

// A receipt message that arrived before its order had synced in matched nothing
// (matchedCount 0) and the date it named was lost. Replaying the log applies it
// to the orders that exist now.

const UNTIL = lastInstantOfDayVN("2026-10-27");

async function seedOrder(shopeeOrderId: string, extra: Record<string, unknown> = {}) {
  return prisma.order.create({
    data: { shopeeOrderId, categoryName: "D100", status: "Hoàn thành", rawRowHash: "h", sheetRowIndex: 1, ...extra },
  });
}

async function seedLog(codes: string[], confirmedAt: string, extra: { matchedCount?: number; threadId?: string } = {}) {
  return prisma.zaloCancelReceiptLog.create({
    data: {
      threadId: extra.threadId ?? "group-1",
      messageContent: codes.join(", "),
      codes,
      matchedCount: extra.matchedCount ?? 0,
      confirmedByName: "Luân",
      confirmedAt: new Date(confirmedAt),
    },
  });
}

describe("lastInstantOfDayVN", () => {
  it("is the start of the next day in Vietnam, as an exclusive upper bound", () => {
    expect(lastInstantOfDayVN("2026-10-27").toISOString()).toBe("2026-10-27T17:00:00.000Z");
  });

  it("rejects anything that is not a plain date", () => {
    expect(() => lastInstantOfDayVN("27/10/2026")).toThrow();
    expect(() => lastInstantOfDayVN("2026-13-40")).toThrow();
  });
});

describe("replayCancelReceipts", () => {
  beforeEach(async () => {
    await prisma.zaloCancelReceiptLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cancellation.deleteMany();
  });

  it("applies a receipt that matched nothing back then to the order that exists now", async () => {
    await seedOrder("SP001");
    const log = await seedLog(["SP001"], "2026-10-20T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    const order = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "SP001" } });
    expect(order.cancelReceiptStatus).toBe("received_full");
    expect(order.cancelReceivedAt?.toISOString()).toBe("2026-10-20T03:00:00.000Z");
    expect(result.mappedOrders).toEqual(["SP001"]);
    expect((await prisma.zaloCancelReceiptLog.findUniqueOrThrow({ where: { id: log.id } })).matchedCount).toBe(1);
  });

  it("writes nothing on a dry run but reports what it would map", async () => {
    await seedOrder("SP001");
    const log = await seedLog(["SP001"], "2026-10-20T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: false });

    expect(result.mappedOrders).toEqual(["SP001"]);
    const order = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "SP001" } });
    expect(order.cancelReceivedAt).toBeNull();
    expect(order.cancelReceiptStatus).toBeNull();
    expect((await prisma.zaloCancelReceiptLog.findUniqueOrThrow({ where: { id: log.id } })).matchedCount).toBe(0);
  });

  it("includes all of 27/10 in Vietnam time and nothing after it", async () => {
    await seedOrder("IN");
    await seedOrder("OUT");
    await seedLog(["IN"], "2026-10-27T16:59:00.000Z"); // 27/10 23:59 in Vietnam
    await seedLog(["OUT"], "2026-10-27T17:01:00.000Z"); // 28/10 00:01 in Vietnam

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders).toEqual(["IN"]);
    expect((await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "OUT" } })).cancelReceivedAt).toBeNull();
  });

  it("finds an order by its tracking code", async () => {
    await seedOrder("SP002", { trackingCode: "SPXVN000111" });
    await seedLog(["SPXVN000111"], "2026-10-21T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders).toEqual(["SP002"]);
  });

  it("finds a returned order by the return tracking code on its Cancellation row", async () => {
    await seedOrder("SP003", { trackingCode: "OUT-CODE" });
    await prisma.cancellation.create({
      data: { shopeeOrderId: "SP003", type: "returned_refunded", returnTrackingCode: "SPXVN060152102809", rawRowHash: "h", sheetRowIndex: 1 },
    });
    await seedLog(["SPXVN060152102809"], "2026-10-22T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders).toEqual(["SP003"]);
  });

  it("finds a returned order by any of the return tracking codes it has had", async () => {
    await seedOrder("SP006", { trackingCode: "OUT-CODE" });
    await prisma.cancellation.create({
      data: {
        shopeeOrderId: "SP006",
        type: "returned_refunded",
        returnTrackingCode: "GYM344XL",
        returnTrackingCodes: ["GYM344XL", "GYMCLK9Q"],
        rawRowHash: "h",
        sheetRowIndex: 1,
      },
    });
    await seedLog(["GYMCLK9Q"], "2026-10-22T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders).toEqual(["SP006"]);
  });

  it("covers every line of a multi-line order", async () => {
    await seedOrder("SP004", { categoryName: "A", sheetRowIndex: 1 });
    await seedOrder("SP004", { categoryName: "B", sheetRowIndex: 2 });
    await seedLog(["SP004"], "2026-10-22T03:00:00.000Z");

    await replayCancelReceipts({ until: UNTIL, apply: true });

    const lines = await prisma.order.findMany({ where: { shopeeOrderId: "SP004" } });
    expect(lines.map((line) => line.cancelReceiptStatus)).toEqual(["received_full", "received_full"]);
  });

  it("does not overwrite an order that already has a receipt date or a status", async () => {
    await seedOrder("DATED", { cancelReceivedAt: new Date("2026-10-25T00:00:00.000Z"), cancelReceiptStatus: "received_full" });
    await seedOrder("PARTIAL", { cancelReceiptStatus: "received_partial", defectRate: 0.2 });
    await seedOrder("SKIPPED", { cancelReceiptStatus: "not_needed" });
    await seedLog(["DATED", "PARTIAL", "SKIPPED"], "2026-10-22T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders).toEqual([]);
    const dated = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "DATED" } });
    expect(dated.cancelReceivedAt?.toISOString()).toBe("2026-10-25T00:00:00.000Z");
    const partial = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "PARTIAL" } });
    expect(partial.cancelReceiptStatus).toBe("received_partial");
    expect(partial.cancelReceivedAt).toBeNull();
    expect((await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "SKIPPED" } })).cancelReceiptStatus).toBe("not_needed");
  });

  it("uses the latest message when an order was reported twice, as the live flow does", async () => {
    await seedOrder("SP005");
    await seedLog(["SP005"], "2026-10-20T03:00:00.000Z");
    await seedLog(["SP005"], "2026-10-24T03:00:00.000Z");

    await replayCancelReceipts({ until: UNTIL, apply: true });

    const order = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "SP005" } });
    expect(order.cancelReceivedAt?.toISOString()).toBe("2026-10-24T03:00:00.000Z");
  });

  it("picks up the codes a partly matched message left over, and is a no-op the second time", async () => {
    await seedOrder("HAS", { cancelReceiptStatus: "received_full", cancelReceivedAt: new Date("2026-10-20T03:00:00.000Z") });
    await seedOrder("LATE");
    const log = await seedLog(["HAS", "LATE"], "2026-10-20T03:00:00.000Z", { matchedCount: 1 });

    const first = await replayCancelReceipts({ until: UNTIL, apply: true });
    const second = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(first.mappedOrders).toEqual(["LATE"]);
    expect(second.mappedOrders).toEqual([]);
    expect((await prisma.zaloCancelReceiptLog.findUniqueOrThrow({ where: { id: log.id } })).matchedCount).toBe(2);
  });

  it("leaves a message whose codes still match nothing alone", async () => {
    const log = await seedLog(["NOPE"], "2026-10-20T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders).toEqual([]);
    expect(result.stillUnmatched).toEqual(["NOPE"]);
    expect((await prisma.zaloCancelReceiptLog.findUniqueOrThrow({ where: { id: log.id } })).matchedCount).toBe(0);
  });

  it("flags orders mapped from a manual scan, whose chosen status and % hỏng were never logged", async () => {
    await seedOrder("SCANNED");
    await seedOrder("ZALO");
    await seedLog(["SCANNED"], "2026-10-20T03:00:00.000Z", { threadId: "manual-scan" });
    await seedLog(["ZALO"], "2026-10-21T03:00:00.000Z");

    const result = await replayCancelReceipts({ until: UNTIL, apply: true });

    expect(result.mappedOrders.sort()).toEqual(["SCANNED", "ZALO"]);
    expect(result.fromManualScan).toEqual(["SCANNED"]);
  });
});

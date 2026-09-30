import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadCancellationSummaries } from "@/lib/report/cancellationLookup";

async function seedCancellation(shopeeOrderId: string, type: "cancelled" | "delivery_failed" | "returned_refunded", returnTrackingCode?: string) {
  return prisma.cancellation.create({
    data: { shopeeOrderId, type, returnTrackingCode: returnTrackingCode ?? null, rawRowHash: "seed", sheetRowIndex: 1 },
  });
}

describe("loadCancellationSummaries", () => {
  beforeEach(async () => {
    await prisma.cancellation.deleteMany();
  });

  it("returns an empty map for an empty id list without querying", async () => {
    expect(await loadCancellationSummaries([])).toEqual(new Map());
  });

  it("groups multiple cancellation types for the same order", async () => {
    await seedCancellation("SP001", "delivery_failed");
    await seedCancellation("SP001", "returned_refunded", "SPXVN0000001");

    const map = await loadCancellationSummaries(["SP001"]);
    expect(map.get("SP001")?.types.sort()).toEqual(["delivery_failed", "returned_refunded"]);
    expect(map.get("SP001")?.returnTrackingCode).toBe("SPXVN0000001");
  });

  it("leaves returnTrackingCode null when there's no returned_refunded row", async () => {
    await seedCancellation("SP002", "cancelled");

    const map = await loadCancellationSummaries(["SP002"]);
    expect(map.get("SP002")?.returnTrackingCode).toBeNull();
  });

  it("ignores inactive (soft-deleted) cancellation rows", async () => {
    const row = await seedCancellation("SP003", "cancelled");
    await prisma.cancellation.update({ where: { id: row.id }, data: { isActive: false } });

    const map = await loadCancellationSummaries(["SP003"]);
    expect(map.has("SP003")).toBe(false);
  });

  it("omits an order with no cancellation rows entirely from the map", async () => {
    const map = await loadCancellationSummaries(["SP004"]);
    expect(map.has("SP004")).toBe(false);
  });

  afterAll(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.$disconnect();
  });
});

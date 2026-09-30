import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadCancellationRows, parseCancellationFilters } from "@/lib/cancellation/loadCancellationRows";

async function seedCancellation(shopeeOrderId: string, type: "cancelled" | "delivery_failed" | "returned_refunded") {
  return prisma.cancellation.create({
    data: { shopeeOrderId, type, rawRowHash: "seed", sheetRowIndex: 1 },
  });
}

describe("parseCancellationFilters", () => {
  it("defaults to no type filter when absent", () => {
    expect(parseCancellationFilters({})).toEqual({ types: [] });
  });

  it("wraps a single repeated value into a one-element array", () => {
    expect(parseCancellationFilters({ type: "cancelled" })).toEqual({ types: ["cancelled"] });
  });

  it("keeps multiple repeated values as an array", () => {
    expect(parseCancellationFilters({ type: ["cancelled", "delivery_failed"] })).toEqual({
      types: ["cancelled", "delivery_failed"],
    });
  });
});

describe("loadCancellationRows", () => {
  beforeEach(async () => {
    await prisma.cancellation.deleteMany();
  });

  // "cancelled" (4.1 Đơn hủy) is deliberately excluded from this page —
  // per explicit feedback, Luân doesn't care about those.
  it("excludes 'cancelled' rows even when no type filter is set", async () => {
    await seedCancellation("SP001", "cancelled");
    await seedCancellation("SP002", "delivery_failed");
    await seedCancellation("SP003", "returned_refunded");

    const rows = await loadCancellationRows({ types: [] });
    expect(rows.map((r) => r.shopeeOrderId).sort()).toEqual(["SP002", "SP003"]);
  });

  it("filters down to the selected types only", async () => {
    await seedCancellation("SP001", "cancelled");
    await seedCancellation("SP002", "delivery_failed");
    await seedCancellation("SP003", "returned_refunded");

    const rows = await loadCancellationRows({ types: ["returned_refunded"] });
    expect(rows.map((r) => r.shopeeOrderId).sort()).toEqual(["SP003"]);
  });

  it("still excludes 'cancelled' even if hand-crafted into the type filter", async () => {
    await seedCancellation("SP001", "cancelled");
    await seedCancellation("SP002", "delivery_failed");

    const rows = await loadCancellationRows({ types: ["cancelled", "delivery_failed"] });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual(["SP002"]);
  });

  it("excludes soft-deleted rows", async () => {
    const row = await seedCancellation("SP002", "delivery_failed");
    await prisma.cancellation.update({ where: { id: row.id }, data: { isActive: false } });

    const rows = await loadCancellationRows({ types: [] });
    expect(rows).toHaveLength(0);
  });

  afterAll(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.$disconnect();
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadCancellationRows, parseCancellationFilters } from "@/lib/cancellation/loadCancellationRows";

async function seedCancellation(
  shopeeOrderId: string,
  type: "cancelled" | "delivery_failed" | "returned_refunded",
  extra: { trackingCode?: string; returnTrackingCode?: string } = {}
) {
  return prisma.cancellation.create({
    data: { shopeeOrderId, type, rawRowHash: "seed", sheetRowIndex: 1, ...extra },
  });
}

describe("parseCancellationFilters", () => {
  it("defaults to no type filter and empty search when absent", () => {
    expect(parseCancellationFilters({})).toEqual({ types: [], q: "" });
  });

  it("wraps a single repeated value into a one-element array", () => {
    expect(parseCancellationFilters({ type: "cancelled" })).toEqual({ types: ["cancelled"], q: "" });
  });

  it("keeps multiple repeated values as an array", () => {
    expect(parseCancellationFilters({ type: ["cancelled", "delivery_failed"] })).toEqual({
      types: ["cancelled", "delivery_failed"],
      q: "",
    });
  });

  it("trims whitespace from the search query", () => {
    expect(parseCancellationFilters({ q: "  SP001  " })).toEqual({ types: [], q: "SP001" });
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

    const rows = await loadCancellationRows({ types: [], q: "" });
    expect(rows.map((r) => r.shopeeOrderId).sort()).toEqual(["SP002", "SP003"]);
  });

  it("filters down to the selected types only", async () => {
    await seedCancellation("SP001", "cancelled");
    await seedCancellation("SP002", "delivery_failed");
    await seedCancellation("SP003", "returned_refunded");

    const rows = await loadCancellationRows({ types: ["returned_refunded"], q: "" });
    expect(rows.map((r) => r.shopeeOrderId).sort()).toEqual(["SP003"]);
  });

  it("still excludes 'cancelled' even if hand-crafted into the type filter", async () => {
    await seedCancellation("SP001", "cancelled");
    await seedCancellation("SP002", "delivery_failed");

    const rows = await loadCancellationRows({ types: ["cancelled", "delivery_failed"], q: "" });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual(["SP002"]);
  });

  it("excludes soft-deleted rows", async () => {
    const row = await seedCancellation("SP002", "delivery_failed");
    await prisma.cancellation.update({ where: { id: row.id }, data: { isActive: false } });

    const rows = await loadCancellationRows({ types: [], q: "" });
    expect(rows).toHaveLength(0);
  });

  it("searches by shopeeOrderId", async () => {
    await seedCancellation("SP001", "delivery_failed");
    await seedCancellation("SP002", "delivery_failed");

    const rows = await loadCancellationRows({ types: [], q: "SP001" });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual(["SP001"]);
  });

  it("searches by the outbound trackingCode", async () => {
    await seedCancellation("SP001", "delivery_failed", { trackingCode: "SPXVN00000001" });
    await seedCancellation("SP002", "delivery_failed", { trackingCode: "SPXVN00000002" });

    const rows = await loadCancellationRows({ types: [], q: "SPXVN00000001" });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual(["SP001"]);
  });

  it("searches by returnTrackingCode", async () => {
    await seedCancellation("SP001", "returned_refunded", { returnTrackingCode: "SPXVN99999991" });
    await seedCancellation("SP002", "returned_refunded", { returnTrackingCode: "SPXVN99999992" });

    const rows = await loadCancellationRows({ types: [], q: "SPXVN99999991" });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual(["SP001"]);
  });

  afterAll(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.$disconnect();
  });
});

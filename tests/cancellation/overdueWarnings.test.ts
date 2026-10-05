import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadOverdueWarnings } from "@/lib/cancellation/overdueWarnings";

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function seedOrder(shopeeOrderId: string, extra: Record<string, unknown> = {}) {
  return prisma.order.create({
    data: {
      shopeeOrderId,
      categoryName: "D100",
      status: "Hoàn thành",
      rawRowHash: "seed",
      sheetRowIndex: 1,
      ...extra,
    },
  });
}

async function seedCancellation(
  shopeeOrderId: string,
  type: "delivery_failed" | "returned_refunded",
  extra: Record<string, unknown> = {}
) {
  return prisma.cancellation.create({
    data: { shopeeOrderId, type, rawRowHash: "seed", sheetRowIndex: 1, ...extra },
  });
}

describe("loadOverdueWarnings", () => {
  beforeEach(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
  });

  it("flags a THHT (returned_refunded) row overdue past 5 days with no status filled in", async () => {
    await seedOrder("SPOV001");
    await seedCancellation("SPOV001", "returned_refunded", { complaintAt: hoursAgo(5 * 24 + 1) });

    const warnings = await loadOverdueWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ shopeeOrderId: "SPOV001", type: "returned_refunded", alreadyWarned: false });
    expect(warnings[0].daysOverdue).toBeGreaterThanOrEqual(5);
  });

  it("does not flag a THHT row still under 5 days", async () => {
    await seedOrder("SPOV002");
    await seedCancellation("SPOV002", "returned_refunded", { complaintAt: hoursAgo(5 * 24 - 1) });

    expect(await loadOverdueWarnings()).toHaveLength(0);
  });

  it("flags a delivery_failed row overdue past 1 day with no status filled in", async () => {
    await seedOrder("SPOV003");
    await seedCancellation("SPOV003", "delivery_failed", { cancelledAt: hoursAgo(24 + 1) });

    const warnings = await loadOverdueWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ shopeeOrderId: "SPOV003", type: "delivery_failed" });
  });

  it("does not flag a delivery_failed row still under 1 day", async () => {
    await seedOrder("SPOV004");
    await seedCancellation("SPOV004", "delivery_failed", { cancelledAt: hoursAgo(1) });

    expect(await loadOverdueWarnings()).toHaveLength(0);
  });

  it("stops flagging once cancelReceiptStatus is filled in", async () => {
    await seedOrder("SPOV005", { cancelReceiptStatus: "received_full" });
    await seedCancellation("SPOV005", "returned_refunded", { complaintAt: hoursAgo(5 * 24 + 1) });

    expect(await loadOverdueWarnings()).toHaveLength(0);
  });

  it("stops flagging once cancelComplaintNote is filled in", async () => {
    await seedOrder("SPOV006", { cancelComplaintNote: "Đang xử lý" });
    await seedCancellation("SPOV006", "returned_refunded", { complaintAt: hoursAgo(5 * 24 + 1) });

    expect(await loadOverdueWarnings()).toHaveLength(0);
  });

  it("ignores rows with no trigger timestamp at all", async () => {
    await seedOrder("SPOV007");
    await seedCancellation("SPOV007", "returned_refunded", { complaintAt: null });

    expect(await loadOverdueWarnings()).toHaveLength(0);
  });

  it("reports alreadyWarned true when overdueWarnedAt is set, but still includes the row", async () => {
    await seedOrder("SPOV008");
    await seedCancellation("SPOV008", "returned_refunded", {
      complaintAt: hoursAgo(5 * 24 + 1),
      overdueWarnedAt: hoursAgo(1),
    });

    const warnings = await loadOverdueWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].alreadyWarned).toBe(true);
  });

  afterAll(async () => {
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

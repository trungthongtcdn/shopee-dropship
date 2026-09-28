import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadDistinctOrderStatuses } from "@/lib/report/loadReportRows";

async function seedOrder(shopeeOrderId: string, status: string) {
  return prisma.order.create({
    data: { shopeeOrderId, categoryName: `cat-${shopeeOrderId}`, status, rawRowHash: "seed", sheetRowIndex: 1 },
  });
}

describe("loadDistinctOrderStatuses", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  it("includes a normal short status category", async () => {
    await seedOrder("SP001", "Hoàn thành");
    expect(await loadDistinctOrderStatuses()).toEqual(["Hoàn thành"]);
  });

  it("excludes an auto-generated long sentence status (e.g. the return-window notice)", async () => {
    await seedOrder("SP001", "Hoàn thành");
    await seedOrder(
      "SP002",
      "Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày 2026-09-10."
    );

    expect(await loadDistinctOrderStatuses()).toEqual(["Hoàn thành"]);
  });

  it("does not let the option list grow with one near-duplicate long status per day", async () => {
    await seedOrder("SP001", "Hoàn thành");
    for (let day = 1; day <= 30; day++) {
      await seedOrder(
        `SP-LONG-${day}`,
        `Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày 2026-09-${day}.`
      );
    }

    expect(await loadDistinctOrderStatuses()).toEqual(["Hoàn thành"]);
  });

  afterAll(async () => {
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

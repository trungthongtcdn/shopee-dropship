import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { loadOrderStatusFilterOptions } from "@/lib/report/loadReportRows";
import { STATUS_OTHER_VALUE } from "@/lib/report/filters";

async function seedOrder(shopeeOrderId: string, status: string) {
  return prisma.order.create({
    data: { shopeeOrderId, categoryName: `cat-${shopeeOrderId}`, status, rawRowHash: "seed", sheetRowIndex: 1 },
  });
}

const LONG_STATUS_TEMPLATE = (day: number) =>
  `Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày 2026-09-${day}.`;

describe("loadOrderStatusFilterOptions", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  it("includes a normal short status category as its own pill", async () => {
    await seedOrder("SP001", "Hoàn thành");
    expect(await loadOrderStatusFilterOptions()).toEqual([{ value: "Hoàn thành", label: "Hoàn thành" }]);
  });

  it("groups an auto-generated long sentence status into a single 'Khác' option", async () => {
    await seedOrder("SP001", "Hoàn thành");
    await seedOrder("SP002", LONG_STATUS_TEMPLATE(10));

    expect(await loadOrderStatusFilterOptions()).toEqual([
      { value: "Hoàn thành", label: "Hoàn thành" },
      { value: STATUS_OTHER_VALUE, label: "Khác" },
    ]);
  });

  it("still collapses to a single 'Khác' option with one near-duplicate long status per day", async () => {
    await seedOrder("SP001", "Hoàn thành");
    for (let day = 1; day <= 30; day++) {
      await seedOrder(`SP-LONG-${day}`, LONG_STATUS_TEMPLATE(day));
    }

    expect(await loadOrderStatusFilterOptions()).toEqual([
      { value: "Hoàn thành", label: "Hoàn thành" },
      { value: STATUS_OTHER_VALUE, label: "Khác" },
    ]);
  });

  it("omits the 'Khác' option entirely when no status is long", async () => {
    await seedOrder("SP001", "Hoàn thành");
    await seedOrder("SP002", "Đã huỷ");
    const options = await loadOrderStatusFilterOptions();
    expect(options).toHaveLength(2);
    expect(options).toEqual(expect.arrayContaining([{ value: "Hoàn thành", label: "Hoàn thành" }, { value: "Đã huỷ", label: "Đã huỷ" }]));
  });

  afterAll(async () => {
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

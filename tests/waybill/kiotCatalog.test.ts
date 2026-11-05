import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { KiotCatalog, PrismaKiotStore } from "@/lib/kiot";
import type { WaybillPage } from "@/lib/waybill/items";

// The real "GIÁ FULL" tab: one kho column per shop after the price column.
const SHEET = [
  "STT,mã hàng kiot,kho kiot,sku shopee,ghi chú,đơn vị TÍNH,Giá nhập MỚI NHẤT (t7),THE THAO,FASTFIX,QUATUNI",
  ",1BanhXe,kho56,1BanhXe,,,4.150,khoLuan,khoLuan,khoLuan",
  ",ChanGheXoay,kho56,ChanGheXoay,,,77.500,khouni,khouni,khoLuan",
].join("\n");

const page = (id: string, sku: string, shopName?: string): WaybillPage => ({
  pageIndex: 0,
  shopeeOrderId: id,
  trackingCode: `SPXVN_${id}`,
  declaredTotalQuantity: 1,
  items: [{ name: "x", variant: "", quantity: 1, sku }],
  ...(shopName ? { shopName } : {}),
});

describe("PrismaKiotStore", () => {
  beforeEach(async () => {
    await prisma.kiotSnapshot.deleteMany();
  });

  it("has nothing before the first save, then gives back what was saved, and a second save replaces it", async () => {
    const store = new PrismaKiotStore();
    expect(await store.load()).toBeNull();

    const record = { sku: "A", kiotCode: "A", store: "kho56", cost: 1000, deliveries: { fastfix: "khouni" } };
    await store.save({ records: [record], syncedAt: new Date("2026-11-05T01:00:00Z") });
    expect(await store.load()).toEqual({ records: [record], syncedAt: new Date("2026-11-05T01:00:00Z") });

    await store.save({ records: [{ ...record, sku: "B" }], syncedAt: new Date("2026-11-06T01:00:00Z") });
    expect((await store.load())?.records.map((r) => r.sku)).toEqual(["B"]);
    expect(await prisma.kiotSnapshot.count()).toBe(1);
  });

  it("drops stored rows that are not records instead of failing", async () => {
    await prisma.kiotSnapshot.create({ data: { id: 1, syncedAt: new Date(), records: [{ sku: "A", kiotCode: "A", store: "s", cost: null }, { nonsense: true }, "x"] } });
    expect((await new PrismaKiotStore().load())?.records.map((r) => r.sku)).toEqual(["A"]);
  });
});

describe("KiotCatalog on the shop's own database", () => {
  beforeEach(async () => {
    await prisma.kiotSnapshot.deleteMany();
  });

  const catalog = (fetchCsv = vi.fn(async () => SHEET)) => ({ fetchCsv, catalog: new KiotCatalog(new PrismaKiotStore(), { fetchCsv, now: () => Date.parse("2026-11-05T01:00:00Z") }) });

  it("fetches the sheet once, keeps it, and gives each order's lines their Kiot code, store and kho gửi", async () => {
    const { catalog: kiot, fetchCsv } = catalog();

    const first = await kiot.mapPages([page("A", "1BanhXe", "FASTFIX.VN"), page("B", "ChanGheXoay", "FASTFIX.VN")]);
    const second = await kiot.mapPages([page("C", "ChanGheXoay", "Kho Quạt Thông Gió LCN")]);

    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(first.pages.map((p) => p.items[0].kiotLines)).toEqual([
      [{ sku: "1BanhXe", quantity: 1, kiotCode: "1BanhXe", kiotStore: "kho56", khoGiao: "khoLuan" }],
      [{ sku: "ChanGheXoay", quantity: 1, kiotCode: "ChanGheXoay", kiotStore: "kho56", khoGiao: "khouni" }],
    ]);
    expect(second.pages[0].items[0].kiotLines?.[0].khoGiao).toBe("khoLuan");
    expect(first.khoOptions).toEqual(["khoLuan", "khouni"]);
    expect(await prisma.kiotSnapshot.count()).toBe(1);
  });

  it("is the stored copy another catalog starts from, without fetching again", async () => {
    await catalog().catalog.mapPages([page("A", "1BanhXe")]);
    const { catalog: later, fetchCsv } = catalog();

    const mapped = await later.mapPages([page("B", "1BanhXe", "FASTFIX.VN")]);

    expect(fetchCsv).not.toHaveBeenCalled();
    expect(mapped.pages[0].items[0].kiotLines?.[0].kiotCode).toBe("1BanhXe");
  });

  it("tells about SKUs the sheet doesn't have, and about a shop it can't place where its columns disagree", async () => {
    const { catalog: kiot } = catalog();
    const { notices } = await kiot.mapPages([page("A", "NoSuchSku", "FASTFIX.VN"), page("B", "ChanGheXoay", "Shop Lạ")]);

    expect(notices.some((n) => /1 SKU chưa có trong bảng GIÁ FULL.*NoSuchSku/.test(n))).toBe(true);
    expect(notices.some((n) => /"Shop Lạ" chưa khớp cột shop nào.*điền tay/.test(n))).toBe(true);
  });

  it("does not throw when the sheet can't be fetched, and says so", async () => {
    const { catalog: kiot } = catalog(vi.fn(async () => Promise.reject(new Error("offline"))));
    const mapped = await kiot.mapPages([page("A", "1BanhXe")]);
    expect(mapped.pages[0].items[0].kiotLines).toBeUndefined();
    expect(mapped.notices[0]).toMatch(/Không tải được bảng GIÁ FULL/);
  });
});

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { PrismaSkuStore } from "@/lib/skus";
import { toSkuRecords } from "@/lib/waybill/skuMap";

beforeEach(async () => {
  await prisma.skuMapping.deleteMany();
});

afterAll(async () => {
  await prisma.skuMapping.deleteMany();
  await prisma.$disconnect();
});

describe("PrismaSkuStore", () => {
  it("has no list before the first sync", async () => {
    expect(await new PrismaSkuStore().load()).toBeNull();
  });

  it("returns what was saved, with the SKU ánh xạ stored next to each SKU", async () => {
    const store = new PrismaSkuStore();
    const records = toSkuRecords(["TyHoi_D160_Den", "Vi da nau", "TyHoi_D160_Den"]);
    const syncedAt = new Date("2026-10-12T08:00:00Z");
    await store.save({ records, syncedAt });

    const loaded = await store.load();
    expect(loaded?.syncedAt).toEqual(syncedAt);
    expect([...(loaded?.records ?? [])].sort((a, b) => a.sku.localeCompare(b.sku))).toEqual(
      [...records].sort((a, b) => a.sku.localeCompare(b.sku))
    );
    const row = await prisma.skuMapping.findUnique({ where: { sku: "TyHoi_D160_Den" } });
    expect(row).toMatchObject({ mappedKey: "TyHoiD160Den", foldKey: "tyhoid160den", rows: 2 });
  });

  it("replaces the whole list on each save", async () => {
    const store = new PrismaSkuStore();
    await store.save({ records: toSkuRecords(["Old_1", "Old_2"]), syncedAt: new Date("2026-10-11T08:00:00Z") });
    await store.save({ records: toSkuRecords(["New_1"]), syncedAt: new Date("2026-10-12T08:00:00Z") });
    const loaded = await store.load();
    expect(loaded?.records.map((r) => r.sku)).toEqual(["New_1"]);
    expect(loaded?.syncedAt).toEqual(new Date("2026-10-12T08:00:00Z"));
  });
});

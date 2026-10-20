import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { clientFor, prisma, sharedPrisma } from "@/lib/db";
import { runWithShop } from "@/lib/shops/context";
import { PrismaSkuStore, skuCatalog } from "@/lib/skus";
import { toSkuRecords } from "@/lib/waybill/skuMap";
import { createTestShop, dropTestShop } from "../helpers/testShop";

const OTHER = "shop_9";

describe("the SKU list is per shop", () => {
  beforeAll(async () => {
    await createTestShop(OTHER);
    await runWithShop("shop_1", () => prisma.skuMapping.deleteMany());
  }, 120_000);

  afterAll(async () => {
    await dropTestShop(OTHER);
    await runWithShop("shop_1", () => prisma.skuMapping.deleteMany());
    await sharedPrisma.$disconnect();
  });

  it("a list saved for one shop is not the other shop's list", async () => {
    const second = new PrismaSkuStore(clientFor(OTHER));
    await second.save({ records: toSkuRecords(["Ty_Hoi_Den"]), syncedAt: new Date("2026-10-20T00:00:00Z") });

    expect(await new PrismaSkuStore(clientFor("shop_1")).load()).toBeNull();
    expect((await second.load())?.records.map((r) => r.sku)).toEqual(["Ty_Hoi_Den"]);
  });

  it("each shop gets its own catalog, and the same shop keeps getting the same one", async () => {
    const first = await runWithShop("shop_1", () => skuCatalog());
    const again = await runWithShop("shop_1", () => skuCatalog());
    const second = await runWithShop(OTHER, () => skuCatalog());
    expect(again).toBe(first);
    expect(second).not.toBe(first);
  });
});

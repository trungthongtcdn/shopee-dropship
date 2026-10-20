import { describe, it, expect, afterEach, afterAll } from "vitest";
import { prisma, sharedPrisma } from "@/lib/db";
import { runWithShop } from "@/lib/shops/context";
import { addShop, migrateAllShops, migrateShopSchema } from "@/lib/shops/provision";
import { listShops, shopForSecret } from "@/lib/shops/registry";
import { dropTestShop } from "../helpers/testShop";

async function removeAddedShops() {
  for (const shop of await listShops()) {
    if (shop.slug !== "shop_1") await dropTestShop(shop.slug);
  }
}

afterEach(removeAddedShops, 60_000);
afterAll(async () => {
  await sharedPrisma.$disconnect();
});

describe("addShop", () => {
  it("builds an empty schema, lists the shop and hands out a working secret once", async () => {
    const { shop, secret } = await addShop({ name: "  Kho   Hà Nội ", skuSheetUrl: "https://docs.google.com/spreadsheets/d/x/export?format=csv" });

    expect(shop).toMatchObject({ slug: "shop_2", name: "Kho Hà Nội", skuSheetUrl: "https://docs.google.com/spreadsheets/d/x/export?format=csv" });
    expect(await runWithShop("shop_2", () => prisma.order.count())).toBe(0);
    expect(await shopForSecret(secret)).toMatchObject({ slug: "shop_2" });

    const stored = await sharedPrisma.shop.findUnique({ where: { slug: "shop_2" } });
    expect(stored?.secretHash).not.toBeNull();
    expect(stored?.secretHash).not.toContain(secret);
  }, 60_000);

  it("numbers the next shop after the highest one", async () => {
    await addShop({ name: "Một" });
    const second = await addShop({ name: "Hai" });
    expect(second.shop.slug).toBe("shop_3");
  }, 60_000);

  it("refuses a name that is taken (any letter case), blank or too long, and creates nothing", async () => {
    await addShop({ name: "Kho Hà Nội" });
    const before = (await listShops()).length;
    await expect(addShop({ name: "kho hà nội" })).rejects.toThrow("Đã có shop tên này");
    await expect(addShop({ name: "   " })).rejects.toThrow();
    await expect(addShop({ name: "x".repeat(41) })).rejects.toThrow();
    expect((await listShops()).length).toBe(before);
  }, 60_000);

  it("refuses a sheet link that is not https", async () => {
    await expect(addShop({ name: "Lạ", skuSheetUrl: "http://example.com/x.csv" })).rejects.toThrow("https");
    await expect(addShop({ name: "Lạ", skuSheetUrl: "không phải link" })).rejects.toThrow();
    expect((await listShops()).map((s) => s.slug)).toEqual(["shop_1"]);
  }, 60_000);
});

describe("migrateShopSchema / migrateAllShops", () => {
  it("can be repeated on a shop that already exists without touching its data", async () => {
    await addShop({ name: "Kho Hà Nội" });
    await runWithShop("shop_2", () =>
      prisma.order.create({ data: { shopeeOrderId: "KEEP", categoryName: "", status: "pending", rawRowHash: "h", sheetRowIndex: 2 } })
    );

    await migrateShopSchema("shop_2");
    expect(await migrateAllShops()).toEqual(["shop_2"]);

    expect(await runWithShop("shop_2", () => prisma.order.count())).toBe(1);
  }, 120_000);

  it("rejects slugs that are not shops", async () => {
    for (const bad of ["public", "shop_2; DROP SCHEMA public", "", "Shop_2"]) {
      await expect(migrateShopSchema(bad)).rejects.toThrow("Invalid shop slug");
    }
  });

  it("leaves the first shop to the normal migration", async () => {
    await expect(migrateShopSchema("shop_1")).resolves.toBeUndefined();
  });
});

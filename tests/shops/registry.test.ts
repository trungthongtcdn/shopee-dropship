import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { sharedPrisma } from "@/lib/db";
import { getShop, hashSecret, listShops, normalizeShopName, renameShop, shopForSecret, generateSecret } from "@/lib/shops/registry";

const EXTRA = "shop_8";
const ORIGINAL_SECRET = process.env.SYNC_WEBHOOK_SECRET;

async function cleanExtra() {
  await sharedPrisma.shop.deleteMany({ where: { slug: EXTRA } });
}

describe("shop registry", () => {
  beforeEach(cleanExtra);
  afterEach(async () => {
    await cleanExtra();
    await sharedPrisma.shop.update({ where: { slug: "shop_1" }, data: { name: "Shop 1" } });
    if (ORIGINAL_SECRET === undefined) delete process.env.SYNC_WEBHOOK_SECRET;
    else process.env.SYNC_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });
  afterAll(async () => {
    await sharedPrisma.$disconnect();
  });

  it("lists the first shop, seeded by the migration", async () => {
    const shops = await listShops();
    expect(shops[0]).toMatchObject({ slug: "shop_1", name: "Shop 1", skuSheetUrl: null });
    expect(await getShop("shop_1")).toMatchObject({ slug: "shop_1" });
    expect(await getShop("shop_77")).toBeNull();
  });

  describe("normalizeShopName", () => {
    it("trims and collapses whitespace", () => {
      expect(normalizeShopName("  MII   Furniture ")).toEqual({ ok: true, name: "MII Furniture" });
    });

    it("rejects empty, blank, too long and non-string names", () => {
      for (const bad of ["", "   ", "x".repeat(41), null, 5]) {
        expect(normalizeShopName(bad).ok).toBe(false);
      }
      expect(normalizeShopName("x".repeat(40)).ok).toBe(true);
    });
  });

  describe("renameShop", () => {
    it("renames a shop", async () => {
      const first = (await getShop("shop_1"))!;
      const result = await renameShop(first.id, "MII Furniture");
      expect(result).toMatchObject({ ok: true, shop: { slug: "shop_1", name: "MII Furniture" } });
      expect((await getShop("shop_1"))!.name).toBe("MII Furniture");
    });

    it("keeps markup as plain text", async () => {
      const first = (await getShop("shop_1"))!;
      const result = await renameShop(first.id, "<script>x</script>");
      expect(result).toMatchObject({ ok: true, shop: { name: "<script>x</script>" } });
    });

    it("refuses blank and over-long names with 400", async () => {
      const first = (await getShop("shop_1"))!;
      expect(await renameShop(first.id, "   ")).toMatchObject({ ok: false, status: 400 });
      expect(await renameShop(first.id, "x".repeat(41))).toMatchObject({ ok: false, status: 400 });
    });

    it("refuses another shop's name in any letter case with 409, but allows keeping its own", async () => {
      const other = await sharedPrisma.shop.create({ data: { slug: EXTRA, name: "Kho Hà Nội" } });
      const first = (await getShop("shop_1"))!;
      expect(await renameShop(first.id, "kho hà nội")).toMatchObject({ ok: false, status: 409 });
      expect(await renameShop(other.id, "KHO HÀ NỘI")).toMatchObject({ ok: true });
    });

    it("404 for an unknown id", async () => {
      expect(await renameShop(999999, "Whatever")).toMatchObject({ ok: false, status: 404 });
    });
  });

  describe("shopForSecret", () => {
    it("never matches a missing or empty secret, even with no env secret set", async () => {
      delete process.env.SYNC_WEBHOOK_SECRET;
      await sharedPrisma.shop.create({ data: { slug: EXTRA, name: "Extra" } });
      expect(await shopForSecret(null)).toBeNull();
      expect(await shopForSecret("")).toBeNull();
    });

    it("maps the env secret to the first shop", async () => {
      process.env.SYNC_WEBHOOK_SECRET = "env-secret";
      expect(await shopForSecret("env-secret")).toMatchObject({ slug: "shop_1" });
      expect(await shopForSecret("env-secreu")).toBeNull();
    });

    it("maps a stored hash to its shop", async () => {
      await sharedPrisma.shop.create({ data: { slug: EXTRA, name: "Extra", secretHash: hashSecret("abc") } });
      expect(await shopForSecret("abc")).toMatchObject({ slug: EXTRA });
      expect(await shopForSecret("abd")).toBeNull();
    });
  });

  it("generates long hex secrets that hash consistently", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[0-9a-f]{48}$/);
    expect(hashSecret(secret)).toBe(hashSecret(secret));
    expect(hashSecret(secret)).toMatch(/^[0-9a-f]{64}$/);
  });
});

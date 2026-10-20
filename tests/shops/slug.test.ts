import { describe, it, expect } from "vitest";
import { isShopSlug, PRIMARY_SLUG, schemaFor, shopDatabaseUrl } from "@/lib/shops/slug";

describe("isShopSlug", () => {
  it("accepts shop_<number>", () => {
    expect(isShopSlug("shop_1")).toBe(true);
    expect(isShopSlug("shop_2")).toBe(true);
    expect(isShopSlug("shop_999")).toBe(true);
  });

  it("rejects anything else, so a slug can never carry SQL or a foreign schema name", () => {
    for (const bad of ["shop_0", "shop_1000", "public", "shop_2; DROP", "Shop_2", "shop_", "", undefined, null, 2]) {
      expect(isShopSlug(bad)).toBe(false);
    }
  });
});

describe("schemaFor", () => {
  it("keeps the first shop in the existing public schema", () => {
    expect(PRIMARY_SLUG).toBe("shop_1");
    expect(schemaFor("shop_1")).toBe("public");
    expect(schemaFor("shop_2")).toBe("shop_2");
  });
});

describe("shopDatabaseUrl", () => {
  const base = "postgresql://u:p@h:5432/db";

  it("returns the base url untouched for the first shop", () => {
    expect(shopDatabaseUrl(base, "shop_1")).toBe(base);
  });

  it("points other shops at their own schema and keeps other parameters", () => {
    const url = new URL(shopDatabaseUrl(`${base}?connection_limit=5`, "shop_2"));
    expect(url.searchParams.get("schema")).toBe("shop_2");
    expect(url.searchParams.get("connection_limit")).toBe("5");
    expect(url.pathname).toBe("/db");
  });

  it("replaces a schema already in the base url", () => {
    const url = new URL(shopDatabaseUrl(`${base}?schema=public`, "shop_3"));
    expect(url.searchParams.getAll("schema")).toEqual(["shop_3"]);
  });
});

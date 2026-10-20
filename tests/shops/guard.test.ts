import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { sharedPrisma } from "@/lib/db";
import { currentShopSlug } from "@/lib/shops/context";
import { withShop } from "@/lib/shops/guard";

const handler = withShop(async (_request: NextRequest, _context: unknown, shop) =>
  NextResponse.json({ seen: currentShopSlug(), shop: shop.slug })
);
const writeHandler = withShop(async () => NextResponse.json({ ok: true, seen: currentShopSlug() }), { check: "header" });
const downloadHandler = withShop(async () => NextResponse.json({ ok: true }), { check: "query" });

function request(path = "/api/x", init: { cookie?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await sharedPrisma.shop.deleteMany({ where: { slug: "shop_7" } });
});

afterAll(async () => {
  await sharedPrisma.$disconnect();
});

describe("withShop", () => {
  it("runs the handler in the first shop when the browser has not picked one", async () => {
    const response = await handler(request());
    expect(await response.json()).toEqual({ seen: "shop_1", shop: "shop_1" });
  });

  it("runs the handler in the shop named by the cookie", async () => {
    await sharedPrisma.shop.create({ data: { slug: "shop_7", name: "Seven" } });
    const response = await handler(request("/api/x", { cookie: "shop=shop_7" }));
    expect(await response.json()).toEqual({ seen: "shop_7", shop: "shop_7" });
  });

  it("answers 409 shop_unknown, not 500, for a cookie naming a shop that does not exist", async () => {
    const response = await handler(request("/api/x", { cookie: "shop=shop_77" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("shop_unknown");
  });

  it("treats a malformed cookie as no cookie", async () => {
    const response = await handler(request("/api/x", { cookie: "shop=%27%3B--" }));
    expect((await response.json()).seen).toBe("shop_1");
  });

  describe("check: header (writes)", () => {
    it("refuses a write from a tab rendered for another shop", async () => {
      const response = await writeHandler(request("/api/x", { cookie: "shop=shop_1", headers: { "x-shop": "shop_2" } }));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("shop_mismatch");
    });

    it("lets a write through when the tab's shop is the current one", async () => {
      const response = await writeHandler(request("/api/x", { headers: { "x-shop": "shop_1" } }));
      expect(response.status).toBe(200);
    });

    it("allows a missing header in dev/test but not in production", async () => {
      expect((await writeHandler(request())).status).toBe(200);
      vi.stubEnv("NODE_ENV", "production");
      const response = await writeHandler(request());
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("shop_missing");
    });
  });

  describe("check: query (downloads)", () => {
    it("refuses a link made for another shop", async () => {
      const response = await downloadHandler(request("/api/x?shop=shop_2"));
      expect(response.status).toBe(409);
    });

    it("serves a link made for the current shop", async () => {
      const response = await downloadHandler(request("/api/x?shop=shop_1"));
      expect(response.status).toBe(200);
    });
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { currentShopSlug, runWithShop } from "@/lib/shops/context";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("currentShopSlug", () => {
  it("defaults to the first shop outside a request in test/dev", () => {
    expect(currentShopSlug()).toBe("shop_1");
  });

  it("returns the shop given to runWithShop, also after awaits", async () => {
    const seen = await runWithShop("shop_2", async () => {
      await sleep(5);
      return currentShopSlug();
    });
    expect(seen).toBe("shop_2");
    expect(currentShopSlug()).toBe("shop_1");
  });

  it("keeps concurrent scopes apart", async () => {
    const [a, b] = await Promise.all([
      runWithShop("shop_2", async () => {
        await sleep(10);
        return currentShopSlug();
      }),
      runWithShop("shop_3", async () => {
        await sleep(1);
        return currentShopSlug();
      }),
    ]);
    expect([a, b]).toEqual(["shop_2", "shop_3"]);
  });

  it("has no implicit shop in production outside a request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => currentShopSlug()).toThrow("No shop in scope");
    expect(runWithShop("shop_2", () => currentShopSlug())).toBe("shop_2");
  });

  it("rejects a malformed slug given to runWithShop", () => {
    expect(() => runWithShop("public", () => 1)).toThrow();
  });
});

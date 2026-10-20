import { describe, it, expect, vi } from "vitest";
import { currentShopSlug } from "@/lib/shops/context";
import { runShopCycles, type ShopCycles } from "@/lib/zalo/shopCycles";

const shops = [
  { slug: "shop_1", name: "Một" },
  { slug: "shop_2", name: "Hai" },
];
const silent = { log: vi.fn(), error: vi.fn() };

function cycles(overrides: Partial<ShopCycles> = {}): { cycles: ShopCycles; seen: string[] } {
  const seen: string[] = [];
  const track = (name: string) => async () => {
    seen.push(`${name}:${currentShopSlug()}`);
    return null;
  };
  return {
    seen,
    cycles: { waybill: track("waybill"), cancelReceipt: track("cancel"), overdue: track("overdue"), ...overrides },
  };
}

describe("runShopCycles", () => {
  it("runs every cycle for every shop, each inside its own shop", async () => {
    const { cycles: c, seen } = cycles();
    await runShopCycles(shops, c, () => true, silent);
    expect(seen).toEqual([
      "waybill:shop_1", "cancel:shop_1", "overdue:shop_1",
      "waybill:shop_2", "cancel:shop_2", "overdue:shop_2",
    ]);
  });

  it("skips the overdue check for a shop it is not due for", async () => {
    const { cycles: c, seen } = cycles();
    await runShopCycles(shops, c, (slug) => slug === "shop_2", silent);
    expect(seen).not.toContain("overdue:shop_1");
    expect(seen).toContain("overdue:shop_2");
  });

  it("a failing shop does not stop the other shop, and the failure names the shop", async () => {
    const error = vi.fn();
    const seen: string[] = [];
    const failing: ShopCycles = {
      waybill: async () => {
        seen.push(`waybill:${currentShopSlug()}`);
        if (currentShopSlug() === "shop_1") throw new Error("bridge down");
        return null;
      },
      cancelReceipt: async () => {
        seen.push(`cancel:${currentShopSlug()}`);
        return null;
      },
      overdue: async () => null,
    };
    await runShopCycles(shops, failing, () => false, { log: vi.fn(), error });
    expect(seen).toEqual(["waybill:shop_1", "cancel:shop_1", "waybill:shop_2", "cancel:shop_2"]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("shop_1");
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sync/webhook/route";
import { prisma, sharedPrisma } from "@/lib/db";
import { runWithShop } from "@/lib/shops/context";
import { hashSecret } from "@/lib/shops/registry";
import { createTestShop, dropTestShop } from "../helpers/testShop";

const OTHER = "shop_9";
const ORIGINAL_SECRET = process.env.SYNC_WEBHOOK_SECRET;

function push(secret: string | null, orderId: string) {
  return POST(
    new NextRequest("http://localhost/api/sync/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-sync-secret": secret }) },
      body: JSON.stringify({
        tab: "orders",
        rows: [{ rowIndex: 2, hash: "h", data: { "Mã đơn hàng": orderId, "Số lượng sản phẩm 1 đơn": 1, "Trạng Thái Đơn Hàng": "pending" } }],
      }),
    })
  );
}

const orderIdsOf = (slug: string) =>
  runWithShop(slug, async () => (await prisma.order.findMany({ select: { shopeeOrderId: true } })).map((o) => o.shopeeOrderId));

describe("the sync webhook files rows under the shop that owns the secret", () => {
  beforeAll(async () => {
    process.env.SYNC_WEBHOOK_SECRET = "first-shop-secret";
    await createTestShop(OTHER);
    await sharedPrisma.shop.update({ where: { slug: OTHER }, data: { secretHash: hashSecret("second-shop-secret") } });
  }, 120_000);

  afterAll(async () => {
    await dropTestShop(OTHER);
    await runWithShop("shop_1", () => prisma.order.deleteMany());
    if (ORIGINAL_SECRET === undefined) delete process.env.SYNC_WEBHOOK_SECRET;
    else process.env.SYNC_WEBHOOK_SECRET = ORIGINAL_SECRET;
    await sharedPrisma.$disconnect();
  });

  beforeEach(async () => {
    await runWithShop("shop_1", () => prisma.order.deleteMany());
    await runWithShop(OTHER, () => prisma.order.deleteMany());
  });

  it("the first shop's existing secret still lands in the first shop", async () => {
    expect((await push("first-shop-secret", "SP-A")).status).toBe(200);
    expect(await orderIdsOf("shop_1")).toEqual(["SP-A"]);
    expect(await orderIdsOf(OTHER)).toEqual([]);
  });

  it("another shop's secret lands only in that shop", async () => {
    expect((await push("second-shop-secret", "SP-B")).status).toBe(200);
    expect(await orderIdsOf(OTHER)).toEqual(["SP-B"]);
    expect(await orderIdsOf("shop_1")).toEqual([]);
  });

  it("an unknown, missing or empty secret is refused and writes nothing", async () => {
    for (const secret of ["nope", "", null]) {
      expect((await push(secret, "SP-X")).status).toBe(401);
    }
    expect(await orderIdsOf("shop_1")).toEqual([]);
    expect(await orderIdsOf(OTHER)).toEqual([]);
  });
});

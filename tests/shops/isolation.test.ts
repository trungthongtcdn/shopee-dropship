import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/orders/[id]/route";
import { GET as downloadWaybill } from "@/app/api/waybills/[logId]/[kind]/route";
import { prisma, sharedPrisma } from "@/lib/db";
import { runWithShop } from "@/lib/shops/context";
import { listShops } from "@/lib/shops/registry";
import { hashPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { createTestShop, dropTestShop } from "../helpers/testShop";

const OTHER = "shop_9";

// Two shops, each with an order and a waybill file that carry the SAME numeric ids.
// Whatever happens in one must stay out of the other.

async function seedOrder(slug: string, note: string) {
  return runWithShop(slug, async () => {
    await prisma.order.deleteMany();
    const order = await prisma.order.create({
      data: { id: 1, shopeeOrderId: `SP-${slug}`, categoryName: "A", status: "pending", rawRowHash: "h", sheetRowIndex: 2, note },
    });
    return order.id;
  });
}

async function seedWaybill(slug: string, content: string) {
  return runWithShop(slug, async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    const log = await prisma.zaloConfirmationLog.create({
      data: { id: 1, threadId: "manual", pdfUrl: "upload:x.pdf", orderIds: [], matchedCount: 0 },
    });
    await prisma.waybillFile.create({
      data: { confirmationLogId: log.id, xlsxName: `${slug}.xlsx`, xlsxData: Buffer.from(content) },
    });
    return log.id;
  });
}

async function asUser(path: string, init: { method?: string; shop?: string; header?: string; body?: unknown } = {}) {
  const user = await sharedPrisma.user.upsert({
    where: { username: "isolation-tester" },
    update: {},
    create: { username: "isolation-tester", passwordHash: await hashPassword("password-123") },
  });
  const token = await signSession(user.id, getSessionSecret()!);
  const cookies = [`${SESSION_COOKIE}=${token}`, init.shop ? `shop=${init.shop}` : ""].filter(Boolean).join("; ");
  return new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { cookie: cookies, "content-type": "application/json", ...(init.header ? { "x-shop": init.header } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const noteOf = (slug: string) => runWithShop(slug, async () => (await prisma.order.findUnique({ where: { id: 1 } }))?.note);

describe("two shops do not see each other", () => {
  beforeAll(async () => {
    await createTestShop(OTHER);
  }, 120_000);

  afterAll(async () => {
    await dropTestShop(OTHER);
    await runWithShop("shop_1", async () => {
      await prisma.waybillFile.deleteMany();
      await prisma.zaloConfirmationLog.deleteMany();
      await prisma.order.deleteMany();
    });
    await sharedPrisma.$disconnect();
  });

  beforeEach(async () => {
    await seedOrder("shop_1", "first shop's order");
    await seedOrder(OTHER, "second shop's order");
  });

  it("an edit made while in shop B changes only shop B's order with that id", async () => {
    const response = await PATCH(
      await asUser("/api/orders/1", { method: "PATCH", shop: OTHER, header: OTHER, body: { note: "edited in B" } }),
      { params: { id: "1" } }
    );
    expect(response.status).toBe(200);
    expect(await noteOf(OTHER)).toBe("edited in B");
    expect(await noteOf("shop_1")).toBe("first shop's order");
  });

  it("a stale tab of shop B cannot write once the browser is on shop A", async () => {
    const response = await PATCH(
      await asUser("/api/orders/1", { method: "PATCH", shop: "shop_1", header: OTHER, body: { note: "stale write" } }),
      { params: { id: "1" } }
    );
    expect(response.status).toBe(409);
    expect(await noteOf("shop_1")).toBe("first shop's order");
    expect(await noteOf(OTHER)).toBe("second shop's order");
  });

  it("a waybill link made for shop B never returns shop A's file with the same log id", async () => {
    await seedWaybill("shop_1", "FIRST-SHOP-BYTES");
    await seedWaybill(OTHER, "SECOND-SHOP-BYTES");

    const own = await downloadWaybill(await asUser("/api/waybills/1/xlsx?shop=" + OTHER, { shop: OTHER }), {
      params: { logId: "1", kind: "xlsx" },
    });
    expect(Buffer.from(await own.arrayBuffer()).toString()).toBe("SECOND-SHOP-BYTES");

    const crossed = await downloadWaybill(await asUser("/api/waybills/1/xlsx?shop=" + OTHER, { shop: "shop_1" }), {
      params: { logId: "1", kind: "xlsx" },
    });
    expect(crossed.status).toBe(409);
  });

  it("creating the second shop did not add or remove shops from the list", async () => {
    const slugs = (await listShops()).map((shop) => shop.slug);
    expect(slugs).toEqual(["shop_1", OTHER]);
  });
});

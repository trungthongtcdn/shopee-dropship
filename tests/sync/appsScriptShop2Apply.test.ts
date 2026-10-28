import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  applyOrdersPayload,
  applyProductsPayload,
  applyCancelledPayload,
  applyReturnedRefundedPayload,
  applySkuPricingPayload,
} from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";
import { loadScripts, makeSheet } from "../helpers/appsScript";
import { PRICING_HEADERS, fullWorkbook, orderLine, product, PADDING_PRODUCT_ROW } from "../helpers/shop2Fixtures";

// What the shop 2 scripts send, run through the server's real apply functions —
// proves the header names the scripts produce are the ones the server reads.

function pushed(files: string[], sheets: ReturnType<typeof fullWorkbook>, entry: string, tab: string): IncomingRow[] {
  const script = loadScripts(files, { sheets });
  script.run(entry);
  return script.callFor(tab)[0].body.rows as IncomingRow[];
}

describe("shop 2 script payloads through the server", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.product.deleteMany();
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.product.deleteMany();
  });

  it("orders: one Order per (order id, variant), with status, tracking code, quantity and Vietnam-time dates", async () => {
    const rows = pushed(
      ["Sync.shop2.gs"],
      fullWorkbook({ orders: [orderLine(), orderLine({ "Tên phân loại hàng": "D100", "Số lượng": 2 })] }),
      "syncAllTabs()",
      "orders"
    );

    const result = await applyOrdersPayload(rows);

    expect(result.inserted).toBe(2);
    expect(result.rowErrors).toEqual([]);
    const order = await prisma.order.findFirstOrThrow({ where: { shopeeOrderId: "261011A43HB9Y0", categoryName: "D100" } });
    expect(order.status).toBe("Đã giao");
    expect(order.trackingCode).toBe("SPXVN0687202");
    expect(order.carrier).toBe("Nhanh-SPX Express");
    expect(order.packageCode).toBe("6070130455008");
    expect(order.productName).toContain("Ben hơi");
    expect(order.lineQuantity).toBe(2);
    expect(order.orderDate?.toISOString()).toBe("2026-10-10T16:13:00.000Z");
    expect(order.expectedDeliveryDate?.toISOString()).toBe("2026-10-12T16:59:00.000Z");
  });

  it("products: only real products land, with SKU, variant name and import price", async () => {
    const rows = pushed(
      ["Sync.shop2.gs"],
      fullWorkbook({ products: [product(), PADDING_PRODUCT_ROW, PADDING_PRODUCT_ROW, product({ "MII - Mã phân loại": "311565665779", "Tên phân loại": "40 vít HH+ Tua vít", "Giá nhập chưa VAT": 22000 })] }),
      "syncAllTabs()",
      "products"
    );

    const result = await applyProductsPayload(rows);

    expect(result.inserted).toBe(2);
    expect(result.rowErrors).toEqual([]);
    const products = await prisma.product.findMany({ orderBy: { sku: "asc" } });
    expect(products.map((p) => p.sku)).toEqual(["311565665779", "326567746540"]);
    expect(products[0]).toMatchObject({ categoryName: "40 vít HH+ Tua vít", importPrice: 22000, parentSku: "48568663858" });
  });

  it("cancelled: a cancellation with the buyer's reason and the cancel time", async () => {
    const rows = pushed(["Sync.shop2.gs"], fullWorkbook(), "syncAllTabs()", "cancelled");

    const result = await applyCancelledPayload(rows);

    expect(result.inserted).toBe(1);
    const row = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: "261012EMH5BFWD" } });
    expect(row.type).toBe("cancelled");
    expect(row.buyerNote).toBe("Hủy bởi người mua");
    expect(row.cancelledAt?.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(row.warehouseName).toBe("WH329");
  });

  it("returned_refunded: warehouse and supplier note arrive although the sheet names them differently", async () => {
    const rows = pushed(["Sync.shop2.gs"], fullWorkbook(), "syncAllTabs()", "returned_refunded");

    const result = await applyReturnedRefundedPayload(rows);

    expect(result.inserted).toBe(1);
    const row = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: "261012F37NYFXM" } });
    expect(row.type).toBe("returned_refunded");
    expect(row.warehouseName).toBe("WH329");
    expect(row.supplierNote).toBe("đã liên hệ");
    expect(row.categoryName).toBe("40 vít HH+ Tua vít");
    expect(row.complaintId).toBe("2610140JVM4UVXA");
    expect(row.returnedQuantity).toBe(1);
    expect(row.refundAmount).toBe(22000);
  });

  it("sku_pricing: collect price survives the sheet's duplicate GIÁ CẦN THU VỀ column", async () => {
    await prisma.product.create({
      data: { sku: "336567768206", productName: "Móc", importPrice: 1, rawRowHash: "seed", sheetRowIndex: 2 },
    });
    const sheet = makeSheet("1.Top Thông tin hàng hoá", [PRICING_HEADERS, ["1", "336567768206", "Móc", "Bộ Móc A Mazda", "moc5quai1lop", 28000, 27300, "", "", "", "", ""]]);
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [sheet] });
    script.run("syncPricing()");

    const result = await applySkuPricingPayload(script.calls[0].body.rows as IncomingRow[]);

    expect(result.updated).toBe(1);
    const patched = await prisma.product.findUniqueOrThrow({ where: { sku: "336567768206" } });
    expect(patched.kiotCode).toBe("moc5quai1lop");
    expect(patched.collectPrice).toBe(27300);
  });
});

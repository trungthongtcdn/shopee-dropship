import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applySkuPricingPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function pricingRow(rowIndex: number, hash: string, sku: string, kiotCode: string, collectPrice: number): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      "MÃ PHÂN LOẠI (SKU)": sku,
      "MÃ KIOT": kiotCode,
      "GIÁ CẦN THU VỀ": collectPrice,
    },
  };
}

describe("applySkuPricingPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.product.deleteMany();
  });

  it("patches kiotCode and collectPrice onto an existing product", async () => {
    await prisma.product.create({
      data: {
        sku: "SKU1",
        productName: "Product 1",
        importPrice: 58000,
        rawRowHash: "seed",
        sheetRowIndex: 2,
      },
    });

    const result = await applySkuPricingPayload([pricingRow(2, "hash-1", "SKU1", "TyHoi_D100", 56550)]);

    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.rowErrors).toEqual([]);

    const product = await prisma.product.findUnique({ where: { sku: "SKU1" } });
    expect(product?.kiotCode).toBe("TyHoi_D100");
    expect(product?.collectPrice).toBe(56550);
    // Untouched by this sync — proves it patches, not overwrites, the row.
    expect(product?.importPrice).toBe(58000);

    const log = await prisma.syncLog.findFirst({ where: { sourceTab: "sku_pricing" } });
    expect(log?.changeType).toBe("update");
  });

  it("skips a SKU with no matching product instead of creating one", async () => {
    const result = await applySkuPricingPayload([pricingRow(2, "hash-1", "SKU-UNKNOWN", "TyHoi_D999", 12345)]);

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.rowErrors).toEqual([]);
    expect(await prisma.product.count()).toBe(0);
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.product.deleteMany();
    await prisma.$disconnect();
  });
});

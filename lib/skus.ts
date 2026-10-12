import { prisma } from "@/lib/db";
import { SkuCatalog, SKU_SHEET_URL, type SkuSnapshot, type SkuStore } from "@/lib/waybill/skuCatalog";

// The master SKU list (see waybill/skuCatalog.ts) as this app keeps it: the sku_mappings
// table. A sync replaces all of it, in one transaction, so a reader sees the old list or
// the new one and never half of each.
export class PrismaSkuStore implements SkuStore {
  async load(): Promise<SkuSnapshot | null> {
    const rows = await prisma.skuMapping.findMany({ orderBy: { sku: "asc" } });
    if (rows.length === 0) return null;
    const syncedAt = rows.reduce((latest, row) => (row.syncedAt > latest ? row.syncedAt : latest), rows[0].syncedAt);
    return {
      syncedAt,
      records: rows.map((row) => ({ sku: row.sku, key: row.mappedKey, foldKey: row.foldKey, rows: row.rows })),
    };
  }

  async save(snapshot: SkuSnapshot): Promise<void> {
    const data = snapshot.records.map((record) => ({
      sku: record.sku,
      mappedKey: record.key,
      foldKey: record.foldKey,
      rows: record.rows,
      syncedAt: snapshot.syncedAt,
    }));
    await prisma.$transaction([prisma.skuMapping.deleteMany(), prisma.skuMapping.createMany({ data })]);
  }
}

let shared: SkuCatalog | undefined;

export function skuCatalog(): SkuCatalog {
  shared ??= new SkuCatalog(new PrismaSkuStore(), { url: process.env.SKU_SHEET_URL || SKU_SHEET_URL });
  return shared;
}

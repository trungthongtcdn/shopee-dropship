import { clientFor, prisma, type ShopClient } from "@/lib/db";
import { currentShopSlug } from "@/lib/shops/context";
import { getShop } from "@/lib/shops/registry";
import { SkuCatalog, SKU_SHEET_URL, type SkuSnapshot, type SkuStore } from "@/lib/waybill/skuCatalog";

// The master SKU list (see waybill/skuCatalog.ts) as this app keeps it: the sku_mappings
// table. A sync replaces all of it, in one transaction, so a reader sees the old list or
// the new one and never half of each.
export class PrismaSkuStore implements SkuStore {
  // `client` is the shop whose list this is; by default the shop of the code that
  // calls (the list is per shop, like everything else).
  constructor(private readonly client: ShopClient = prisma) {}

  async load(): Promise<SkuSnapshot | null> {
    const rows = await this.client.skuMapping.findMany({ orderBy: { sku: "asc" } });
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
    await this.client.$transaction([this.client.skuMapping.deleteMany(), this.client.skuMapping.createMany({ data })]);
  }
}

// One catalog per shop (and per sheet link): each shop has its own SKU sheet and its own
// stored copy of it. A shop with no link of its own uses the default sheet.
const catalogs = new Map<string, SkuCatalog>();

export async function skuCatalog(): Promise<SkuCatalog> {
  const slug = currentShopSlug();
  const shop = await getShop(slug);
  const url = shop?.skuSheetUrl || process.env.SKU_SHEET_URL || SKU_SHEET_URL;
  const key = `${slug}|${url}`;
  let catalog = catalogs.get(key);
  if (!catalog) {
    catalog = new SkuCatalog(new PrismaSkuStore(clientFor(slug)), { url });
    catalogs.set(key, catalog);
  }
  return catalog;
}

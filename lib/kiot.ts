import { clientFor, prisma, type ShopClient } from "@/lib/db";
import { currentShopSlug } from "@/lib/shops/context";
import type { WaybillPage } from "@/lib/waybill/items";
import { applyKiotMap, KiotMap, parseKiotSheet, type KiotRecord } from "@/lib/waybill/kiotMap";
import type { MappedPages, SkuMapper } from "@/lib/waybill/skuCatalog";

// The price sheet ("GIÁ FULL", first tab of the warehouse's Google Sheet — shared "anyone
// with the link can view", so it is fetched as CSV with no credentials) as this site keeps
// it: one row of the shop's database (kiot_snapshots), refreshed at most once a day, plus once
// more (at most every few minutes) when a waybill carries a SKU the copy has no Kiot code for — it
// was probably added to the sheet today. If the sheet can't be reached the old copy is used.
// The same life cycle as the SKU list (waybill/skuCatalog.ts), for a different table.

export const KIOT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1un5UGZlvfXAQNphdT5rF8TCWQ-g8Ms5cCJolix9pV-8/export?format=csv&gid=0";

export interface KiotSnapshot {
  records: KiotRecord[];
  syncedAt: Date;
}

export interface KiotStore {
  load(): Promise<KiotSnapshot | null>;
  save(snapshot: KiotSnapshot): Promise<void>;
}

export interface KiotCatalogOptions {
  url?: string;
  now?: () => number;
  fetchCsv?: (url: string) => Promise<string>;
  maxAgeMs?: number;
  retryAfterMs?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SHEET_BYTES = 10 * 1024 * 1024;
// A fetch that comes back with less than this share of the rows we hold is taken for a
// sheet that was cleared by mistake, and not copied over the good list.
const MIN_KEPT_SHARE = 0.5;
const MAX_LISTED = 5;

async function fetchCsvText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "text/csv" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_SHEET_BYTES) throw new Error("sheet too large");
  return text;
}

function listed(skus: string[]): string {
  const shown = skus.slice(0, MAX_LISTED).join(", ");
  return skus.length > MAX_LISTED ? `${shown} và ${skus.length - MAX_LISTED} SKU khác` : shown;
}

function listedShops(shops: string[]): string {
  const shown = shops.slice(0, MAX_LISTED).map((shop) => `"${shop}"`).join(", ");
  return shops.length > MAX_LISTED ? `${shown} và ${shops.length - MAX_LISTED} shop khác` : shown;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export class KiotCatalog {
  private readonly url: string;
  private readonly now: () => number;
  private readonly fetchCsv: (url: string) => Promise<string>;
  private readonly maxAgeMs: number;
  private readonly retryAfterMs: number;

  private current: { snapshot: KiotSnapshot; map: KiotMap } | null = null;
  private loading: Promise<void> | null = null;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<boolean> | null = null;

  constructor(
    private readonly store: KiotStore,
    options: KiotCatalogOptions = {}
  ) {
    this.url = options.url ?? KIOT_SHEET_URL;
    this.now = options.now ?? Date.now;
    this.fetchCsv = options.fetchCsv ?? fetchCsvText;
    this.maxAgeMs = options.maxAgeMs ?? DAY_MS;
    this.retryAfterMs = options.retryAfterMs ?? 10 * 60 * 1000;
  }

  // Writes each SKU's Kiot code and store onto its item (prices are not mapped for now). Never throws: the codes are an
  // improvement to the Excel, and a sheet that can't be reached must not stop the PDF being
  // sorted. Run it on pages whose SKUs already carry the master list's spelling.
  mapPages: SkuMapper = async (pages: WaybillPage[]): Promise<MappedPages> => {
    if (!pages.some((page) => page.items.some((item) => item.sku))) {
      // Nothing to look up, so no fetch — but what the stored copy knows of the kho is still
      // what an order can be moved to.
      this.loading ??= this.loadStored();
      await this.loading;
      return { pages, notices: [], ...(this.current ? { khoOptions: this.current.map.khoOptions() } : {}) };
    }
    try {
      await this.ensureFresh();
    } catch (error) {
      console.error("[kiot] could not prepare the price sheet:", error);
    }
    if (!this.current) {
      return { pages, notices: ["Không tải được bảng GIÁ FULL — chưa điền Mã Kiot, Kho Kiot, Kho gửi."] };
    }

    let result = applyKiotMap(pages, this.current.map);
    if (result.missing.length > 0 && this.now() - this.lastAttempt > this.retryAfterMs && (await this.refresh())) {
      result = applyKiotMap(pages, this.current.map);
    }

    const notices: string[] = [];
    if (this.now() - this.current.snapshot.syncedAt.getTime() > this.maxAgeMs) {
      notices.push(`Bảng GIÁ FULL chưa được cập nhật từ ${formatDate(this.current.snapshot.syncedAt)} (không tải được từ Google Sheets).`);
    }
    if (result.missing.length > 0) {
      notices.push(`${result.missing.length} SKU chưa có trong bảng GIÁ FULL — để trống Mã Kiot, Kho Kiot, Kho gửi: ${listed(result.missing)}.`);
    }
    if (result.conflicts.length > 0) {
      notices.push(`${result.conflicts.length} SKU có nhiều dòng khác nhau trong GIÁ FULL, đã lấy dòng đầu tiên: ${listed(result.conflicts)}.`);
    }
    if (result.unknownShops.length > 0) {
      notices.push(`Shop ${listedShops(result.unknownShops)} chưa khớp cột shop nào trong bảng GIÁ FULL và các cột không giống nhau — kho gửi của shop này để trống, điền tay.`);
    }
    return { pages: result.pages, notices, khoOptions: this.current.map.khoOptions() };
  };

  private async loadStored(): Promise<void> {
    try {
      const snapshot = await this.store.load();
      if (snapshot && snapshot.records.length > 0) this.current = { snapshot, map: new KiotMap(snapshot.records) };
    } catch (error) {
      console.error("[kiot] could not read the stored price sheet:", error);
    }
  }

  private async ensureFresh(): Promise<void> {
    this.loading ??= this.loadStored();
    await this.loading;
    if (this.inflight) {
      await this.inflight;
      return;
    }
    const age = this.current ? this.now() - this.current.snapshot.syncedAt.getTime() : Number.POSITIVE_INFINITY;
    const stale = age > this.maxAgeMs;
    if (stale && this.now() - this.lastAttempt > this.retryAfterMs) await this.refresh();
  }

  // Fetches the sheet and keeps it. True when the copy was replaced; false (the old copy
  // stays in use) when anything went wrong. Concurrent callers share one fetch.
  refresh(): Promise<boolean> {
    this.inflight ??= this.fetchAndKeep().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchAndKeep(): Promise<boolean> {
    this.lastAttempt = this.now();
    try {
      const records = parseKiotSheet(await this.fetchCsv(this.url));
      if (records.length === 0) throw new Error("the sheet has no SKU");
      const held = this.current?.snapshot.records.length ?? 0;
      if (held > 0 && records.length < held * MIN_KEPT_SHARE) {
        throw new Error(`the sheet shrank from ${held} to ${records.length} rows — not copied`);
      }
      const snapshot: KiotSnapshot = { records, syncedAt: new Date(this.now()) };
      this.current = { snapshot, map: new KiotMap(records) };
      try {
        await this.store.save(snapshot);
      } catch (error) {
        console.error("[kiot] could not store the price sheet:", error);
      }
      return true;
    } catch (error) {
      console.error("[kiot] could not refresh the price sheet:", error);
      return false;
    }
  }
}

// The copy this shop keeps in its own database: one row holding the whole list. Saving replaces it.
export class PrismaKiotStore implements KiotStore {
  // `client` is the shop whose copy this is; by default the shop of the code that calls.
  constructor(private readonly client: ShopClient = prisma) {}

  async load(): Promise<KiotSnapshot | null> {
    const row = await this.client.kiotSnapshot.findUnique({ where: { id: 1 } });
    if (!row || !Array.isArray(row.records)) return null;
    return { syncedAt: row.syncedAt, records: (row.records as unknown[]).filter(isRecord) };
  }

  async save(snapshot: KiotSnapshot): Promise<void> {
    const records = snapshot.records as unknown as object[];
    await this.client.kiotSnapshot.upsert({
      where: { id: 1 },
      create: { id: 1, records, syncedAt: snapshot.syncedAt },
      update: { records, syncedAt: snapshot.syncedAt },
    });
  }
}

function isRecord(value: unknown): value is KiotRecord {
  const record = value as Partial<KiotRecord> | null;
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.sku === "string" &&
    typeof record.kiotCode === "string" &&
    typeof record.store === "string" &&
    (record.cost === null || typeof record.cost === "number") &&
    (record.deliveries === undefined ||
      (typeof record.deliveries === "object" && record.deliveries !== null && Object.values(record.deliveries).every((kho) => typeof kho === "string")))
  );
}

// One catalog per shop: each keeps its own stored copy of the (shared) sheet.
const catalogs = new Map<string, KiotCatalog>();

export function kiotCatalog(): KiotCatalog {
  const slug = currentShopSlug();
  const url = process.env.KIOT_SHEET_URL || KIOT_SHEET_URL;
  const key = `${slug}|${url}`;
  let catalog = catalogs.get(key);
  if (!catalog) {
    catalog = new KiotCatalog(new PrismaKiotStore(clientFor(slug)), { url });
    catalogs.set(key, catalog);
  }
  return catalog;
}

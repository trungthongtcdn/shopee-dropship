import type { WaybillPage } from "./items";
import { parseSkuSheet, SkuMap, toSkuRecords, type SkuRecord } from "./skuMap";

// Where the master SKU list comes from and how fresh it is kept. The list is the "SKU FULL"
// tab of the warehouse's price sheet, shared as "anyone with the link can view", so it is
// fetched as CSV with no credentials. It is copied into the app's own storage (a file for
// the sorter, a table for the dropship app) and refreshed at most once a day — plus once
// more, at most every few minutes, when a waybill carries a SKU the copy doesn't know yet
// (it was probably added to the sheet today).

export const SKU_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1un5UGZlvfXAQNphdT5rF8TCWQ-g8Ms5cCJolix9pV-8/export?format=csv&gid=1587726509";

export interface SkuSnapshot {
  records: SkuRecord[];
  syncedAt: Date;
}

// Each app keeps the last snapshot where it keeps everything else.
export interface SkuStore {
  load(): Promise<SkuSnapshot | null>;
  save(snapshot: SkuSnapshot): Promise<void>;
}

export interface MappedPages {
  pages: WaybillPage[];
  // Things the user should be told: SKUs that weren't found, a list that couldn't be fetched.
  notices: string[];
}

export type SkuMapper = (pages: WaybillPage[]) => Promise<MappedPages>;

export interface SkuCatalogOptions {
  url?: string;
  now?: () => number;
  // The sheet's CSV text. Defaults to a plain HTTPS GET.
  fetchCsv?: (url: string) => Promise<string>;
  // A copy older than this is fetched again before use.
  maxAgeMs?: number;
  // The shortest time between two attempts to fetch it.
  retryAfterMs?: number;
  // SKUs the list isn't expected to hold (say, ones that are made of other SKUs): when the
  // list doesn't know one, it is left as read without a notice or a new fetch.
  quietUnmatched?: (sku: string) => boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SHEET_BYTES = 10 * 1024 * 1024;
// A fetch that comes back with less than this share of the SKUs we hold is taken for a
// sheet that was cleared by mistake, and not copied over the good list.
const MIN_KEPT_SHARE = 0.5;
const MAX_LISTED_NOTICES = 5;

async function fetchCsvText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "text/csv" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_SHEET_BYTES) throw new Error("sheet too large");
  return text;
}

export class SkuCatalog {
  private readonly url: string;
  private readonly now: () => number;
  private readonly fetchCsv: (url: string) => Promise<string>;
  private readonly maxAgeMs: number;
  private readonly retryAfterMs: number;
  private readonly quietUnmatched: (sku: string) => boolean;

  private current: { snapshot: SkuSnapshot; map: SkuMap } | null = null;
  private loading: Promise<void> | null = null;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<boolean> | null = null;

  constructor(
    private readonly store: SkuStore,
    options: SkuCatalogOptions = {}
  ) {
    this.url = options.url ?? SKU_SHEET_URL;
    this.now = options.now ?? Date.now;
    this.fetchCsv = options.fetchCsv ?? fetchCsvText;
    this.maxAgeMs = options.maxAgeMs ?? DAY_MS;
    this.retryAfterMs = options.retryAfterMs ?? 10 * 60 * 1000;
    this.quietUnmatched = options.quietUnmatched ?? (() => false);
  }

  // Replaces each page's SKUs by the master list's spelling. A SKU the list doesn't have is
  // left as it was read from the label. Never throws: the list is an improvement to the
  // Excel, and a sheet that can't be reached must not stop the PDF being sorted.
  mapPages: SkuMapper = async (pages) => {
    // Labels without an order-info table carry no SKU: nothing to look up, nothing to fetch.
    if (!pages.some((page) => page.items.some((item) => item.sku))) return { pages, notices: [] };
    const notices: string[] = [];
    try {
      await this.ensureFresh();
    } catch (error) {
      console.error("[skus] could not prepare the SKU list:", error);
    }
    if (!this.current) {
      return { pages, notices: ["Không tải được danh sách SKU — SKU giữ nguyên như đọc từ phiếu."] };
    }

    const unknown = (mapped: { unmatched: string[] }) => mapped.unmatched.filter((sku) => !this.quietUnmatched(sku));
    let result = applySkuMap(pages, this.current.map);
    if (unknown(result).length > 0 && this.now() - this.lastAttempt > this.retryAfterMs && (await this.refresh())) {
      result = applySkuMap(pages, this.current.map);
    }
    const unmatched = unknown(result);

    if (this.now() - this.current.snapshot.syncedAt.getTime() > this.maxAgeMs) {
      notices.push(`Danh sách SKU chưa được cập nhật từ ${formatDate(this.current.snapshot.syncedAt)} (không tải được từ Google Sheets).`);
    }
    if (unmatched.length > 0) {
      const shown = unmatched.slice(0, MAX_LISTED_NOTICES).join(", ");
      const more = unmatched.length > MAX_LISTED_NOTICES ? ` và ${unmatched.length - MAX_LISTED_NOTICES} SKU khác` : "";
      notices.push(`${unmatched.length} SKU không có trong danh sách SKU, giữ nguyên như đọc từ phiếu: ${shown}${more}.`);
    }
    return { pages: result.pages, notices };
  };

  private async loadStored(): Promise<void> {
    try {
      const snapshot = await this.store.load();
      if (snapshot && snapshot.records.length > 0) this.current = { snapshot, map: new SkuMap(snapshot.records) };
    } catch (error) {
      console.error("[skus] could not read the stored SKU list:", error);
    }
  }

  private async ensureFresh(): Promise<void> {
    this.loading ??= this.loadStored();
    await this.loading;
    // Someone else is already fetching it: wait for that rather than go on without a list.
    if (this.inflight) {
      await this.inflight;
      return;
    }
    const age = this.current ? this.now() - this.current.snapshot.syncedAt.getTime() : Number.POSITIVE_INFINITY;
    if (age > this.maxAgeMs && this.now() - this.lastAttempt > this.retryAfterMs) await this.refresh();
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
      const records = toSkuRecords(parseSkuSheet(await this.fetchCsv(this.url)));
      if (records.length === 0) throw new Error("the sheet has no SKU");
      const held = this.current?.snapshot.records.length ?? 0;
      if (held > 0 && records.length < held * MIN_KEPT_SHARE) {
        throw new Error(`the sheet shrank from ${held} to ${records.length} SKUs — not copied`);
      }
      const snapshot: SkuSnapshot = { records, syncedAt: new Date(this.now()) };
      this.current = { snapshot, map: new SkuMap(records) };
      try {
        await this.store.save(snapshot);
      } catch (error) {
        // Still in use from memory until the next restart.
        console.error("[skus] could not store the SKU list:", error);
      }
      return true;
    } catch (error) {
      console.error("[skus] could not refresh the SKU list:", error);
      return false;
    }
  }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

// Pure: the pages with each SKU the list knows replaced by its spelling, and the distinct
// SKUs it did not know, in the order they were met.
export function applySkuMap(pages: WaybillPage[], map: SkuMap): { pages: WaybillPage[]; unmatched: string[] } {
  const unmatched = new Set<string>();
  const mapped = pages.map((page) => {
    if (!page.items.some((item) => item.sku)) return page;
    return {
      ...page,
      items: page.items.map((item) => {
        if (!item.sku) return item;
        const sku = map.resolve(item.sku);
        if (sku === null) {
          unmatched.add(item.sku);
          return item;
        }
        return sku === item.sku ? item : { ...item, sku };
      }),
    };
  });
  return { pages: mapped, unmatched: [...unmatched] };
}

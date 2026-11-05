// "Kho gửi": the warehouse an order is packed and shipped from. The same product can be shipped
// from a different warehouse for each shop that sells it, so the price sheet has a kho column per
// shop (see kiotMap.ts); this turns those cells into one kho per order.
//
// Rules the warehouse set:
//  - only Shopee Express (SPX…) parcels go to a kho other than khoLuan; Viettel Post and GHN parcels
//    are always khoLuan, whatever the sheet says;
//  - an SPX order whose Kiot products are in different kho has its kho gửi left EMPTY, to be filled in
//    by hand (the Excel cell stays blank until someone picks one);
//  - so is an SPX order the sheet can't speak for (a SKU or shop it doesn't know, or a label with no SKU).
//
// (The Convert site sends the last two to khoLuan instead; here nobody guesses.)
//
// Pure: no network or disk.

import type { KhoDecision, WaybillPage } from "./items";

// The kho listed first, and the one the Convert site falls back on.
export const DEFAULT_KHO = "khoLuan";

// How a page names the orders that have no kho gửi yet.
export const NO_KHO_LABEL = "Chưa có kho gửi";

export const KHO_REASON_TEXT: Record<KhoDecision["reason"], string> = {
  sheet: "Theo bảng giá",
  "not-spx": "Không phải đơn SPX",
  mixed: "Các mã Kiot khác kho",
  unknown: "Chưa tra được kho gửi",
};

const collator = new Intl.Collator("vi");

// "khoLuan", "KHOLUAN" and " kho Luan " are the same kho.
export function khoKey(kho: string): string {
  return kho.normalize("NFC").replace(/\s+/g, "").toLowerCase();
}

// The kho as it is written everywhere (file names, Excel, the page): khoLuan always as
// DEFAULT_KHO, anything else as the sheet spells it, "" for no kho.
export function canonicalKho(kho: string): string {
  const text = kho.normalize("NFC").replace(/\s+/g, " ").trim();
  return khoKey(text) === khoKey(DEFAULT_KHO) ? DEFAULT_KHO : text;
}

export function isSpxTracking(trackingCode: string | null | undefined): boolean {
  return /^SPX/i.test((trackingCode ?? "").trim());
}

// The kho the price sheet gives an order on its own, with why. `kho` is "" when it gives none.
export function decideKho(page: WaybillPage): KhoDecision {
  if (!isSpxTracking(page.trackingCode)) return { kho: DEFAULT_KHO, reason: "not-spx" };

  const lines = page.items.flatMap((item) => (item.kiotLines && item.kiotLines.length > 0 ? item.kiotLines : [null]));
  const khos = lines.map((line) => line?.khoGiao?.trim() ?? "");
  if (khos.length === 0 || khos.some((kho) => kho === "")) return { kho: "", reason: "unknown" };
  if (new Set(khos.map(khoKey)).size > 1) return { kho: "", reason: "mixed" };
  return { kho: canonicalKho(khos[0]), reason: "sheet" };
}

// The pages with their kho gửi: the sheet's decision, or the edit made for that order.
export function assignKho(pages: readonly WaybillPage[], overrides: ReadonlyMap<string, string> = new Map()): WaybillPage[] {
  return pages.map((page) => {
    const auto = decideKho(page);
    const edited = overrides.get(page.shopeeOrderId);
    return { ...page, khoAuto: auto, khoGiao: edited === undefined ? auto.kho : canonicalKho(edited) };
  });
}

// khoLuan first, the others by name, and "no kho" last.
export function compareKho(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "" || b === "") return a === "" ? 1 : -1;
  if (a === DEFAULT_KHO || b === DEFAULT_KHO) return a === DEFAULT_KHO ? -1 : 1;
  return collator.compare(a, b);
}

export interface KhoBlock {
  // "" for the orders that have no kho gửi.
  kho: string;
  pages: WaybillPage[];
}

// One block per kho (see compareKho for the order); the pages keep their order inside.
export function splitByKho(pages: readonly WaybillPage[]): KhoBlock[] {
  const blocks = new Map<string, KhoBlock>();
  for (const page of pages) {
    const kho = canonicalKho(page.khoGiao ?? "");
    const key = khoKey(kho);
    const block = blocks.get(key) ?? { kho, pages: [] };
    block.pages.push(page);
    blocks.set(key, block);
  }
  return [...blocks.values()].sort((a, b) => compareKho(a.kho, b.kho));
}

const MAX_OVERRIDES = 2000;
const MAX_KHO_LENGTH = 30;
const MAX_ORDER_ID_LENGTH = 40;

// The edits the page sends back: a JSON object of order id → kho gửi ("" puts the order back to
// "no kho"). Nothing here is trusted: the names end up in file names and in the Excel.
export function parseKhoOverrides(raw: unknown): Map<string, string> {
  const invalid = () => new Error("khoOverrides không hợp lệ");
  if (raw === null || raw === undefined || raw === "") return new Map();

  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      throw invalid();
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid();

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_OVERRIDES) throw invalid();

  const result = new Map<string, string>();
  for (const [orderId, kho] of entries) {
    if (orderId === "" || orderId.length > MAX_ORDER_ID_LENGTH || typeof kho !== "string") throw invalid();
    const text = kho.trim();
    if (text.length > MAX_KHO_LENGTH || (text !== "" && !/^[\p{L}\p{N}_.\- ]+$/u.test(text))) throw invalid();
    result.set(orderId, text);
  }
  return result;
}

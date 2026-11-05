// The warehouse's price sheet ("GIÁ FULL", the first tab of the same Google Sheet that holds
// the SKU list): for each SKU the seller uses on Shopee, the product's code in Kiot, the Kiot
// store it is kept in and what one unit cost. The warehouse Excel fills Mã Kiot and Kho Kiot from
// it, and Kho gửi from the shops' columns (see khoGiao.ts). The cost is still read (so prices
// can be mapped again) but not used.
//
//   mã hàng kiot | kho kiot | sku shopee | … | Giá nhập MỚI NHẤT (t7) | …
//
// Several Shopee SKUs may point at one Kiot product ("Ví_Nâu_FORD", "Ví_Nâu_MAZDA" → Vi_Nau),
// so the lookup runs from the SKU. It is keyed like the SKU list's (skuMap.ts): exact key
// first, then one without case and diacritics, never a nearest match.
//
// Pure: no network or disk — see lib/kiot.ts for where the sheet comes from.

import type { KiotLine, WaybillItem, WaybillPage } from "./items";
import { canonicalKho, compareKho, khoKey } from "./khoGiao";
import { parseCsv, SkuSheetError, skuFoldKey, skuKey } from "./skuMap";

export interface KiotRecord {
  // The "sku shopee" cell as the sheet spells it.
  sku: string;
  kiotCode: string;
  store: string;
  // Cost of one unit in đồng; null where the sheet has none.
  cost: number | null;
  // The kho giao the sheet gives this SKU for each shop, keyed by the shop column's title as
  // shopKey() folds it ("THE THAO" → "thethao"); a shop with an empty cell is left out. Absent
  // when the sheet has no shop columns or none has a value on this row.
  deliveries?: Record<string, string>;
}

export interface KiotEntry {
  // The sheet's own spelling of the SKU that matched.
  sku: string;
  kiotCode: string;
  store: string;
  cost: number | null;
  deliveries?: Record<string, string>;
  // True when the sheet lists the same SKU on several rows that disagree on Kiot code or
  // store; the first row with a Kiot code was used.
  conflict: boolean;
}

// The sheet writes money with a dot as the thousands separator ("4.150", "100000"); a comma
// would be the decimal mark. Anything else is not a price.
export function parseCost(text: string): number | null {
  const cleaned = text.replace(/[\s₫đ]/gi, "");
  if (cleaned === "") return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(,\d+)?$/.test(cleaned)) normalized = cleaned.replace(",", ".");
  else if (/^\d+\.\d{1,2}$/.test(cleaned)) normalized = cleaned;
  else return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// A shop's column title and the shop name printed on a label are compared in this form: no
// case, marks or spaces ("THE THAO" and "Thể Thao" both read "thethao").
export const shopKey = skuFoldKey;

// Shop names as the labels print them that don't contain their column's title.
const SHOP_ALIASES = new Map<string, string>([[shopKey("Kho Quạt Thông Gió LCN"), shopKey("QUATUNI")]]);

// What a parcel's shop is given when it matches none of the sheet's shop columns: the kho all the
// columns agree on, so a sheet whose shops all ship alike needs no column per shop. Absent when the
// columns disagree (or there are none) — the kho is then left for hand entry.
export function agreedKho(deliveries: Record<string, string> | undefined): string | undefined {
  const khos = Object.values(deliveries ?? {});
  if (khos.length === 0) return undefined;
  return new Set(khos.map(khoKey)).size === 1 ? khos[0] : undefined;
}

const cell = (value: string | undefined) => (value ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// Columns are found by their titles, so a column added in front doesn't matter; the price
// column's title changes with the month ("Giá nhập MỚI NHẤT (t7)"), so only its start counts.
export function parseKiotSheet(csv: string): KiotRecord[] {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ""));
  const title = (value: string | undefined) => cell(value).toLowerCase();
  const headerRow = rows.slice(0, 10).findIndex((row) => row.some((c) => title(c) === "sku shopee") && row.some((c) => title(c) === "mã hàng kiot"));
  if (headerRow < 0) throw new SkuSheetError('Không thấy cột "sku shopee" và "mã hàng kiot" trong sheet GIÁ FULL');

  const header = rows[headerRow].map(title);
  const skuColumn = header.indexOf("sku shopee");
  const kiotColumn = header.indexOf("mã hàng kiot");
  const storeColumn = header.indexOf("kho kiot");
  const costColumn = header.findIndex((c) => c.startsWith("giá nhập mới nhất"));
  // The shops' kho giao columns follow the price column, up to the next price column (or a
  // gap); the same titles come again further right, empty, for something else.
  const shopColumns: { index: number; key: string }[] = [];
  if (costColumn >= 0) {
    for (let index = costColumn + 1; index < header.length; index++) {
      const key = shopKey(header[index]);
      if (key === "" || header[index].startsWith("giá nhập")) break;
      shopColumns.push({ index, key });
    }
  }

  const records: KiotRecord[] = [];
  for (const row of rows.slice(headerRow + 1)) {
    const sku = cell(row[skuColumn]);
    if (sku === "" || skuKey(sku) === "") continue;
    const deliveries: Record<string, string> = {};
    for (const { index, key } of shopColumns) {
      const kho = cell(row[index]);
      if (kho !== "") deliveries[key] = kho;
    }
    records.push({
      sku,
      kiotCode: cell(row[kiotColumn]),
      store: storeColumn >= 0 ? cell(row[storeColumn]) : "",
      cost: costColumn >= 0 ? parseCost(cell(row[costColumn])) : null,
      ...(Object.keys(deliveries).length > 0 ? { deliveries } : {}),
    });
  }
  return records;
}

// Price is left out: rows that differ only in it put the SKU in the same place.
const signature = (record: KiotRecord) => `${record.kiotCode}¦${record.store}`;

export class KiotMap {
  private readonly exact = new Map<string, KiotRecord[]>();
  private readonly folded = new Map<string, KiotRecord[]>();
  private readonly shopKeys = new Set<string>();
  private readonly khos = new Map<string, string>();

  constructor(records: readonly KiotRecord[]) {
    const add = (into: Map<string, KiotRecord[]>, key: string, record: KiotRecord) => {
      if (key === "") return;
      into.set(key, [...(into.get(key) ?? []), record]);
    };
    for (const record of records) {
      for (const [shop, kho] of Object.entries(record.deliveries ?? {})) {
        this.shopKeys.add(shop);
        this.khos.set(khoKey(kho), canonicalKho(kho));
      }
      // A row with no Kiot code says nothing about where the SKU goes.
      if (record.kiotCode === "") continue;
      add(this.exact, skuKey(record.sku), record);
      add(this.folded, skuFoldKey(record.sku), record);
    }
  }

  get size(): number {
    return this.exact.size;
  }

  // True when the sheet has kho giao columns at all.
  get hasShops(): boolean {
    return this.shopKeys.size > 0;
  }

  // The shop column a label's sender belongs to (its key in `deliveries`): the longest column
  // title the sender's name contains ("FASTFIX.VN" → fastfix), or the column a known alias
  // names. Null when it matches none.
  shopColumnFor(shopName: string): string | null {
    const folded = shopKey(shopName);
    if (folded === "") return null;
    const alias = SHOP_ALIASES.get(folded);
    if (alias && this.shopKeys.has(alias)) return alias;
    let best: string | null = null;
    for (const key of this.shopKeys) {
      if (folded.includes(key) && (best === null || key.length > best.length)) best = key;
    }
    return best;
  }

  // Every kho the sheet gives some SKU, khoLuan first: what an order's kho giao can be changed to.
  khoOptions(): string[] {
    return [...this.khos.values()].sort(compareKho);
  }

  resolve(raw: string): KiotEntry | null {
    const rows = this.exact.get(skuKey(raw)) ?? this.folded.get(skuFoldKey(raw));
    if (!rows || rows.length === 0) return null;
    const [first] = rows;
    return {
      sku: first.sku,
      kiotCode: first.kiotCode,
      store: first.store,
      cost: first.cost,
      ...(first.deliveries ? { deliveries: first.deliveries } : {}),
      conflict: rows.some((row) => signature(row) !== signature(first)),
    };
  }
}

export interface ComboPart {
  // A base SKU of the combination, as written.
  sku: string;
  // How many of it one unit of the combined SKU holds.
  count: number;
}

// A SKU written "SKU1*2+SKU2*3": "+" separates the base SKUs, "*" says how many of that SKU
// there are (none: one). null for a plain SKU, and for anything that isn't a clean list of
// parts (an empty part, a stray "*").
export function parseComboSku(sku: string): ComboPart[] | null {
  let counted = false;
  const parts = sku.split("+").map((part) => {
    const text = part.replace(/\s+/g, " ").trim();
    const match = /^(.*\S)\s*\*\s*([1-9]\d*)$/u.exec(text);
    if (!match) return { sku: text, count: 1 };
    counted = true;
    return { sku: match[1], count: Number(match[2]) };
  });
  if (parts.some((part) => part.sku === "" || part.sku.startsWith("*"))) return null;
  return parts.length > 1 || counted ? parts : null;
}

export interface AppliedKiot {
  pages: WaybillPage[];
  // Distinct SKUs the sheet has no Kiot code for, in the order they were met: the base SKU
  // for a part of a combined SKU, the SKU itself otherwise.
  missing: string[];
  conflicts: string[];
  // Senders (as printed on the labels) that match none of the sheet's shop columns while the
  // columns disagree about some SKU of theirs, so those lines have no kho gửi. Empty when the sheet
  // has no shop columns.
  unknownShops: string[];
}

// The pages with each item's Kiot lines: the SKU's Kiot code and store, and the number
// of Kiot units. A combined SKU gets a line per base SKU; a part the sheet doesn't know keeps
// its line (so the quantity isn't lost) without a code. An item the sheet knows nothing of is
// left exactly as it was.
export function applyKiotMap(pages: WaybillPage[], map: KiotMap): AppliedKiot {
  const missing = new Set<string>();
  const conflicts = new Set<string>();
  const unknownShops = new Set<string>();

  // `shop`: the sheet's column for the shop that sends this parcel (null when it has none) and
  // the sender's name as printed.
  type Shop = { column: string | null; name: string | undefined };
  const line = (sku: string, quantity: number, entry: KiotEntry | null, shop: Shop): KiotLine => {
    if (!entry) return { sku, quantity };
    if (entry.conflict) conflicts.add(sku);
    let khoGiao: string | undefined;
    if (shop.column) khoGiao = entry.deliveries?.[shop.column];
    else if (map.hasShops) {
      khoGiao = agreedKho(entry.deliveries);
      if (!khoGiao && shop.name && entry.deliveries) unknownShops.add(shop.name);
    }
    return {
      sku,
      quantity,
      kiotCode: entry.kiotCode,
      ...(entry.store ? { kiotStore: entry.store } : {}),
      ...(khoGiao ? { khoGiao } : {}),
    };
  };

  const mapItem = (item: WaybillItem, shop: Shop): WaybillItem => {
    if (!item.sku) return item;
    const parts = parseComboSku(item.sku);
    // A row the sheet lists for the SKU as a whole wins, combined or not. The lookup key drops
    // "*" and "+", so "A*2" would meet a real SKU "A2" (3 of "A*2" are 6 A, not 3 A2): a
    // combined SKU only counts as listed when the sheet's row is written as a combination too.
    const whole = map.resolve(item.sku);
    if (whole && (!parts || /[*+]/.test(whole.sku))) return { ...item, kiotLines: [line(item.sku, item.quantity, whole, shop)] };

    const entries = parts?.map((part) => map.resolve(part.sku)) ?? [];
    if (!parts || entries.every((entry) => entry === null)) {
      missing.add(item.sku);
      return item;
    }
    parts.forEach((part, index) => {
      if (!entries[index]) missing.add(part.sku);
    });
    return { ...item, kiotLines: parts.map((part, index) => line(part.sku, item.quantity * part.count, entries[index], shop)) };
  };

  const mapped = pages.map((page) => {
    if (!page.items.some((item) => item.sku)) return page;
    const shop: Shop = { column: map.hasShops && page.shopName ? map.shopColumnFor(page.shopName) : null, name: page.shopName };
    return { ...page, items: page.items.map((item) => mapItem(item, shop)) };
  });
  return { pages: mapped, missing: [...missing], conflicts: [...conflicts], unknownShops: [...unknownShops] };
}

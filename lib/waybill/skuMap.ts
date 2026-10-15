// Mapping the SKU printed on a waybill to the seller's real SKU.
//
// The SKU column of the order-info table is narrow and wraps in the middle of words, so
// what is read from the PDF has lost or gained spaces ("TyHoi_D160" can come out as
// "TyHoi_D16" + "0") and the sender may have typed it differently from the master list
// ("4Vit_Ghe_Ngan" for "4Vit_Ghế_Ngắn"). The master list is a sheet of SKUs; both sides
// are reduced to a key without spaces and special characters and the key is looked up —
// the SKU that goes in the Excel is the master list's own spelling.
//
// Two keys, tried in this order:
//   1. the exact key: letters and digits only, case and diacritics kept.
//   2. the folded key: the same, lower-cased and without diacritics (đ → d).
// Nothing fuzzier than that: "1Vit_Ghe_Ngan" and "4Vit_Ghe_Ngan" are one character apart
// and two different products, so a nearest-match would put a wrong SKU in the file.
//
// Pure: no network or disk — see skuCatalog.ts for where the list comes from.

// Letters, combining marks (a decomposed "ế" stays whole) and digits of any script; every
// space, punctuation mark and symbol goes.
export function skuKey(text: string): string {
  return text.normalize("NFC").replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

export function skuFoldKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export interface SkuRecord {
  // The SKU as the master list spells it (whitespace runs collapsed to one space, accents
  // composed).
  sku: string;
  key: string;
  foldKey: string;
  // How many rows of the master list carry it: when two spellings share a key, the one
  // the list uses most is the one that is meant.
  rows: number;
}

// One record per distinct SKU of the master list, in the order they first appear. A SKU
// with no letter or digit in it ("???") can't be looked up and is left out.
export function toSkuRecords(skus: readonly string[]): SkuRecord[] {
  const counted = new Map<string, number>();
  for (const raw of skus) {
    const sku = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    if (sku === "" || skuKey(sku) === "") continue;
    counted.set(sku, (counted.get(sku) ?? 0) + 1);
  }
  return [...counted].map(([sku, rows]) => ({ sku, key: skuKey(sku), foldKey: skuFoldKey(sku), rows }));
}

export class SkuMap {
  private readonly exact = new Map<string, SkuRecord>();
  private readonly folded = new Map<string, SkuRecord>();

  constructor(records: readonly SkuRecord[]) {
    // Strictly more rows wins, so a tie goes to the SKU listed first.
    const prefer = (into: Map<string, SkuRecord>, key: string, record: SkuRecord) => {
      if (key === "") return;
      const held = into.get(key);
      if (!held || record.rows > held.rows) into.set(key, record);
    };
    for (const record of records) {
      prefer(this.exact, record.key, record);
      prefer(this.folded, record.foldKey, record);
    }
  }

  get size(): number {
    return this.exact.size;
  }

  // The master list's SKU for `raw`, or null when the list has none like it.
  resolve(raw: string): string | null {
    const key = skuKey(raw);
    if (key === "") return null;
    return (this.exact.get(key) ?? this.folded.get(skuFoldKey(raw)))?.sku ?? null;
  }
}

// Minimal RFC 4180: quoted cells may hold commas, doubled quotes and line breaks.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export class SkuSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkuSheetError";
  }
}

// The SKUs of the "SKU FULL" tab exported as CSV: everything under the column headed "SKU"
// (found by its title, so a column added before it doesn't matter).
export function parseSkuSheet(csv: string): string[] {
  const rows = parseCsv(csv.replace(/^﻿/, ""));
  const headerRow = rows.slice(0, 10).findIndex((row) => row.some((cell) => cell.trim().toLowerCase() === "sku"));
  if (headerRow < 0) throw new SkuSheetError('Không thấy cột "SKU" trong sheet');
  const column = rows[headerRow].findIndex((cell) => cell.trim().toLowerCase() === "sku");
  return rows
    .slice(headerRow + 1)
    .map((row) => row[column] ?? "")
    .filter((cell) => cell.trim() !== "");
}

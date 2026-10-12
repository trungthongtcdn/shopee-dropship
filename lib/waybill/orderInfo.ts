import type { BboxWord } from "./layout";

// Some waybill prints put, under each shipping label, a "THÔNG TIN ĐƠN HÀNG" block:
// a table of the order's lines with the seller's SKUs. The shipping label proper
// ends above that heading — the block is for the packer, not for the courier — so
// this file finds where it starts (the PDF is cut there) and reads the SKU column
// out of it (they go to the Excel).
//
//   THÔNG TIN ĐƠN HÀNG
//   OrderSN: 2610083P8CNR1Q package 1
//   #  SKU    Tên sản phẩm   SKU phân loại   Phân loại hàng   SL   Đơn giá   Thành tiền
//   1  TyHoi  Piston ghế …                   D160 đen         1    170,000   170,000
//      _D16
//
// The table wraps by pixel width and its SKU column is narrow — a SKU takes several
// lines — so it is read from the words' positions, not from `-layout` text. Two columns
// are read: "SKU" and "Phân loại hàng" (the variation), both exactly as printed, with no
// guessing about whether a wrap fell on a space or inside a word. The label's own text
// wraps character by character and loses the space at each wrap; the table is the
// seller's text as it is, so when there is a table it is the source of both.

export interface OrderInfo {
  // Where the block starts: the y of its heading, in page points from the top.
  top: number;
  // Row number printed in the "#" column (1-based) → the "SKU" of that line. Rows whose
  // SKU is empty are left out.
  skus: Map<number, string>;
  // The same rows → the "Phân loại hàng" (variation) of that line, left out when empty.
  variants: Map<number, string>;
}

const HEADING = ["THÔNG", "TIN", "ĐƠN", "HÀNG"];

// A word's right neighbour on the same text line.
function nextOnLine(words: BboxWord[], from: BboxWord, text: string): BboxWord | undefined {
  return words.find((w) => w.text === text && Math.abs(w.y0 - from.y0) < 1 && w.x0 >= from.x1 - 0.5 && w.x0 - from.x1 < 6);
}

// The first word of every "THÔNG TIN ĐƠN HÀNG" heading among `words`.
export function findOrderInfoHeadings(words: BboxWord[]): BboxWord[] {
  return words.filter((first) => {
    if (first.text !== HEADING[0]) return false;
    let word = first;
    for (const text of HEADING.slice(1)) {
      const next = nextOnLine(words, word, text);
      if (!next) return false;
      word = next;
    }
    return true;
  });
}

export function hasOrderInfoHeading(text: string): boolean {
  return text.includes(HEADING.join(" "));
}

// The lines of one wrapped table cell: words on the same baseline, top to bottom.
function linesOf(words: BboxWord[]): BboxWord[][] {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: BboxWord[][] = [];
  for (const word of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(word.y0 - line[0].y0) < 2) line.push(word);
    else lines.push([word]);
  }
  return lines.map((line) => line.sort((a, b) => a.x0 - b.x0));
}

// The words of one wrapped line.
const lineText = (line: BboxWord[]) => line.map((w) => w.text).join(" ");

// A wrapped SKU cell's lines as one text: what is printed, with nothing added at a line
// break. The narrow column cuts SKU codes mid-word far more often than it breaks them at
// a space, and the PDF can't say which it was — a space would split most codes — so the
// lines are simply run together; spaces that are printed inside a line are kept.
function joinSkuLines(lines: BboxWord[][]): string {
  return lines.map(lineText).join("").trim();
}

// A wrapped "Phân loại hàng" cell's lines as one text. This column wraps at word
// boundaries (a word moves whole to the next line), so a line break is a space — except
// right after a hyphen or slash that closes a word ("80-" / "130" is "80-130"), where the
// break is only the place the text is allowed to wrap.
function joinVariantLines(lines: BboxWord[][]): string {
  let text = "";
  for (const line of lines) {
    const next = lineText(line);
    text = text === "" ? next : /[^\s\-/][-/]$/.test(text) ? text + next : `${text} ${next}`;
  }
  return text.trim();
}

// Header and body text start at the same x; a body word may sit this far left of it.
const COLUMN_SLACK = 1.5;

// The "Phân loại hàng" column: from its header's first word to the next header word. The
// column before it, "SKU phân loại", has no "hàng" after its "loại", so the three words
// in a row are what tell the two apart.
function variantColumn(header: BboxWord[]): { from: number; to: number } | null {
  for (let i = 0; i + 2 < header.length; i++) {
    if (header[i].text.toLowerCase() === "phân" && header[i + 1].text === "loại" && header[i + 2].text === "hàng") {
      return { from: header[i].x0, to: header[i + 3]?.x0 ?? Number.POSITIVE_INFINITY };
    }
  }
  return null;
}

// `words` are one label's words (a label alone on its page, or one cell of a tiled
// sheet). Null when the label has no order-info block.
export function readOrderInfo(words: BboxWord[]): OrderInfo | null {
  const heading = findOrderInfoHeadings(words)[0];
  if (!heading) return null;
  const info: OrderInfo = { top: heading.y0, skus: new Map(), variants: new Map() };

  const below = words.filter((w) => w.y0 > heading.y1 && w.x0 >= heading.x0 - 40);
  const hash = below.filter((w) => w.text === "#").sort((a, b) => a.y0 - b.y0)[0];
  if (!hash) return info;

  // Column starts, read off the header line.
  const header = below.filter((w) => Math.abs(w.y0 - hash.y0) < 1.5).sort((a, b) => a.x0 - b.x0);
  const sku = header.find((w) => w.text === "SKU");
  const name = header.find((w) => w.text === "Tên");
  if (!sku || !name) return info;
  // The "SKU" column is read, not "SKU phân loại", which sits further right.
  const variant = variantColumn(header);

  // Body rows start at each number in the "#" column.
  const body = below.filter((w) => w.y0 > hash.y1);
  const rows = body
    .filter((w) => /^\d+$/.test(w.text) && w.x0 >= hash.x0 - COLUMN_SLACK && w.x0 < sku.x0 - COLUMN_SLACK)
    .sort((a, b) => a.y0 - b.y0);

  // Each row's lines of the SKU column and of the variation column.
  rows.forEach((row, i) => {
    const bottom = rows[i + 1]?.y0 ?? Infinity;
    const inRow = body.filter((w) => w.y0 >= row.y0 - 1 && w.y0 < bottom - 1);
    const cell = (from: number, to: number) => linesOf(inRow.filter((w) => w.x0 >= from - COLUMN_SLACK && w.x0 < to - COLUMN_SLACK));

    const skuText = joinSkuLines(cell(sku.x0, name.x0));
    if (skuText) info.skus.set(Number(row.text), skuText);
    if (variant) {
      const variantText = joinVariantLines(cell(variant.from, variant.to));
      if (variantText) info.variants.set(Number(row.text), variantText);
    }
  });
  return info;
}

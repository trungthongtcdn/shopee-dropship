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
// The table wraps by pixel width, in the middle of a word when it has to, and its SKU
// column is narrow — a SKU takes several lines — so it is read from the words'
// positions, not from `-layout` text.

export interface OrderInfo {
  // Where the block starts: the y of its heading, in page points from the top.
  top: number;
  // Row number printed in the "#" column (1-based) → the "SKU" of that line. Rows whose
  // SKU is empty are left out.
  skus: Map<number, string>;
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

// Advance widths of Arial/Helvetica (what the tables are set in) per 1000 units of
// font size; accented letters count as their base letter. Only used to guess how wide
// a character is relative to its neighbours, so a rough table is enough.
const WIDTHS: Record<string, number> = {};
const widthTable = [
  ["0123456789", 556],
  ["abdeghnopquđ", 556],
  ["cksvxyz", 500],
  ["ijl", 222],
  ["ft", 278],
  ["r", 333],
  ["m", 833],
  ["w", 722],
  ["ABCDEĐHNRUV", 700],
  ["FLPSTXYZ", 620],
  ["GOQ", 778],
  ["IJ", 278],
  ["KM", 760],
  ["W", 944],
  ["_#", 556],
  ["-()", 333],
  [".,/ ", 278],
  ["+", 584],
] as const;
for (const [chars, width] of widthTable) for (const char of chars) WIDTHS[char] = width;

function glyphWidth(char: string): number {
  const base = char.normalize("NFD")[0] ?? char;
  return WIDTHS[base] ?? WIDTHS[base.toLowerCase()] ?? 556;
}

// How wide the first character of `word` is, going by how wide the whole word is on the page.
function firstCharWidth(word: BboxWord): number {
  const chars = [...word.text];
  const total = chars.reduce((sum, char) => sum + glyphWidth(char), 0);
  return total === 0 ? word.x1 - word.x0 : ((word.x1 - word.x0) * glyphWidth(chars[0])) / total;
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

const lineWidth = (line: BboxWord[]) => line[line.length - 1].x1 - line[0].x0;

// A wrapped cell's lines glued back together. The browser fills each line to the
// column's width and breaks inside a word when it has to, so a line that stops well
// short of full did NOT break mid-word: the next word started a new line because of a
// space. A line that is full could have broken either way, and a break inside a word
// is by far the likelier. A hyphen or slash is itself a place to break, so a line
// ending in one goes on without a space. `width` is the room a line has; when it is
// too generous a space appears inside a SKU, too tight and one goes missing, so it is
// kept on the tight side (see readOrderInfo).
function joinLines(lines: BboxWord[][], width: number): string {
  let text = "";
  lines.forEach((line, i) => {
    const lineText = line.map((w) => w.text).join(" ");
    if (i === 0) {
      text = lineText;
      return;
    }
    const breakable = /[-/]$/.test(text);
    text += !breakable && lineWidth(lines[i - 1]) + firstCharWidth(line[0]) <= width ? ` ${lineText}` : lineText;
  });
  return text.trim();
}

// Total horizontal padding of a table cell (both sides), in points, and how far under
// the room the header suggests a line is assumed to hold (it is an estimate, and a
// space that appears where there is none does more harm than one that goes missing).
const CELL_PADDING = 1.8;
const ROOM_MARGIN = 0.6;
// Header and body text start at the same x; a body word may sit this far left of it.
const COLUMN_SLACK = 1.5;

// `words` are one label's words (a label alone on its page, or one cell of a tiled
// sheet). Null when the label has no order-info block.
export function readOrderInfo(words: BboxWord[]): OrderInfo | null {
  const heading = findOrderInfoHeadings(words)[0];
  if (!heading) return null;
  const info: OrderInfo = { top: heading.y0, skus: new Map() };

  const below = words.filter((w) => w.y0 > heading.y1 && w.x0 >= heading.x0 - 40);
  const hash = below.filter((w) => w.text === "#").sort((a, b) => a.y0 - b.y0)[0];
  if (!hash) return info;

  // Column starts, read off the header line.
  const header = below.filter((w) => Math.abs(w.y0 - hash.y0) < 1.5).sort((a, b) => a.x0 - b.x0);
  const sku = header.find((w) => w.text === "SKU");
  const name = header.find((w) => w.text === "Tên");
  if (!sku || !name) return info;
  // Only the "SKU" column is read — not "SKU phân loại", which sits further right.
  const { from, to } = { from: sku.x0, to: name.x0 };

  // Body rows start at each number in the "#" column.
  const body = below.filter((w) => w.y0 > hash.y1);
  const rows = body
    .filter((w) => /^\d+$/.test(w.text) && w.x0 >= hash.x0 - COLUMN_SLACK && w.x0 < sku.x0 - COLUMN_SLACK)
    .sort((a, b) => a.y0 - b.y0);

  // Every row's lines of the SKU column, so the room a line has can be checked against
  // the fullest line actually printed: a line can't be wider than its column.
  const cells = rows.map((row, i) => {
    const bottom = rows[i + 1]?.y0 ?? Infinity;
    const inRow = body.filter((w) => w.y0 >= row.y0 - 1 && w.y0 < bottom - 1);
    return linesOf(inRow.filter((w) => w.x0 >= from - COLUMN_SLACK && w.x0 < to - COLUMN_SLACK));
  });
  const room = Math.max(to - from - CELL_PADDING - ROOM_MARGIN, ...cells.flatMap((lines) => lines.map(lineWidth)));

  rows.forEach((row, i) => {
    const text = joinLines(cells[i], room);
    if (text) info.skus.set(Number(row.text), text);
  });
  return info;
}

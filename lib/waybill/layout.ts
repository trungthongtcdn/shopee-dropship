import { parseLabelText, type WaybillPage } from "./items";
import { findOrderInfoHeadings, readOrderInfo } from "./orderInfo";

// Waybill PDFs come in two shapes: one label per page (the usual A6 download —
// handled by items.ts on plain `pdftotext -layout` text), or several labels
// tiled on one sheet in an even grid (a browser's "N pages per sheet" print:
// Letter, 3×3 = 9 labels). This file reads the second shape.
//
// For a tiled sheet `-layout` text interleaves the labels line by line, so the
// text is read from `pdftotext -bbox` instead (every word with its position):
// find the grid, hand each cell's words back as the lines of ONE label, and let
// items.ts read them exactly as it reads a single-label page.
//
// A label's slot is  sheet × (cols × rows) + cell,  cells counted row by row.

export interface BboxWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BboxPage {
  width: number;
  height: number;
  words: BboxWord[];
}

export interface SheetLayout {
  cols: number;
  rows: number;
  // Every slot holding any text at all — including cells that don't read as an
  // order, so re-ordering can keep them instead of dropping them.
  occupied: number[];
  // Labels followed by an order-info table (see orderInfo.ts) → the height of the label
  // proper in points, from the top of its cell down to just above that table. Output
  // PDFs show only this part. Absent for sheets whose labels have nothing below them.
  labelHeights?: Record<number, number>;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, name: string) => ENTITIES[name]).normalize("NFC");

// `pdftotext -bbox` output: <page width= height=> containing <word xMin= …>.
export function parseBboxXml(xml: string): BboxPage[] {
  const pages: BboxPage[] = [];
  const token =
    /<page width="([\d.]+)" height="([\d.]+)">|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;

  for (const match of xml.matchAll(token)) {
    if (match[1] !== undefined) {
      pages.push({ width: Number(match[1]), height: Number(match[2]), words: [] });
    } else if (pages.length > 0) {
      pages[pages.length - 1].words.push({
        text: decode(match[7]),
        x0: Number(match[3]),
        y0: Number(match[4]),
        x1: Number(match[5]),
        y1: Number(match[6]),
      });
    }
  }
  return pages;
}

// Cheap check on the ordinary `-layout` text: a one-label-per-page document has
// exactly one "Mã vận đơn:" per page; more than one means labels are tiled.
export function looksTiled(layoutText: string): boolean {
  return layoutText.split("\f").some((page) => (page.match(/Mã vận đơn:/g) ?? []).length > 1);
}

interface Anchor {
  x: number;
  y: number;
}

// Where each label says its order id ("Mã đơn hàng:" / "Mã đơn đặt trước:"):
// the position of the "Mã" that starts it. Every label has exactly one, and it
// sits near the label's top — which is what the grid check below relies on.
function orderAnchors(page: BboxPage): Anchor[] {
  const anchors: Anchor[] = [];
  const nextWord = (from: BboxWord, text: string) =>
    page.words.find((w) => w.text === text && Math.abs(w.y0 - from.y0) < 1 && w.x0 >= from.x1 - 0.5 && w.x0 - from.x1 < 4);

  for (const ma of page.words) {
    if (ma.text !== "Mã") continue;
    const don = nextWord(ma, "đơn");
    if (!don) continue;
    const hang = nextWord(don, "hàng:");
    const dat = hang ? undefined : nextWord(don, "đặt");
    if (hang || (dat && nextWord(dat, "trước:"))) anchors.push({ x: ma.x0, y: ma.y0 });
  }
  return anchors;
}

type Grid = { cols: number; rows: number };

// Every even grid up to 4×4 that has room for the busiest sheet. Which one is
// real is decided in detectGrid.
function candidateGrids(maxLabels: number): Grid[] {
  const grids: Grid[] = [];
  for (let cols = 1; cols <= 4; cols++) {
    for (let rows = 1; rows <= 4; rows++) {
      if (cols * rows >= Math.max(2, maxLabels)) grids.push({ cols, rows });
    }
  }
  return grids;
}

function cellOf(grid: { cols: number; rows: number }, page: BboxPage, x: number, y: number) {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / (page.width / grid.cols))));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / (page.height / grid.rows))));
  return { col, row, index: row * grid.cols + col };
}

// In the real grid the lines between cells run through the white gutters between
// labels (at least ~7 pt wide on real sheets); in a wrong one they cut through
// label text. A word anywhere in a thin band round the line counts as cutting it,
// so a line that happens to fall in the 1–2 pt gap between two words doesn't pass.
const EDGE_BAND = 2;
// Some prints set text flush against the cell's own edge (an order-info table that
// starts exactly where its cell does). `flush` lets a word that starts at or just
// after the line stay; one that begins before it, or ends right up against it, still cuts.
const FLUSH_TOLERANCE = 0.5;

function textCrossesCellEdge(grid: Grid, page: BboxPage, flush: boolean): boolean {
  const xs = Array.from({ length: grid.cols - 1 }, (_, i) => ((i + 1) * page.width) / grid.cols);
  const ys = Array.from({ length: grid.rows - 1 }, (_, i) => ((i + 1) * page.height) / grid.rows);
  const cuts = (from: number, to: number, line: number) =>
    flush ? from < line - FLUSH_TOLERANCE && to > line - EDGE_BAND : from < line + EDGE_BAND && to > line - EDGE_BAND;
  return page.words.some((w) => xs.some((x) => cuts(w.x0, w.x1, x)) || ys.some((y) => cuts(w.y0, w.y1, y)));
}

// How much of its cell the text of an average label takes up, 0..1. Browsers
// scale every label to fit its cell, so under the real grid the text fills most of
// the cell; under a finer or coarser one that still passes the checks (a sparse
// sheet can) the labels sit in cells too big for them. Only cells that hold an
// order id count — a stray note in another cell says nothing about the grid.
function meanFill(grid: Grid, pages: BboxPage[], anchors: Anchor[][]): number {
  let total = 0;
  let cells = 0;
  pages.forEach((page, p) => {
    const labelCells = new Set(anchors[p].map((a) => cellOf(grid, page, a.x, a.y).index));
    const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number }>();
    for (const w of page.words) {
      const index = cellOf(grid, page, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2).index;
      const box = boxes.get(index);
      if (!box) boxes.set(index, { x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 });
      else {
        box.x0 = Math.min(box.x0, w.x0);
        box.y0 = Math.min(box.y0, w.y0);
        box.x1 = Math.max(box.x1, w.x1);
        box.y1 = Math.max(box.y1, w.y1);
      }
    }
    const cellArea = (page.width / grid.cols) * (page.height / grid.rows);
    for (const [index, box] of boxes) {
      if (!labelCells.has(index)) continue;
      total += ((box.x1 - box.x0) * (box.y1 - box.y0)) / cellArea;
      cells += 1;
    }
  });
  return cells === 0 ? 0 : total / cells;
}

// The even grid under which every sheet's order anchors land in different cells
// and near the top of their cell, with no text cut by a cell edge and every order-info
// block in the cell of its own label — and, when several grids pass that, the one the
// labels fill best. Null when no grid fits: better to say so than to guess a layout and
// read the wrong text.
function detectGrid(pages: BboxPage[], anchors: Anchor[][]): Grid | null {
  const maxLabels = Math.max(0, ...anchors.map((a) => a.length));
  if (maxLabels < 2) return null;

  // One grid for the whole document, so every sheet must be the same size.
  if (pages.some((p) => Math.abs(p.width - pages[0].width) > 1 || Math.abs(p.height - pages[0].height) > 1)) return null;

  const headings = pages.map((page) => findOrderInfoHeadings(page.words));

  const fits = (grid: Grid, flush: boolean) =>
    pages.every((page, i) => {
      if (textCrossesCellEdge(grid, page, flush)) return false;
      const seen = new Set<number>();
      const anchored = anchors[i].every((anchor) => {
        const cell = cellOf(grid, page, anchor.x, anchor.y);
        const cellTop = cell.row * (page.height / grid.rows);
        const nearTop = anchor.y - cellTop <= 0.3 * (page.height / grid.rows);
        if (!nearTop || seen.has(cell.index)) return false;
        seen.add(cell.index);
        return true;
      });
      // A label's order-info table belongs to that label: a grid that puts it in a
      // cell of its own (under the label, say) is not the layout of this sheet.
      return anchored && headings[i].every((heading) => seen.has(cellOf(grid, page, heading.x0, heading.y0).index));
    });

  // Where labels carry an order-info table the unit on the sheet is label + table, and
  // a grid with a cell that no sheet uses, below one that some sheet does, is a finer
  // grid than the sheet really has (blocks sitting two cells apart, each half as wide
  // as its cell): the coarser grid that describes them exactly is the better reading.
  // (Without tables there is nothing to tell a sheet whose second column is empty from
  // a coarser sheet, and the finer reading stands.)
  const hasInfo = headings.some((list) => list.length > 0);
  const hasGap = (grid: Grid) => {
    if (!hasInfo) return false;
    const used = new Set<number>();
    pages.forEach((page, i) => anchors[i].forEach((anchor) => used.add(cellOf(grid, page, anchor.x, anchor.y).index)));
    return Math.max(...used) + 1 > used.size;
  };

  const pick = (flush: boolean): Grid | null => {
    const valid = candidateGrids(maxLabels)
      .filter((grid) => fits(grid, flush))
      .map((grid) => ({ grid, fill: meanFill(grid, pages, anchors), gap: hasGap(grid) }));
    const pool = valid.some((v) => !v.gap) ? valid.filter((v) => !v.gap) : valid;

    let best: (typeof pool)[number] | null = null;
    for (const v of pool) {
      const better = !best || v.fill > best.fill + 1e-9 || (Math.abs(v.fill - best.fill) <= 1e-9 && v.grid.cols * v.grid.rows < best.grid.cols * best.grid.rows);
      if (better) best = v;
    }
    return best?.grid ?? null;
  };

  // The strict reading first; only a sheet it can't explain gets the flush-tolerant one.
  return pick(false) ?? pick(true);
}

// One cell's words as the text lines `-layout` would print for that label alone:
// words on the same baseline form a line, a wide horizontal gap becomes the 3+
// spaces items.ts cuts the label's right-hand column on, and a vertical gap of
// more than a line becomes a blank line.
export function cellText(words: BboxWord[]): string {
  const sorted = [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1) || a.x0 - b.x0);

  const lines: BboxWord[][] = [];
  for (const word of sorted) {
    const line = lines[lines.length - 1];
    const centre = (word.y0 + word.y1) / 2;
    if (line && Math.abs(centre - (line[0].y0 + line[0].y1) / 2) <= 0.5 * (line[0].y1 - line[0].y0)) line.push(word);
    else lines.push([word]);
  }

  const out: string[] = [];
  let previous: { top: number; height: number } | null = null;
  for (const line of lines) {
    line.sort((a, b) => a.x0 - b.x0);
    const height = Math.max(...line.map((w) => w.y1 - w.y0));
    const top = Math.min(...line.map((w) => w.y0));
    if (previous && top - previous.top > 1.7 * previous.height) out.push("");
    previous = { top, height };

    let text = line[0].text;
    for (let i = 1; i < line.length; i++) {
      text += (line[i].x0 - line[i - 1].x1 > 1.2 * height ? "   " : " ") + line[i].text;
    }
    out.push(text);
  }
  return out.join("\n");
}

export interface TiledCell {
  slot: number;
  // The cell's words as the lines `-layout` would print for that label alone.
  text: string;
}

// The label proper ends this far above its order-info heading (the label's own
// border sits just above the heading's text).
const LABEL_BOTTOM_GAP = 2;

// Every label of a document read by position, plus the grid they sit in and the text
// of each non-empty cell (for callers that read more from a label than its product
// lines). That is a tiled document, or one whose labels carry an order-info table
// (read as one label per sheet). Null when the sheets don't fit any grid we recognise.
export function extractTiledLabels(pages: BboxPage[]): { labels: WaybillPage[]; layout: SheetLayout; cells: TiledCell[] } | null {
  const anchors = pages.map(orderAnchors);
  let grid = detectGrid(pages, anchors);
  // One label per sheet has no grid to find; with an order-info table under it, it
  // still needs reading by position (and cutting), and the "grid" is the sheet.
  if (
    !grid &&
    anchors.every((a) => a.length <= 1) &&
    pages.every((p) => Math.abs(p.width - pages[0].width) <= 1 && Math.abs(p.height - pages[0].height) <= 1) &&
    pages.some((p) => findOrderInfoHeadings(p.words).length > 0)
  ) {
    grid = { cols: 1, rows: 1 };
  }
  if (!grid) return null;

  const perSheet = grid.cols * grid.rows;
  const labels: WaybillPage[] = [];
  const occupied: number[] = [];
  const texts: TiledCell[] = [];
  const labelHeights: Record<number, number> = {};

  pages.forEach((page, sheet) => {
    const cells: BboxWord[][] = Array.from({ length: perSheet }, () => []);
    for (const word of page.words) {
      cells[cellOf(grid, page, (word.x0 + word.x1) / 2, (word.y0 + word.y1) / 2).index].push(word);
    }
    cells.forEach((words, cell) => {
      if (words.length === 0) return;
      const slot = sheet * perSheet + cell;
      occupied.push(slot);
      const text = cellText(words);
      texts.push({ slot, text });
      const label = parseLabelText(text, slot);
      if (label) labels.push(label);

      const info = readOrderInfo(words);
      if (!info) return;
      labelHeights[slot] = Math.max(0, info.top - LABEL_BOTTOM_GAP - Math.floor(cell / grid.cols) * (page.height / grid.rows));
      // The table's row n lists the label's n-th product.
      label?.items.forEach((item, i) => {
        const sku = info.skus.get(i + 1);
        if (sku) item.sku = sku;
      });
    });
  });

  const layout: SheetLayout = { cols: grid.cols, rows: grid.rows, occupied };
  if (Object.keys(labelHeights).length > 0) layout.labelHeights = labelHeights;
  return { labels, layout, cells: texts };
}

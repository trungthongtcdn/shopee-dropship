import { parseLabelText, type WaybillPage } from "./items";

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

// A label is an upright rectangle (A6-ish, height about 1.4× its width) printed
// scaled into its cell, so a plausible cell is at least as tall as it is wide —
// that rules out grids like 2×3 on a portrait sheet, which would otherwise fit a
// sparse sheet (two or three labels) as well as the real grid does.
const MIN_CELL_ASPECT = 1.0;
const MAX_CELL_ASPECT = 1.9;

function candidateGrids(maxLabels: number, page: BboxPage): { cols: number; rows: number }[] {
  const grids: { cols: number; rows: number }[] = [];
  for (let cols = 1; cols <= 4; cols++) {
    for (let rows = 1; rows <= 4; rows++) {
      const aspect = page.height / rows / (page.width / cols);
      if (cols * rows >= Math.max(2, maxLabels) && aspect >= MIN_CELL_ASPECT && aspect <= MAX_CELL_ASPECT) grids.push({ cols, rows });
    }
  }
  // Fewest cells first (a finer grid than the real one would also "fit"), then
  // the one whose cells are closest to an upright label's shape.
  const shape = (g: { cols: number; rows: number }) => Math.abs(Math.log(page.height / g.rows / (page.width / g.cols) / 1.4));
  return grids.sort((a, b) => a.cols * a.rows - b.cols * b.rows || shape(a) - shape(b));
}

function cellOf(grid: { cols: number; rows: number }, page: BboxPage, x: number, y: number) {
  const col = Math.min(grid.cols - 1, Math.max(0, Math.floor(x / (page.width / grid.cols))));
  const row = Math.min(grid.rows - 1, Math.max(0, Math.floor(y / (page.height / grid.rows))));
  return { col, row, index: row * grid.cols + col };
}

// In the real grid the lines between cells run through the white gaps between
// labels; in a wrong one they cut straight through label text.
function textCrossesCellEdge(grid: { cols: number; rows: number }, page: BboxPage): boolean {
  const xs = Array.from({ length: grid.cols - 1 }, (_, i) => ((i + 1) * page.width) / grid.cols);
  const ys = Array.from({ length: grid.rows - 1 }, (_, i) => ((i + 1) * page.height) / grid.rows);
  return page.words.some(
    (w) => xs.some((x) => w.x0 < x - 0.5 && w.x1 > x + 0.5) || ys.some((y) => w.y0 < y - 0.5 && w.y1 > y + 0.5)
  );
}

// The even grid under which every sheet's order anchors land in different cells
// and near the top of their cell, with no text cut by a cell edge. Null when no grid fits — better to say so than
// to guess a layout and read the wrong text.
function detectGrid(pages: BboxPage[], anchors: Anchor[][]): { cols: number; rows: number } | null {
  const maxLabels = Math.max(0, ...anchors.map((a) => a.length));
  if (maxLabels < 2) return null;

  // One grid for the whole document, so every sheet must be the same size.
  if (pages.some((p) => Math.abs(p.width - pages[0].width) > 1 || Math.abs(p.height - pages[0].height) > 1)) return null;

  return (
    candidateGrids(maxLabels, pages[0]).find((grid) =>
      pages.every((page, i) => {
        if (textCrossesCellEdge(grid, page)) return false;
        const seen = new Set<number>();
        return anchors[i].every((anchor) => {
          const cell = cellOf(grid, page, anchor.x, anchor.y);
          const cellTop = cell.row * (page.height / grid.rows);
          const nearTop = anchor.y - cellTop <= 0.3 * (page.height / grid.rows);
          if (!nearTop || seen.has(cell.index)) return false;
          seen.add(cell.index);
          return true;
        });
      })
    ) ?? null
  );
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

// Every label of a tiled document, plus the grid they sit in and the text of each
// non-empty cell (for callers that read more from a label than its product lines).
// Null when the sheets don't fit any grid we recognise.
export function extractTiledLabels(pages: BboxPage[]): { labels: WaybillPage[]; layout: SheetLayout; cells: TiledCell[] } | null {
  const grid = detectGrid(pages, pages.map(orderAnchors));
  if (!grid) return null;

  const perSheet = grid.cols * grid.rows;
  const labels: WaybillPage[] = [];
  const occupied: number[] = [];
  const texts: TiledCell[] = [];

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
    });
  });

  return { labels, layout: { cols: grid.cols, rows: grid.rows, occupied }, cells: texts };
}

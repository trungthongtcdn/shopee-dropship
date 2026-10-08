import { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle } from "pdf-lib";
import type { SheetLayout } from "./layout";
import { rasterizePages, type PageRaster } from "./raster";

// The re-ordered PDF in a layout of the user's choosing: N labels per A4 sheet,
// whatever the source looked like (one label per page, or tiled several to a
// sheet). Each label is cut out of the source, scaled to fit its cell and drawn
// there; the source sheets are embedded once and drawn through clipping, so the
// labels stay vector (sharp, searchable) and the file stays about the source's size.

export const PER_PAGE_OPTIONS = [2, 4, 6, 9] as const;
export type PerPage = (typeof PER_PAGE_OPTIONS)[number];

// What a form field / setting holds → the choice. Empty, "same" and null mean "keep
// the layout of the source file" (null); anything else that isn't 2, 4, 6 or 9 is
// a mistake worth refusing rather than guessing at.
export function parsePerPage(value: unknown): PerPage | null {
  if (value === null || value === undefined || value === "" || value === "same") return null;
  const n = typeof value === "number" ? value : Number(value);
  if ((PER_PAGE_OPTIONS as readonly number[]).includes(n)) return n as PerPage;
  throw new RangeError(`Định dạng PDF không hợp lệ: ${String(value)}`);
}

const A4_SHORT = 595.276;
const A4_LONG = 841.89;

export interface OutputSheet {
  cols: number;
  rows: number;
  width: number; // pt
  height: number;
}

// A4, turned whichever way gives each label the roomiest cell: 2 labels side by
// side and 6 as 3×2 on landscape paper, 4 as 2×2 and 9 as 3×3 on portrait.
export function outputSheet(perPage: PerPage): OutputSheet {
  switch (perPage) {
    case 2:
      return { cols: 2, rows: 1, width: A4_LONG, height: A4_SHORT };
    case 4:
      return { cols: 2, rows: 2, width: A4_SHORT, height: A4_LONG };
    case 6:
      return { cols: 3, rows: 2, width: A4_LONG, height: A4_SHORT };
    case 9:
      return { cols: 3, rows: 3, width: A4_SHORT, height: A4_LONG };
  }
}

// Finding label edges means drawing every page to a picture; a document with this
// many pages is far beyond a real waybill batch (and could only be one built to eat
// the server's memory), so its labels are cut by whole tile instead.
const MAX_RASTER_PAGES = 300;

// Home printers can't print to the paper's edge, and cut lines want a little air.
export const PAGE_MARGIN = 14;
export const CELL_PADDING = 3;

// Where a label is on its source sheet, in PDF points (origin bottom-left).
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The part of `tile` that has ink on it (plus a hair of margin) — the label
// itself, without the blank paper around it. A label printed top-left on an A4
// sheet, or a cell with empty space round the label, would otherwise be scaled as
// if the whole tile were the label. The tile itself when it is blank or the
// picture is unusable.
function contentRect(raster: PageRaster | undefined, pageWidth: number, pageHeight: number, tile: Rect): Rect {
  if (!raster) return tile;
  const sx = raster.width / pageWidth;
  const sy = raster.height / pageHeight;
  // PDF y counts up from the bottom; pixel rows count down from the top.
  const left = Math.max(0, Math.floor(tile.x * sx));
  const right = Math.min(raster.width, Math.ceil((tile.x + tile.width) * sx));
  const top = Math.max(0, Math.floor((pageHeight - tile.y - tile.height) * sy));
  const bottom = Math.min(raster.height, Math.ceil((pageHeight - tile.y) * sy));

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = top; y < bottom; y++) {
    const row = y * raster.width;
    for (let x = left; x < right; x++) {
      if (raster.pixels[row + x] < 235) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return tile;

  const pad = 2; // pixels
  const x0 = Math.max(tile.x, (minX - pad) / sx);
  const x1 = Math.min(tile.x + tile.width, (maxX + 1 + pad) / sx);
  const yTop = Math.min(tile.y + tile.height, pageHeight - (minY - pad) / sy);
  const yBottom = Math.max(tile.y, pageHeight - (maxY + 1 + pad) / sy);
  const found = { x: x0, y: yBottom, width: x1 - x0, height: yTop - yBottom };
  // A speck of dust is not a label.
  return found.width < tile.width * 0.2 || found.height < tile.height * 0.2 ? tile : found;
}

// `layout` describes how the SOURCE is tiled (null: one label per page). `order`
// lists label slots (see layout.ts; for a one-label-per-page source, page numbers)
// in the order they should appear; slots it doesn't name but that hold something
// follow in their original order, and a slot is used at most once — nothing is
// dropped, nothing repeats.
export async function composeLabelsPdf(source: Buffer, layout: SheetLayout | null, order: number[], perPage: PerPage): Promise<Buffer> {
  const sourceDoc = await PDFDocument.load(source);
  const pageCount = sourceDoc.getPageCount();
  const perSheet = layout ? layout.cols * layout.rows : 1;
  const occupied = layout ? layout.occupied : Array.from({ length: pageCount }, (_, i) => i);
  const occupiedSet = new Set(occupied);

  // A page with no content at all (a blank sheet) can't be embedded by pdf-lib, and
  // has nothing to show.
  const hasContents = (sheet: number) => sourceDoc.getPage(sheet).node.Contents() !== undefined;

  const used = new Set<number>();
  const sequence: number[] = [];
  for (const slot of order) {
    if (Number.isInteger(slot) && occupiedSet.has(slot) && Math.floor(slot / perSheet) < pageCount && !used.has(slot)) {
      used.add(slot);
      sequence.push(slot);
    }
  }
  // Slots nobody named follow in their original order — except blank pages: leaving
  // one in would only waste a cell.
  for (const slot of [...occupied].sort((a, b) => a - b)) {
    if (!used.has(slot) && Math.floor(slot / perSheet) < pageCount && hasContents(Math.floor(slot / perSheet))) sequence.push(slot);
  }

  // Which part of its sheet each label sits on: the grid cell, or the whole page —
  // cut above the order-info table when the label has one (layout.labelHeights), so
  // the SKU list never reaches the output.
  const tileOf = (slot: number): { sheet: number; tile: Rect } => {
    const sheet = Math.floor(slot / perSheet);
    const { width, height } = sourceDoc.getPage(sheet).getSize();
    const cell = layout ? slot % perSheet : 0;
    const cols = layout?.cols ?? 1;
    const cellWidth = width / cols;
    const cellHeight = height / (layout?.rows ?? 1);
    const shown = Math.min(cellHeight, layout?.labelHeights?.[slot] ?? cellHeight);
    const top = height - Math.floor(cell / cols) * cellHeight;
    return { sheet, tile: { x: (cell % cols) * cellWidth, y: top - shown, width: cellWidth, height: shown } };
  };

  // A label that is named but sits on a blank page is left as an empty cell.
  const sheetsNeeded = [...new Set(sequence.map((slot) => Math.floor(slot / perSheet)))].filter(hasContents);
  // The picture is only a means of finding the label's edges; without it the whole
  // tile is used, which is still correct, just looser.
  const rasters =
    pageCount > MAX_RASTER_PAGES
      ? ([] as PageRaster[])
      : await rasterizePages(source).catch((error) => {
          console.error("[compose] rasterising for label edges failed, using whole tiles:", error);
          return [] as PageRaster[];
        });

  const output = await PDFDocument.create();
  const embedded = new Map<number, Awaited<ReturnType<PDFDocument["embedPdf"]>>[number]>();
  (await output.embedPdf(sourceDoc, sheetsNeeded)).forEach((page, i) => embedded.set(sheetsNeeded[i], page));

  const format = outputSheet(perPage);
  const cellWidth = (format.width - 2 * PAGE_MARGIN) / format.cols;
  const cellHeight = (format.height - 2 * PAGE_MARGIN) / format.rows;
  const perOutputSheet = format.cols * format.rows;

  for (let start = 0; start < sequence.length; start += perOutputSheet) {
    const sheet = output.addPage([format.width, format.height]);
    sequence.slice(start, start + perOutputSheet).forEach((slot, position) => {
      const { sheet: sourceSheet, tile } = tileOf(slot);
      const sourcePage = embedded.get(sourceSheet);
      if (!sourcePage) return;
      const { width: pageWidth, height: pageHeight } = sourceDoc.getPage(sourceSheet).getSize();
      const label = contentRect(rasters[sourceSheet], pageWidth, pageHeight, tile);

      const scale = Math.min((cellWidth - 2 * CELL_PADDING) / label.width, (cellHeight - 2 * CELL_PADDING) / label.height);
      const drawWidth = label.width * scale;
      const drawHeight = label.height * scale;
      // Centred in its cell; cells are counted from the top-left, PDF y from the bottom.
      const cellLeft = PAGE_MARGIN + (position % format.cols) * cellWidth;
      const cellBottom = format.height - PAGE_MARGIN - (Math.floor(position / format.cols) + 1) * cellHeight;
      const left = cellLeft + (cellWidth - drawWidth) / 2;
      const bottom = cellBottom + (cellHeight - drawHeight) / 2;

      sheet.pushOperators(pushGraphicsState(), rectangle(left, bottom, drawWidth, drawHeight), clip(), endPath());
      sheet.drawPage(sourcePage, { x: left - label.x * scale, y: bottom - label.y * scale, xScale: scale, yScale: scale });
      sheet.pushOperators(popGraphicsState());
    });
  }
  return Buffer.from(await output.save());
}


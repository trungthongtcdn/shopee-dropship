import { PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle } from "pdf-lib";
import { waybillFileStem } from "./excel";
import type { SheetLayout } from "./layout";

export function waybillSortedPdfFileName(at: Date): string {
  return `${waybillFileStem(at)}.pdf`;
}

// A copy of `source` with its pages rearranged: first `order` (0-based page
// numbers, e.g. from orderedPageIndexes), then every page the list didn't name,
// in its original order. Nothing is ever dropped — a cover sheet or a page the
// parser couldn't read as an order still ends up in the file — and a page is
// used at most once, however the list repeats or overshoots. The pages are
// copied, not re-rendered, so the labels stay sharp and their text stays
// selectable/searchable.
export async function reorderPdfPages(source: Buffer, order: number[]): Promise<Buffer> {
  const sourceDoc = await PDFDocument.load(source);
  const pageCount = sourceDoc.getPageCount();

  const used = new Set<number>();
  const sequence: number[] = [];
  for (const index of order) {
    if (Number.isInteger(index) && index >= 0 && index < pageCount && !used.has(index)) {
      used.add(index);
      sequence.push(index);
    }
  }
  for (let index = 0; index < pageCount; index++) {
    if (!used.has(index)) sequence.push(index);
  }

  const output = await PDFDocument.create();
  // One copyPages call for the whole sequence: pdf-lib then copies the fonts and
  // other resources shared between pages once instead of once per page.
  for (const page of await output.copyPages(sourceDoc, sequence)) output.addPage(page);
  return Buffer.from(await output.save());
}

// The same for a PDF with several labels tiled on each sheet: a new PDF with the
// same sheet size and the same grid, whose cells hold the labels in `order`
// (label slots, see layout.ts) filled row by row, sheet after sheet. Slots the
// list doesn't name but that hold something keep their original order after the
// listed ones, and a slot is used at most once. Empty cells are not carried over
// (that is what closes the gaps), so the last sheet is simply shorter.
//
// Each source sheet is embedded ONCE and drawn once per label, clipped to that
// label's cell — the fonts and barcodes are shared, so the file stays about the
// size of the original — and the labels stay vector, sharp and searchable.
export async function reorderPdfLabels(source: Buffer, layout: SheetLayout, order: number[]): Promise<Buffer> {
  const { cols, rows } = layout;
  const perSheet = cols * rows;
  const occupied = new Set(layout.occupied);

  const used = new Set<number>();
  const sequence: number[] = [];
  for (const slot of order) {
    if (Number.isInteger(slot) && occupied.has(slot) && !used.has(slot)) {
      used.add(slot);
      sequence.push(slot);
    }
  }
  for (const slot of [...occupied].sort((a, b) => a - b)) {
    if (!used.has(slot)) sequence.push(slot);
  }

  const sourceDoc = await PDFDocument.load(source);
  // A page with no content at all can't be embedded by pdf-lib (and has nothing to show).
  const sheetsNeeded = [...new Set(sequence.map((slot) => Math.floor(slot / perSheet)))].filter(
    (sheet) => sheet < sourceDoc.getPageCount() && sourceDoc.getPage(sheet).node.Contents() !== undefined
  );
  const output = await PDFDocument.create();
  const embedded = new Map<number, Awaited<ReturnType<PDFDocument["embedPdf"]>>[number]>();
  (await output.embedPdf(sourceDoc, sheetsNeeded)).forEach((page, i) => embedded.set(sheetsNeeded[i], page));

  const { width, height } = sourceDoc.getPage(0).getSize();
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  // PDF coordinates start at the bottom-left; cells are counted from the top-left.
  const cellOrigin = (cell: number) => ({
    x: (cell % cols) * cellWidth,
    y: height - (Math.floor(cell / cols) + 1) * cellHeight,
  });

  for (let start = 0; start < sequence.length; start += perSheet) {
    const sheet = output.addPage([width, height]);
    sequence.slice(start, start + perSheet).forEach((slot, position) => {
      const sourcePage = embedded.get(Math.floor(slot / perSheet));
      if (!sourcePage) return;
      const from = cellOrigin(slot % perSheet);
      const to = cellOrigin(position);

      sheet.pushOperators(pushGraphicsState(), rectangle(to.x, to.y, cellWidth, cellHeight), clip(), endPath());
      sheet.drawPage(sourcePage, { x: to.x - from.x, y: to.y - from.y });
      sheet.pushOperators(popGraphicsState());
    });
  }
  return Buffer.from(await output.save());
}

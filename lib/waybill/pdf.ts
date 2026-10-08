import { PDFDocument } from "pdf-lib";
import { waybillFileStem } from "./excel";

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

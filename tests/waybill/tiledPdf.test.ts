import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { makePdf } from "./pdfFixture";
import { reorderPdfLabels } from "@/lib/waybill/pdf";
import type { SheetLayout } from "@/lib/waybill/layout";
import { makeTiledPdf, renderedCellIds, SHEET_HEIGHT, SHEET_WIDTH } from "./tiledFixture";

// 2×2 labels per sheet. Cell ids double as slots: slot = sheet × 4 + cell, so a
// cell's id is its own slot number and any move shows up in the rendered output.
const COLS = 2;
const ROWS = 2;
const layout = (occupied: number[]): SheetLayout => ({ cols: COLS, rows: ROWS, occupied });

// Two sheets: 0-3 on the first, 4-6 on the second (slot 7 left empty).
async function sevenLabels() {
  return makeTiledPdf(COLS, ROWS, [
    [0, 1, 2, 3],
    [4, 5, 6, null],
  ]);
}
const SEVEN = [0, 1, 2, 3, 4, 5, 6];

describe("reorderPdfLabels", () => {
  it("puts every label in the requested place, filling sheets row by row", async () => {
    const out = await reorderPdfLabels(await sevenLabels(), layout(SEVEN), [6, 5, 4, 3, 2, 1, 0]);
    expect(await renderedCellIds(out, COLS, ROWS)).toEqual([
      [6, 5, 4, 3],
      [2, 1, 0, null],
    ]);
  });

  it("moves labels across sheets, not just within one", async () => {
    const out = await reorderPdfLabels(await sevenLabels(), layout(SEVEN), [4, 0, 5, 1, 6, 2, 3]);
    expect(await renderedCellIds(out, COLS, ROWS)).toEqual([
      [4, 0, 5, 1],
      [6, 2, 3, null],
    ]);
  });

  it("keeps labels the list doesn't mention, after the listed ones, in their original order", async () => {
    const out = await reorderPdfLabels(await sevenLabels(), layout(SEVEN), [3]);
    expect(await renderedCellIds(out, COLS, ROWS)).toEqual([
      [3, 0, 1, 2],
      [4, 5, 6, null],
    ]);
  });

  it("uses each label once even if the list repeats, overshoots or names an empty cell", async () => {
    // 7 is an empty cell; 99 and -1 don't exist.
    const out = await reorderPdfLabels(await sevenLabels(), layout(SEVEN), [1, 1, 99, 7, -1, 0]);
    expect(await renderedCellIds(out, COLS, ROWS)).toEqual([
      [1, 0, 2, 3],
      [4, 5, 6, null],
    ]);
  });

  it("closes the gaps left by empty cells", async () => {
    const source = await makeTiledPdf(COLS, ROWS, [
      [0, null, 2, null],
      [null, 5, null, 7],
    ]);
    const out = await reorderPdfLabels(source, layout([0, 2, 5, 7]), [7, 5, 2, 0]);
    expect(await renderedCellIds(out, COLS, ROWS)).toEqual([[7, 5, 2, 0]]);
  });

  it("keeps the sheet size and the original untouched", async () => {
    const source = await sevenLabels();
    const before = Buffer.from(source);
    const out = await reorderPdfLabels(source, layout(SEVEN), [6, 5, 4, 3, 2, 1, 0]);

    expect(source.equals(before)).toBe(true);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: SHEET_WIDTH, height: SHEET_HEIGHT });
  });

  it("does not bloat the file when many labels come from the same sheet", async () => {
    // A heavy 2-sheet source: seven labels are drawn from just two sheets. The sheet
    // content is stored once (about 2× the source here, since pdf-lib writes it
    // uncompressed); embedding a sheet once per label would be ~7× that.
    const heavy = await makeTiledPdf(COLS, ROWS, [[0, 1, 2, 3], [4, 5, 6, null]], 4000);
    expect(heavy.length).toBeGreaterThan(50_000);

    const out = await reorderPdfLabels(heavy, layout(SEVEN), [3, 2, 1, 0, 6, 5, 4]);
    expect(out.length).toBeLessThan(heavy.length * 3.5);
  });

  it("copes with a blank sheet in the source instead of failing", async () => {
    // Sheets: 0 (labels 0-3), 1 (a page with no content at all), 2 (labels 8, 9, 10).
    const doc = await PDFDocument.load(await makeTiledPdf(COLS, ROWS, [[0, 1, 2, 3], [4, 5, 6, null]]));
    const [blank] = await doc.copyPages(await PDFDocument.load(await makePdf(1)), [0]);
    doc.insertPage(1, blank);
    const layoutWithBlank = { cols: COLS, rows: ROWS, occupied: [0, 1, 2, 3, 4, 5, 8, 9, 10] };
    // Slots 4 and 5 sit on the blank sheet: nothing to draw, so those cells stay empty.
    const out = await reorderPdfLabels(Buffer.from(await doc.save()), layoutWithBlank, [5, 4, 3, 2, 1, 0, 10, 9, 8]);
    expect(await renderedCellIds(out, COLS, ROWS)).toEqual([
      [null, null, 3, 2],
      [1, 0, 6, 5],
      [4, null, null, null],
    ]);
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(reorderPdfLabels(Buffer.from("definitely not a pdf"), layout(SEVEN), [0])).rejects.toThrow();
  });
});

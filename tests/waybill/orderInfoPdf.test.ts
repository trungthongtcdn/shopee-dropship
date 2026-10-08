import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { composeLabelsPdf, outputSheet } from "@/lib/waybill/compose";
import { reorderPdfLabels } from "@/lib/waybill/pdf";
import type { SheetLayout } from "@/lib/waybill/layout";
import { idsOf, renderedInk } from "./composeFixture";
import { CUT, LABEL_BOTTOM, LABEL_TOP, makeInfoSheetPdf, renderedCells } from "./infoFixture";
import { SHEET_HEIGHT, SHEET_WIDTH } from "./tiledFixture";

// Labels with an order-info table under them (see orderInfo.ts): the table is for the
// packer and must not reach the PDF that is printed, whichever way the PDF is laid out.

const cellHeight = (rows: number) => SHEET_HEIGHT / rows;
const heights = (slots: number[], rows: number) => Object.fromEntries(slots.map((slot) => [slot, CUT * cellHeight(rows)]));

describe("reorderPdfLabels with order-info tables", () => {
  const layout = (occupied: number[], labelHeights?: Record<number, number>): SheetLayout => ({ cols: 2, rows: 2, occupied, labelHeights });
  const source = () => makeInfoSheetPdf(2, 2, [[0, 1, 2, 3], [4, 5, null, null]]);
  const ALL = [0, 1, 2, 3, 4, 5];

  it("leaves the table out and keeps the label where the order says", async () => {
    const out = await reorderPdfLabels(await source(), layout(ALL, heights(ALL, 2)), [5, 4, 3, 2, 1, 0]);
    const sheets = await renderedCells(out, 2, 2);

    expect(sheets.map((cells) => cells.map((c) => c.label))).toEqual([
      [5, 4, 3, 2],
      [1, 0, null, null],
    ]);
    expect(sheets.flat().filter((c) => c.label !== null).every((c) => c.table === "blank")).toBe(true);
  });

  it("keeps the whole cell, table included, when no label height is known", async () => {
    const out = await reorderPdfLabels(await source(), layout(ALL), [5, 4, 3, 2, 1, 0]);
    const filled = (await renderedCells(out, 2, 2)).flat().filter((c) => c.label !== null);
    expect(filled).toHaveLength(6);
    expect(filled.every((c) => c.table === "dark")).toBe(true);
  });

  it("cuts only the labels that have a height", async () => {
    // Slots 1 and 4 are cut; the rest keep their tables.
    const out = await reorderPdfLabels(await source(), layout(ALL, heights([1, 4], 2)), [0, 1, 2, 3, 4, 5]);
    const sheets = await renderedCells(out, 2, 2);
    expect(sheets[0].map((c) => c.table)).toEqual(["dark", "blank", "dark", "dark"]);
    expect(sheets[1].slice(0, 2).map((c) => c.table)).toEqual(["blank", "dark"]);
  });

  it("works for one label per sheet", async () => {
    const pdf = await makeInfoSheetPdf(1, 1, [[0], [1], [2]]);
    const out = await reorderPdfLabels(pdf, { cols: 1, rows: 1, occupied: [0, 1, 2], labelHeights: heights([0, 1, 2], 1) }, [2, 0, 1]);
    const sheets = await renderedCells(out, 1, 1);
    expect(sheets.map((cells) => cells[0])).toEqual([
      { label: 2, table: "blank" },
      { label: 0, table: "blank" },
      { label: 1, table: "blank" },
    ]);
    expect((await PDFDocument.load(out)).getPage(0).getSize()).toEqual({ width: SHEET_WIDTH, height: SHEET_HEIGHT });
  });
});

describe("composeLabelsPdf with order-info tables", () => {
  const ALL = [0, 1, 2, 3];
  const source = () => makeInfoSheetPdf(2, 2, [[0, 1, 2, 3]]);

  it("lays out only the labels, scaled as labels (not as label + table)", async () => {
    const withCut = await composeLabelsPdf(await source(), { cols: 2, rows: 2, occupied: ALL, labelHeights: heights(ALL, 2) }, [3, 2, 1, 0], 4);
    const without = await composeLabelsPdf(await source(), { cols: 2, rows: 2, occupied: ALL }, [3, 2, 1, 0], 4);

    const [cut] = await renderedInk(withCut, outputSheet(4));
    const [whole] = await renderedInk(without, outputSheet(4));

    // each label comes out in its place, in its own gray
    expect(idsOf([cut])).toEqual([[3, 2, 1, 0]]);

    // and the ink is as wide and tall as the label block (a wide, short block), where
    // without the cut the table makes it a tall one
    const labelAspect = (SHEET_WIDTH / 2 - 8) / ((LABEL_BOTTOM - LABEL_TOP) * cellHeight(2));
    const aspectOf = ({ box }: { box: { x0: number; y0: number; x1: number; y1: number } | null }) => (box!.x1 - box!.x0) / (box!.y1 - box!.y0);
    for (const cell of cut) {
      expect(aspectOf(cell)).toBeGreaterThan(labelAspect * 0.9);
      expect(aspectOf(cell)).toBeLessThan(labelAspect * 1.1);
    }
    for (const cell of whole) expect(aspectOf(cell)).toBeLessThan(labelAspect * 0.6);
  });

  it("does the same for one label per sheet", async () => {
    const pdf = await makeInfoSheetPdf(1, 1, [[0], [1]]);
    const out = await composeLabelsPdf(pdf, { cols: 1, rows: 1, occupied: [0, 1], labelHeights: heights([0, 1], 1) }, [1, 0], 2);
    expect(idsOf(await renderedInk(out, outputSheet(2)))).toEqual([[1, 0]]);
  });
});

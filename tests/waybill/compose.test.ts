import { describe, it, expect, vi, afterEach } from "vitest";
import { PDFDocument, grayscale } from "pdf-lib";
import {
  CELL_PADDING,
  PAGE_MARGIN,
  PER_PAGE_OPTIONS,
  composeLabelsPdf,
  outputSheet,
  parsePerPage,
  type PerPage,
} from "@/lib/waybill/compose";
import type { SheetLayout } from "@/lib/waybill/layout";
import { makeTiledPdf } from "./tiledFixture";
import { makePdf } from "./pdfFixture";
import { idsOf, makeCornerLabelPdf, makeLabelPages, renderedInk } from "./composeFixture";

describe("parsePerPage", () => {
  it.each([2, 4, 6, 9])("accepts %i as a number or as text", (n) => {
    expect(parsePerPage(n)).toBe(n);
    expect(parsePerPage(String(n))).toBe(n);
  });

  it.each([null, undefined, "", "same"])("takes %j to mean: keep the source's layout", (value) => {
    expect(parsePerPage(value)).toBeNull();
  });

  it.each([1, 3, 5, 8, 16, 0, -4, "abc", "4.5", "2x"])("refuses %j rather than guessing", (value) => {
    expect(() => parsePerPage(value)).toThrow(RangeError);
  });
});

describe("outputSheet", () => {
  it.each([
    [2, 2, 1, "landscape"],
    [4, 2, 2, "portrait"],
    [6, 3, 2, "landscape"],
    [9, 3, 3, "portrait"],
  ] as [PerPage, number, number, string][])("%i per page is %i×%i on A4 %s", (perPage, cols, rows, orientation) => {
    const sheet = outputSheet(perPage);
    expect([sheet.cols, sheet.rows]).toEqual([cols, rows]);
    expect(sheet.cols * sheet.rows).toBe(perPage);
    expect(sheet.width > sheet.height).toBe(orientation === "landscape");
    expect(Math.min(sheet.width, sheet.height)).toBeCloseTo(595.28, 1);
    expect(Math.max(sheet.width, sheet.height)).toBeCloseTo(841.89, 1);
  });

  it("offers exactly 2, 4, 6 and 9", () => {
    expect([...PER_PAGE_OPTIONS]).toEqual([2, 4, 6, 9]);
  });
});

// Source: two 2×2 sheets (300×400 pt) holding slots 0..6 (slot 7 is empty); every
// label is a flat gray block whose level is its slot number.
const TILED: SheetLayout = { cols: 2, rows: 2, occupied: [0, 1, 2, 3, 4, 5, 6] };
const tiledSource = () =>
  makeTiledPdf(2, 2, [
    [0, 1, 2, 3],
    [4, 5, 6, null],
  ]);

describe("composeLabelsPdf from a PDF with several labels per sheet", () => {
  it("lays the labels out N per sheet in the requested order", async () => {
    const out = await composeLabelsPdf(await tiledSource(), TILED, [6, 5, 4, 3, 2, 1, 0], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([
      [6, 5, 4, 3],
      [2, 1, 0, null],
    ]);
  });

  it.each([
    [2, [[6, 5], [4, 3], [2, 1], [0, null]]],
    [6, [[6, 5, 4, 3, 2, 1], [0, null, null, null, null, null]]],
    [9, [[6, 5, 4, 3, 2, 1, 0, null, null]]],
  ] as [PerPage, (number | null)[][]][])("works for %i per page", async (perPage, expected) => {
    const out = await composeLabelsPdf(await tiledSource(), TILED, [6, 5, 4, 3, 2, 1, 0], perPage);
    expect(idsOf(await renderedInk(out, outputSheet(perPage)))).toEqual(expected);
  });

  it("makes sheets of the chosen size and orientation", async () => {
    for (const perPage of PER_PAGE_OPTIONS) {
      const doc = await PDFDocument.load(await composeLabelsPdf(await tiledSource(), TILED, [0, 1, 2], perPage));
      const sheet = outputSheet(perPage);
      expect(doc.getPage(0).getSize().width).toBeCloseTo(sheet.width, 1);
      expect(doc.getPage(0).getSize().height).toBeCloseTo(sheet.height, 1);
    }
  });

  it("keeps labels the list doesn't mention after the listed ones, in their original order", async () => {
    const out = await composeLabelsPdf(await tiledSource(), TILED, [3], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([
      [3, 0, 1, 2],
      [4, 5, 6, null],
    ]);
  });

  it("uses each label once even if the list repeats, overshoots or names an empty cell", async () => {
    const out = await composeLabelsPdf(await tiledSource(), TILED, [1, 1, 99, 7, -1, 0], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([
      [1, 0, 2, 3],
      [4, 5, 6, null],
    ]);
  });

  it("closes up the empty cells of the source", async () => {
    const source = await makeTiledPdf(2, 2, [[0, null, 2, null], [null, 5, null, 7]]);
    const out = await composeLabelsPdf(source, { cols: 2, rows: 2, occupied: [0, 2, 5, 7] }, [7, 5, 2, 0], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([[7, 5, 2, 0]]);
  });
});

describe("composeLabelsPdf from a PDF with one label per page", () => {
  it("lays the pages out N per sheet in the requested order", async () => {
    const out = await composeLabelsPdf(await makeLabelPages(5), null, [4, 3, 2, 1, 0], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([
      [4, 3, 2, 1],
      [0, null, null, null],
    ]);
  });

  it("keeps pages the list doesn't mention (a cover sheet, say) after the listed ones", async () => {
    const out = await composeLabelsPdf(await makeLabelPages(4), null, [2, 0], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([[2, 0, 1, 3]]);
  });
});

describe("composeLabelsPdf with blank pages in the source", () => {
  // Pages with no content at all (pdf-lib refuses to embed those).
  async function withBlankPage(blankAt: number, total: number) {
    const doc = await PDFDocument.load(await makeLabelPages(total));
    const blank = await PDFDocument.load(await makePdf(1));
    const [page] = await doc.copyPages(blank, [0]);
    doc.removePage(blankAt);
    doc.insertPage(blankAt, page);
    return Buffer.from(await doc.save());
  }

  it("leaves out a blank page nobody named, instead of failing or wasting a cell", async () => {
    // Pages: 0, [blank], 2, 3 — the labels are on pages 0, 2, 3.
    const source = await withBlankPage(1, 4);
    const out = await composeLabelsPdf(source, null, [3, 2, 0], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([[3, 2, 0, null]]);
  });

  it("leaves a named label on a blank page as an empty cell rather than failing", async () => {
    const source = await withBlankPage(1, 3);
    const out = await composeLabelsPdf(source, null, [0, 1, 2], 4);
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([[0, null, 2, null]]);
  });

  it("copes with a source that is all blank pages", async () => {
    const out = await composeLabelsPdf(await makePdf(2), null, [0, 1], 4);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});

describe("how a label is fitted into its cell", () => {
  const cellSize = (perPage: PerPage) => {
    const sheet = outputSheet(perPage);
    return {
      width: (sheet.width - 2 * PAGE_MARGIN) / sheet.cols - 2 * CELL_PADDING,
      height: (sheet.height - 2 * PAGE_MARGIN) / sheet.rows - 2 * CELL_PADDING,
    };
  };

  it("scales it up until it fills the cell in the tighter direction, keeping its proportions", async () => {
    // A 200×300 page with a 180×280 label: in a 4-up cell (~275×401 usable) the
    // height is the tight side, so the label becomes ~401 tall and ~258 wide.
    const out = await composeLabelsPdf(await makeLabelPages(1), null, [0], 4);
    const [[cell]] = await renderedInk(out, outputSheet(4));
    const { height } = cellSize(4);
    const boxHeight = cell.box!.y1 - cell.box!.y0;
    const boxWidth = cell.box!.x1 - cell.box!.x0;
    // The ink is a little smaller than the cell: a hair of white is kept round the label.
    expect(boxHeight).toBeGreaterThan(height * 0.96);
    expect(boxHeight).toBeLessThanOrEqual(height + 2);
    expect(boxWidth / boxHeight).toBeCloseTo(180 / 280, 1);
  });

  it("centres it in its cell", async () => {
    const out = await composeLabelsPdf(await makeLabelPages(1), null, [0], 4);
    const [[cell]] = await renderedInk(out, outputSheet(4));
    const sheet = outputSheet(4);
    const cellCentreX = PAGE_MARGIN + (sheet.width - 2 * PAGE_MARGIN) / sheet.cols / 2;
    expect((cell.box!.x0 + cell.box!.x1) / 2).toBeCloseTo(cellCentreX, -0.5); // within ~±2 pt
    const cellCentreY = PAGE_MARGIN + (sheet.height - 2 * PAGE_MARGIN) / sheet.rows / 2;
    expect((cell.box!.y0 + cell.box!.y1) / 2).toBeCloseTo(cellCentreY, -0.5);
  });

  it("cuts the label out of a bigger blank page and scales THAT, not the page", async () => {
    // A 100×150 label in the corner of a 400×600 page: scaled as a label it fills the
    // cell; scaled as the page it would come out as a small thumbnail.
    const out = await composeLabelsPdf(await makeCornerLabelPdf(0), null, [0], 4);
    const [[cell]] = await renderedInk(out, outputSheet(4));
    const { height } = cellSize(4);
    expect(cell.box!.y1 - cell.box!.y0).toBeGreaterThan(height * 0.94);
  });

  it("makes a 2-up label bigger than a 9-up one", async () => {
    const heightFor = async (perPage: PerPage) => {
      const out = await composeLabelsPdf(await makeLabelPages(1), null, [0], perPage);
      const [[cell]] = await renderedInk(out, outputSheet(perPage));
      return cell.box!.y1 - cell.box!.y0;
    };
    expect(await heightFor(2)).toBeGreaterThan(await heightFor(9));
  });

  it("draws nothing outside its cell, so no neighbouring label leaks in", async () => {
    // From a tiled source every label is cut out of a sheet that holds its neighbours.
    const out = await composeLabelsPdf(await tiledSource(), TILED, [0, 1, 2, 3, 4, 5, 6], 9);
    const [cells] = await renderedInk(out, outputSheet(9));
    for (const cell of cells.slice(0, 7)) {
      // Each cell holds exactly one block: its own gray, and the block is a single rectangle.
      expect(cell.box).not.toBeNull();
    }
    expect(cells.slice(0, 7).map((cell) => cell.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("composeLabelsPdf robustness", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not touch the source buffer", async () => {
    const source = await tiledSource();
    const before = Buffer.from(source);
    await composeLabelsPdf(source, TILED, [6, 5, 4, 3, 2, 1, 0], 4);
    expect(source.equals(before)).toBe(true);
  });

  it("does not bloat the file when many labels come from the same sheet", async () => {
    const heavy = await makeLabelPages(2, 400, 600, 10, 4000);
    expect(heavy.length).toBeGreaterThan(30_000);
    const out = await composeLabelsPdf(heavy, null, [1, 0], 4);
    expect(out.length).toBeLessThan(heavy.length * 3.5);
  });

  it("does not draw a huge document to pictures, and still lays it out", async () => {
    // 301 one-label pages (the fixture's gray levels only go to 11, so they repeat).
    const doc = await PDFDocument.create();
    for (let i = 0; i < 301; i++) {
      doc.addPage([100, 150]).drawRectangle({ x: 5, y: 5, width: 90, height: 140, color: grayscale(((i % 11) + 1) / 12) });
    }
    const huge = Buffer.from(await doc.save());

    const rasterizePages = vi.fn(async () => []);
    vi.doMock("@/lib/waybill/raster", () => ({ rasterizePages }));
    vi.resetModules();
    const { composeLabelsPdf: compose } = await import("@/lib/waybill/compose");
    const out = await compose(huge, null, [300, 299, 298], 9);
    vi.doUnmock("@/lib/waybill/raster");
    vi.resetModules();

    expect(rasterizePages).not.toHaveBeenCalled();
    expect((await PDFDocument.load(out)).getPageCount()).toBe(Math.ceil(301 / 9));
    // The three named pages come first (levels 300 % 11, 299 % 11, 298 % 11).
    expect(idsOf(await renderedInk(out, outputSheet(9)))[0].slice(0, 3)).toEqual([3, 2, 1]);
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(composeLabelsPdf(Buffer.from("definitely not a pdf"), null, [0], 4)).rejects.toThrow();
  });

  it("still lays the labels out when the picture used to find their edges can't be made", async () => {
    // pdftoppm missing/failing only makes the cut looser (whole tile), never wrong or fatal.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/waybill/raster", () => ({ rasterizePages: async () => Promise.reject(new Error("no pdftoppm")) }));
    vi.resetModules();
    const { composeLabelsPdf: composeWithoutRaster } = await import("@/lib/waybill/compose");
    const out = await composeWithoutRaster(await makeLabelPages(3), null, [2, 1, 0], 4);
    vi.doUnmock("@/lib/waybill/raster");
    vi.resetModules();
    expect(idsOf(await renderedInk(out, outputSheet(4)))).toEqual([[2, 1, 0, null]]);
  });
});

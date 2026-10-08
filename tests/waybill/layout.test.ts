import { describe, it, expect } from "vitest";
import { cellText, extractTiledLabels, looksTiled, parseBboxXml, type BboxPage, type BboxWord } from "@/lib/waybill/layout";

// Word boxes shaped like `pdftotext -bbox` output for a Shopee waybill printed
// several to a sheet: Letter 612×792, 3×3 labels, 204×264 pt per cell, label text
// ~5 pt tall. Positions follow a real sheet; the texts are made up.
const H = 5.27;
const CHAR = 2.6;

// `scale` 1 is the label as it sits in a Letter 3×3 cell (204×264 pt); a print
// scales the label to its cell, so bigger cells hold proportionally bigger text.
function line(text: string, x: number, y: number, scale = 1): BboxWord[] {
  let cursor = x;
  return text.split(" ").map((word) => {
    const box = { text: word, x0: cursor, y0: y, x1: cursor + word.length * CHAR * scale, y1: y + H * scale };
    cursor = box.x1 + 1.3 * scale;
    return box;
  });
}

interface LabelSpec {
  orderLine?: string; // default "Mã đơn hàng: <id>"
  id: string;
  tracking: string;
  total: number;
  itemLines: string[];
  rightOfLastItem?: string; // the label's right-hand column, on the same line as the last item line
}

function label(cellX: number, cellY: number, spec: LabelSpec, s = 1): BboxWord[] {
  const x = cellX + 13 * s;
  const y = cellY + 3 * s;
  const itemTop = y + 100 * s;
  const words = [
    ...line(`Mã vận đơn: ${spec.tracking}`, x + 85 * s, y + 20 * s, s),
    ...line(spec.orderLine ?? `Mã đơn hàng: ${spec.id}`, x + 85 * s, y + 26 * s, s),
    ...line("Từ: Đến:", x + 4 * s, y + 36 * s, s),
    ...line(`Nội dung hàng (Tổng SL sản phẩm: ${spec.total})`, x + 4 * s, itemTop - 8 * s, s),
  ];
  spec.itemLines.forEach((text, i) => words.push(...line(text, x + 4 * s, itemTop + i * 6.1 * s, s)));
  if (spec.rightOfLastItem) words.push(...line(spec.rightOfLastItem, x + 120 * s, itemTop + (spec.itemLines.length - 1) * 6.1 * s, s));
  // A real label's text spans nearly its whole width (this footer reaches the right edge).
  words.push(...line("Chữ ký người nhận Xác nhận hàng", x + 90 * s, y + 215 * s, s));
  words.push(...line("Gọi 1900 6885", x + 4 * s, y + 240 * s, s));
  return words;
}

const sheet = (labels: (LabelSpec | null)[], cols = 3, rows = 3, width = 612, height = 792): BboxPage => {
  const scale = Math.min(width / cols / 204, height / rows / 264);
  return {
    width,
    height,
    words: labels.flatMap((spec, cell) =>
      spec ? label((cell % cols) * (width / cols), Math.floor(cell / cols) * (height / rows), spec, scale) : []
    ),
  };
};

const simple = (n: number, extra: Partial<LabelSpec> = {}): LabelSpec => ({
  id: `ORD${n}`,
  tracking: `TRK${n}`,
  total: 1,
  itemLines: [`1. Hộp vít số ${n}, Loại A, SL: 1`],
  ...extra,
});

describe("parseBboxXml", () => {
  it("reads pages and words with their boxes", () => {
    const xml = `<?xml version="1.0"?><html><body><doc>
      <page width="612.000000" height="792.000000">
        <word xMin="10.5" yMin="20.25" xMax="30" yMax="26">Mã</word>
        <word xMin="31" yMin="20.25" xMax="40" yMax="26">đơn</word>
      </page>
      <page width="300" height="400"></page>
    </doc></body></html>`;
    const pages = parseBboxXml(xml);

    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({
      width: 612,
      height: 792,
      words: [
        { text: "Mã", x0: 10.5, y0: 20.25, x1: 30, y1: 26 },
        { text: "đơn", x0: 31, y0: 20.25, x1: 40, y1: 26 },
      ],
    });
    expect(pages[1].words).toEqual([]);
  });

  it("decodes XML entities and normalises accents", () => {
    const decomposed = "Mã"; // "Mã" typed as a + combining tilde
    const [page] = parseBboxXml(`<page width="1" height="1"><word xMin="0" yMin="0" xMax="1" yMax="1">A&amp;B &lt;${decomposed}&gt;</word></page>`);
    expect(page.words[0].text).toBe("A&B <Mã>");
  });

  it("ignores words that come before any page", () => {
    expect(parseBboxXml(`<word xMin="0" yMin="0" xMax="1" yMax="1">x</word>`)).toEqual([]);
  });
});

describe("looksTiled", () => {
  it("is true when one page names more than one tracking code", () => {
    expect(looksTiled("Mã vận đơn: A1   Mã vận đơn: B2\nMã đơn hàng: X")).toBe(true);
  });

  it("is false for one label per page, however many pages", () => {
    expect(looksTiled("Mã vận đơn: A1\fMã vận đơn: B2\fMã vận đơn: C3\f")).toBe(false);
  });

  it("is false for text with no labels", () => {
    expect(looksTiled("")).toBe(false);
  });
});

describe("cellText", () => {
  it("lays words out as lines, top to bottom, left to right", () => {
    const text = cellText([...line("bottom line", 10, 22.2), ...line("Mã vận đơn: X", 10, 10), ...line("middle", 10, 16.1)]);
    expect(text).toBe("Mã vận đơn: X\nmiddle\nbottom line");
  });

  it("puts a wide gap (a separate column) 3+ spaces away, so the item parser can cut there", () => {
    const text = cellText([...line("ợp, SL: 1", 10, 10), ...line("HN-20-25-", 100, 10)]);
    expect(text).toMatch(/^ợp, SL: 1 {3,}HN-20-25-$/);
  });

  it("leaves a blank line where there is a gap of more than a line", () => {
    const text = cellText([...line("one", 10, 10), ...line("two", 10, 16), ...line("far", 10, 60)]);
    expect(text).toBe("one\ntwo\n\nfar");
  });
});

describe("extractTiledLabels", () => {
  it("finds a 3×3 grid and reads every label, numbering them by slot", () => {
    const full = sheet(Array.from({ length: 9 }, (_, i) => simple(i)));
    const partial = sheet([simple(9), simple(10), simple(11)]);
    const result = extractTiledLabels([full, partial])!;

    expect(result.layout).toMatchObject({ cols: 3, rows: 3 });
    expect(result.layout.occupied).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.labels.map((l) => [l.pageIndex, l.shopeeOrderId, l.trackingCode])).toEqual(
      Array.from({ length: 12 }, (_, i) => [i, `ORD${i}`, `TRK${i}`])
    );
    expect(result.labels[4].items).toEqual([{ name: "Hộp vít số 4", variant: "Loại A", quantity: 1 }]);
  });

  it("also returns the text of every non-empty cell, in slot order", () => {
    const { cells } = extractTiledLabels([sheet([simple(0), null, simple(2), simple(3)])])!;
    expect(cells.map((c) => c.slot)).toEqual([0, 2, 3]);
    expect(cells[1].text).toContain("Mã đơn hàng: ORD2");
    expect(cells[1].text).toContain("Mã vận đơn: TRK2");
    expect(cells[1].text).not.toContain("ORD0"); // nothing from a neighbouring label
  });

  it("reads an item that wraps over lines, with the label's right-hand column beside it", () => {
    const wrapped = simple(1, {
      itemLines: ["1. [COMBO] 5 Bánh Xe Chân Ghế Xoay, combo 2 bánh, S", "L: 2"],
      rightOfLastItem: "HN-20-25-",
      total: 2,
    });
    const { labels } = extractTiledLabels([sheet([simple(0), wrapped, simple(2)])])!;
    expect(labels[1].items).toEqual([{ name: "5 Bánh Xe Chân Ghế Xoay", variant: "combo 2 bánh", quantity: 2 }]);
    expect(labels[1].declaredTotalQuantity).toBe(2);
  });

  it("reads a pre-order label (\"Mã đơn đặt trước\") like any other", () => {
    const pre = simple(5, { orderLine: "Mã đơn đặt trước: 261006AASITBPLDMMYM" });
    const { labels } = extractTiledLabels([sheet([simple(0), simple(1), pre])])!;
    expect(labels.map((l) => l.shopeeOrderId)).toEqual(["ORD0", "ORD1", "261006AASITBPLDMMYM"]);
  });

  it("keeps the cell positions when a cell in the middle is empty", () => {
    const { labels, layout } = extractTiledLabels([sheet([simple(0), simple(1), simple(2), null, simple(4)])])!;
    expect(labels.map((l) => l.pageIndex)).toEqual([0, 1, 2, 4]);
    expect(layout.occupied).toEqual([0, 1, 2, 4]);
  });

  it("counts a cell with text but no order as occupied, so re-ordering keeps it", () => {
    const page = sheet([simple(0), simple(1), simple(2)]);
    page.words.push(...line("Some cover note", 13, 264 + 60)); // cell 3: row 1, column 0
    const { labels, layout } = extractTiledLabels([page])!;
    expect(labels.map((l) => l.pageIndex)).toEqual([0, 1, 2]);
    expect(layout.occupied).toEqual([0, 1, 2, 3]);
  });

  it("does not take a sparse 3×3 sheet for a smaller or oddly shaped grid", () => {
    // Three labels in the first row could pass for 1×3 or 2×2 cells; they are 3×3.
    const result = extractTiledLabels([sheet([simple(0), simple(1), simple(2)])])!;
    expect(result.layout).toMatchObject({ cols: 3, rows: 3 });
  });

  it("finds a 2×2 grid on a different sheet size", () => {
    const pages = [sheet([simple(0), simple(1), simple(2), simple(3)], 2, 2, 400, 500), sheet([simple(4)], 2, 2, 400, 500)];
    const result = extractTiledLabels(pages)!;
    expect(result.layout).toMatchObject({ cols: 2, rows: 2 });
    expect(result.labels.map((l) => l.pageIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("gives up (null) when there is only one label per page", () => {
    expect(extractTiledLabels([sheet([simple(0)], 1, 1), sheet([simple(1)], 1, 1)])).toBeNull();
  });

  it("gives up when two labels sit too close to be in different cells of any grid", () => {
    const page = sheet([simple(0)]);
    page.words.push(...line("Mã đơn hàng: OTHER", 100, 60)); // a second order id 30 pt below the first
    expect(extractTiledLabels([page])).toBeNull();
  });

  it("gives up when the sheets are not all the same size", () => {
    const a = sheet([simple(0), simple(1), simple(2)]);
    const b = sheet([simple(3), simple(4), simple(5)], 3, 3, 400, 700);
    expect(extractTiledLabels([a, b])).toBeNull();
  });
});

// 4 labels per A4 sheet (2×2): the shape of a browser print of Seller Centre
// labels. A sheet with fewer orders leaves its other cells empty, so a short
// file often holds one sheet with only one, two or three labels on it.
describe("4 labels per A4 sheet (2×2)", () => {
  const A4 = { cols: 2, rows: 2, width: 595.28, height: 841.89 };
  const a4 = (labels: (LabelSpec | null)[]) => sheet(labels, A4.cols, A4.rows, A4.width, A4.height);
  const four = (from: number) => [0, 1, 2, 3].map((i) => simple(from + i));

  it("reads a full sheet and a part-filled one, numbering labels sheet by sheet", () => {
    const { labels, layout } = extractTiledLabels([a4(four(0)), a4([simple(4), simple(5)])])!;
    expect(layout).toMatchObject({ cols: 2, rows: 2 });
    expect(labels.map((l) => [l.pageIndex, l.shopeeOrderId])).toEqual(
      [0, 1, 2, 3, 4, 5].map((i) => [i, `ORD${i}`])
    );
    expect(layout.occupied).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it.each([2, 3])("still finds the 2×2 grid when the only sheet holds %i labels", (count) => {
    const { labels, layout } = extractTiledLabels([a4(four(0).slice(0, count))])!;
    expect(layout).toMatchObject({ cols: 2, rows: 2 });
    expect(labels.map((l) => l.pageIndex)).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it("leaves a sheet with a single label to the one-label-per-page reader", () => {
    // Nothing to tell apart: looksTiled() is false for it and extractTiledLabels() has no grid to find.
    expect(extractTiledLabels([a4([simple(0)])])).toBeNull();
    expect(looksTiled("Mã vận đơn: TRK0\nMã đơn hàng: ORD0\n\fMã vận đơn: TRK1\n")).toBe(false);
  });

  it("reads labels in the first column of a sheet whose second column is empty", () => {
    const { labels, layout } = extractTiledLabels([a4([simple(0), null, simple(2), null])])!;
    expect(layout).toMatchObject({ cols: 2, rows: 2 });
    expect(labels.map((l) => l.pageIndex)).toEqual([0, 2]);
  });
});

// 2 and 6 labels per sheet, on landscape and portrait paper. The grid is the one
// the labels fill best among those that cut no text and keep every order id in
// its own cell — so a sheet is never read with labels split across cells.
describe("2 and 6 labels per sheet", () => {
  const A4_LONG = 841.89;
  const A4_SHORT = 595.28;
  const labels = (n: number, from = 0) => Array.from({ length: n }, (_, i) => simple(from + i));
  const slots = (result: ReturnType<typeof extractTiledLabels>) => result!.labels.map((l) => l.pageIndex);

  it("2 side by side on landscape paper is 2×1", () => {
    const pages = [sheet(labels(2), 2, 1, A4_LONG, A4_SHORT), sheet(labels(2, 2), 2, 1, A4_LONG, A4_SHORT), sheet(labels(1, 4), 2, 1, A4_LONG, A4_SHORT)];
    const result = extractTiledLabels(pages)!;
    expect(result.layout).toMatchObject({ cols: 2, rows: 1 });
    expect(slots(result)).toEqual([0, 1, 2, 3, 4]);
  });

  it("2 on portrait paper is read whole whichever way they are laid out", () => {
    // Stacked (1×2) and side by side in tall cells (2×1) both leave room for a finer
    // grid that fits the labels just as well, and that is what is chosen — every
    // label is still read whole and in order, the re-ordered sheets just hold 4.
    for (const [cols, rows] of [[1, 2], [2, 1]]) {
      const pages = [sheet(labels(2), cols, rows, A4_SHORT, A4_LONG), sheet(labels(2, 2), cols, rows, A4_SHORT, A4_LONG)];
      const result = extractTiledLabels(pages)!;
      expect(result.labels.map((l) => l.shopeeOrderId)).toEqual(["ORD0", "ORD1", "ORD2", "ORD3"]);
      expect(result.labels.every((l) => l.items.length === 1)).toBe(true);
    }
  });

  it("6 on landscape paper is 3×2", () => {
    const result = extractTiledLabels([sheet(labels(6), 3, 2, A4_LONG, A4_SHORT), sheet(labels(3, 6), 3, 2, A4_LONG, A4_SHORT)])!;
    expect(result.layout).toMatchObject({ cols: 3, rows: 2 });
    expect(slots(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("6 on portrait paper is 2×3", () => {
    const result = extractTiledLabels([sheet(labels(6), 2, 3, A4_SHORT, A4_LONG), sheet(labels(3, 6), 2, 3, A4_SHORT, A4_LONG)])!;
    expect(result.layout).toMatchObject({ cols: 2, rows: 3 });
    expect(slots(result)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.labels.every((l) => l.items.length === 1)).toBe(true);
  });

  it("a sparse 3×3 sheet is not taken for a 3×2 one", () => {
    // Three labels in the top row fit 3×2 cells too; they fill 3×3 cells better.
    expect(extractTiledLabels([sheet(labels(3))])!.layout).toMatchObject({ cols: 3, rows: 3 });
  });
});

// Labels with an order-info table under each ("THÔNG TIN ĐƠN HÀNG" and a table of the
// order's lines with the seller's SKUs), as a seller's print has them: Letter landscape,
// two labels side by side, 396 pt cells, each label ~190 pt wide at the cell's left and
// its table running flush from the cell's very edge.
describe("labels followed by an order-info table", () => {
  const word = (text: string, x0: number, y0: number, x1: number): BboxWord => ({ text, x0, y0, x1, y1: y0 + 5.6 });

  // rows: [SKU lines, (variation SKU lines)] — one entry per product line. Every
  // character is 2.45 pt wide and a line holds 5 of them, like the print's narrow column.
  function infoTable(x: number, top: number, rows: { sku?: string[]; variantSku?: string[] }[]): BboxWord[] {
    const words = [
      ...line("THÔNG TIN ĐƠN HÀNG", x + 2, top, 1.3),
      ...line("OrderSN: X package 1", x + 2, top + 13),
      word("#", x + 0.8, top + 25, x + 3.6),
      word("SKU", x + 14.3, top + 25, x + 24.8),
      word("Tên", x + 29.2, top + 25, x + 38),
      word("sản", x + 39.4, top + 25, x + 48.6),
      word("phẩm", x + 50, top + 25, x + 63.9),
      word("SKU", x + 81.5, top + 25, x + 92),
      word("Phân", x + 101.9, top + 25, x + 114.1),
      word("SL", x + 141.2, top + 25, x + 147.6),
    ];
    let y = top + 41;
    rows.forEach((spec, n) => {
      words.push(word(String(n + 1), x + 0.8, y, x + 3.6), word("Hộp", x + 29.2, y, x + 40), word("1", x + 141.2, y, x + 144));
      const lines = (list: string[] = [], column: number) =>
        list.forEach((text, i) => words.push(word(text, x + column, y + 5 * i, x + column + text.length * 2.45)));
      lines(spec.sku, 14.3);
      lines(spec.variantSku, 81.5);
      y += 5 * Math.max(1, spec.sku?.length ?? 0, spec.variantSku?.length ?? 0) + 6;
    });
    return words;
  }

  // The label at ~0.93 scale (≈190 pt wide); its table starts 310 pt down, past the middle
  // of the page, as on the real print — so the sheet can't be read as two rows of cells.
  const TABLE_TOP = 310;
  const cell = (cellX: number, n: number, rows: { sku?: string[]; variantSku?: string[] }[], extra: Partial<LabelSpec> = {}) => [
    ...label(cellX - 8, 0, simple(n, extra), 0.93),
    ...infoTable(cellX, TABLE_TOP, rows),
  ];

  const landscape = (cells: BboxWord[][]): BboxPage => ({ width: 792, height: 612, words: cells.flat() });

  const pages = [
    landscape([cell(0, 0, [{ sku: ["TyHoi", "_D160", "_Den"] }]), cell(396, 1, [{ sku: ["Bo_05", "BanhX", "e"] }])]),
    landscape([cell(0, 2, [{ sku: ["ConTh", "u"] }])]),
  ];

  it("reads two labels per sheet even though each table starts exactly at its cell's edge", () => {
    const result = extractTiledLabels(pages)!;
    expect(result.layout).toMatchObject({ cols: 2, rows: 1, occupied: [0, 1, 2] });
    expect(result.labels.map((l) => l.pageIndex)).toEqual([0, 1, 2]);
  });

  it("attaches each product line's SKU", () => {
    const { labels } = extractTiledLabels(pages)!;
    expect(labels.map((l) => l.items.map((item) => item.sku))).toEqual([["TyHoi_D160_Den"], ["Bo_05BanhXe"], ["ConThu"]]);
    // the rest of the line is read as before
    expect(labels[0].items[0]).toMatchObject({ name: "Hộp vít số 0", variant: "Loại A", quantity: 1 });
  });

  it("matches the table's rows to the label's product lines by number (the SKU column, not SKU phân loại)", () => {
    const two = landscape([
      cell(0, 0, [{ sku: ["AAAAA", "B"] }, { sku: ["CC"], variantSku: ["VV"] }], {
        total: 2,
        itemLines: ["1. Hộp vít số 0, Loại A, SL: 1", "2. Đinh, Loại B, SL: 1"],
      }),
      cell(396, 1, [{ sku: ["Z"] }]),
    ]);
    const { labels } = extractTiledLabels([two])!;
    expect(labels[0].items.map((item) => item.sku)).toEqual(["AAAAAB", "CC"]);
    expect(labels[1].items.map((item) => item.sku)).toEqual(["Z"]);
  });

  it("records where each label ends, just above its table", () => {
    const { layout } = extractTiledLabels(pages)!;
    expect(Object.keys(layout.labelHeights!)).toEqual(["0", "1", "2"]);
    // the cut sits a hair above the heading, inside the cell
    for (const height of Object.values(layout.labelHeights!)) expect(height).toBeCloseTo(TABLE_TOP - 2, 1);
  });

  it("does not take the table for labels or cells of its own", () => {
    const { labels, layout, cells } = extractTiledLabels(pages)!;
    expect(labels).toHaveLength(3);
    expect(cells.map((c) => c.slot)).toEqual([0, 1, 2]);
    // not read as 2×2 (the table half of a cell as a cell of its own), nor as 4 columns
    // of which every second is empty
    expect([layout.cols, layout.rows]).toEqual([2, 1]);
  });

  it("measures each label's height from the top of its own cell", () => {
    // 2 labels stacked on a portrait sheet, 306 pt cells: the second label's table is
    // 306 pt lower than the first's.
    const stacked: BboxPage = {
      width: 612,
      height: 792,
      words: [
        ...label(-8, 0, simple(0), 0.93),
        ...infoTable(0, 244, [{ sku: ["A"] }]),
        ...label(-8, 396, simple(1), 0.93),
        ...infoTable(0, 396 + 244, [{ sku: ["B"] }]),
      ],
    };
    const { layout } = extractTiledLabels([stacked])!;
    expect(layout).toMatchObject({ cols: 1, rows: 2 });
    expect(layout.labelHeights![0]).toBeCloseTo(layout.labelHeights![1], 0);
  });

  it("reads one label per sheet when it has a table", () => {
    const single = (n: number) => ({ width: 300, height: 450, words: [...label(-8, 0, simple(n), 0.93), ...infoTable(0, 244, [{ sku: [`S${n}`] }])] });
    const result = extractTiledLabels([single(0), single(1)])!;
    expect(result.layout).toMatchObject({ cols: 1, rows: 1, occupied: [0, 1] });
    expect(result.labels.map((l) => [l.pageIndex, l.items[0].sku])).toEqual([
      [0, "S0"],
      [1, "S1"],
    ]);
    expect(result.layout.labelHeights![0]).toBeGreaterThan(236);
  });

  it("still returns null for one label per sheet without a table (nothing to read by position)", () => {
    expect(extractTiledLabels([{ width: 300, height: 450, words: label(0, 0, simple(0), 0.93) }])).toBeNull();
  });

  it("gives no label heights, and no SKUs, to sheets without tables", () => {
    const { layout, labels } = extractTiledLabels([sheet([simple(0), simple(1), simple(2), simple(3)], 2, 2, 612, 792)])!;
    expect(layout.labelHeights).toBeUndefined();
    expect(labels.every((l) => l.items.every((item) => item.sku === undefined))).toBe(true);
  });

  it("keeps the label height of a table whose SKU columns are empty, and gives that line no SKU", () => {
    const { layout, labels } = extractTiledLabels([landscape([cell(0, 0, [{}]), cell(396, 1, [{}])])])!;
    expect(layout.labelHeights).toBeDefined();
    expect(labels.map((l) => l.items[0].sku)).toEqual([undefined, undefined]);
  });
});

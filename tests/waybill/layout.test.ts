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

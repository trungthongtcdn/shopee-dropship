import { describe, it, expect, vi, afterEach } from "vitest";
import { extractOrderIdsFromWaybillText, extractOrdersFromWaybillText, parseWaybillText } from "@/lib/zalo/parseWaybill";
import { tiledXml, TILED_LAYOUT_TEXT } from "../waybill/bboxFixture";

// A label with an order-info table under it ("THÔNG TIN ĐƠN HÀNG" and a table whose SKU
// column is the 2nd one), as <word> XML; `x` is the left edge of its cell.
function labelWithTable(x: number, id: string, sku: string, tableTop: number): string {
  const word = (text: string, x0: number, y0: number, x1 = x0 + text.length * 2.6) =>
    `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y0 + 5.3}">${text}</word>`;
  const words = (text: string, x0: number, y0: number) => {
    let cursor = x0;
    return text
      .split(" ")
      .map((part) => {
        const out = word(part, cursor, y0);
        cursor += part.length * 2.6 + 1.3;
        return out;
      })
      .join("");
  };
  return [
    words(`Mã vận đơn: TRK${id}`, x + 40, 8),
    words(`Mã đơn hàng: ${id}`, x + 40, 15),
    words("Nội dung hàng (Tổng SL sản phẩm: 1)", x + 5, 40),
    words(`1. Hộp vít ${id}, Loại A, SL: 1`, x + 5, 46),
    words("THÔNG TIN ĐƠN HÀNG", x + 1, tableTop),
    word("#", x + 0.8, tableTop + 25, x + 3.6),
    word("SKU", x + 14.3, tableTop + 25, x + 24.8),
    word("Tên", x + 29.2, tableTop + 25, x + 38),
    word("1", x + 0.8, tableTop + 41, x + 3.6),
    word(sku, x + 14.3, tableTop + 41, x + 14.3 + 2 * sku.length),
    word("Hộp", x + 29.2, tableTop + 41, x + 40),
  ].join("");
}
const infoXml = (pages: { width: number; height: number; labels: string }[]) =>
  `<doc>${pages.map((p) => `<page width="${p.width}" height="${p.height}">${p.labels}</page>`).join("")}</doc>`;

const SAMPLE_TEXT = `
                                                    Mã vận đơn: SPXVN068985623989
                                                   Mã đơn hàng: 260922P8S4YMTB

Từ:                                                      Đến:
Furni Home                                               Cuong Manh
\f
                                                    Mã vận đơn: SPXVN064903569589
                                                   Mã đơn hàng: 260922P94CFJ24
`;

describe("extractOrderIdsFromWaybillText", () => {
  it("extracts one order id per page from pdftotext -layout output", () => {
    // Shape verified against a real Shopee SPX waybill PDF sample.
    expect(extractOrderIdsFromWaybillText(SAMPLE_TEXT)).toEqual(["260922P8S4YMTB", "260922P94CFJ24"]);
  });

  it("returns an empty array when no order id line is present", () => {
    expect(extractOrderIdsFromWaybillText("some unrelated pdf content")).toEqual([]);
  });
});

describe("extractOrdersFromWaybillText", () => {
  it("pairs each order id with its page's tracking code", () => {
    expect(extractOrdersFromWaybillText(SAMPLE_TEXT)).toEqual([
      { shopeeOrderId: "260922P8S4YMTB", trackingCode: "SPXVN068985623989" },
      { shopeeOrderId: "260922P94CFJ24", trackingCode: "SPXVN064903569589" },
    ]);
  });

  it("pairs a null trackingCode when a page is missing its tracking-code line", () => {
    const text = "Mã đơn hàng: 260922P8S4YMTB";
    expect(extractOrdersFromWaybillText(text)).toEqual([{ shopeeOrderId: "260922P8S4YMTB", trackingCode: null }]);
  });

  it("returns an empty array when no order id line is present", () => {
    expect(extractOrdersFromWaybillText("some unrelated pdf content")).toEqual([]);
  });
});

describe("parseWaybillText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads a one-label-per-page document from the text alone", async () => {
    const readBboxXml = vi.fn();
    const parsed = await parseWaybillText(SAMPLE_TEXT, readBboxXml);

    expect(readBboxXml).not.toHaveBeenCalled();
    expect(parsed.layout).toBeUndefined();
    expect(parsed.orders).toEqual(extractOrdersFromWaybillText(SAMPLE_TEXT));
    expect(parsed.pages.map((p) => p.shopeeOrderId)).toEqual(["260922P8S4YMTB", "260922P94CFJ24"]);
  });

  it("reads each label of a tiled document from its own cell", async () => {
    const xml = tiledXml([
      [
        { id: "ORD1", tracking: "TRK1", product: "Hộp vít A" },
        { id: "ORD2", tracking: "TRK2", product: "Hộp vít B" },
        { id: "PRE9", tracking: "TRK3", product: "Hộp vít C", idLabel: "Mã đơn đặt trước" },
      ],
    ]);
    const parsed = await parseWaybillText(TILED_LAYOUT_TEXT, async () => xml);

    expect(parsed.layout).toMatchObject({ cols: 3, rows: 3, occupied: [0, 1, 2] });
    // Every label is listed for the warehouse (slot = its position on the sheet)…
    expect(parsed.pages.map((p) => [p.pageIndex, p.shopeeOrderId, p.trackingCode])).toEqual([
      [0, "ORD1", "TRK1"],
      [1, "ORD2", "TRK2"],
      [2, "PRE9", "TRK3"],
    ]);
    // …but only "Mã đơn hàng" ids are acted on when confirming orders, as before.
    expect(parsed.orders).toEqual([
      { shopeeOrderId: "ORD1", trackingCode: "TRK1" },
      { shopeeOrderId: "ORD2", trackingCode: "TRK2" },
    ]);
  });

  it("still confirms the orders when the grid can't be worked out, just without the grouped files", async () => {
    // One label plus a second order id 30 pt below it: no grid separates the two.
    const xml = tiledXml([[{ id: "ORD1", tracking: "TRK1", product: "X" }]]).replace(
      "</page>",
      '<word xMin="100" yMin="60" xMax="150" yMax="65">Mã</word><word xMin="152" yMin="60" xMax="165" yMax="65">đơn</word><word xMin="167" yMin="60" xMax="190" yMax="65">hàng:</word></page>'
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const parsed = await parseWaybillText(TILED_LAYOUT_TEXT, async () => xml);

    expect(parsed.pages).toEqual([]);
    expect(parsed.layout).toBeUndefined();
    expect(parsed.orders).toEqual(extractOrdersFromWaybillText(TILED_LAYOUT_TEXT));
    expect(warn).toHaveBeenCalled();
  });

  it("still confirms the orders when reading the word positions fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const parsed = await parseWaybillText(TILED_LAYOUT_TEXT, async () => {
      throw new Error("pdftotext blew up");
    });

    expect(parsed.pages).toEqual([]);
    expect(parsed.orders.map((o) => o.shopeeOrderId)).toEqual(["X1", "Y2"]);
    expect(error).toHaveBeenCalled();
  });

  describe("labels with an order-info table", () => {
    const TEXT = "Mã vận đơn: TRKO1   Mã vận đơn: TRKO2\nMã đơn hàng: O1   Mã đơn hàng: O2\n\nTHÔNG TIN ĐƠN HÀNG   THÔNG TIN ĐƠN HÀNG\n";

    it("reads the SKUs and where each label ends, for a tiled sheet", async () => {
      const xml = infoXml([{ width: 300, height: 400, labels: labelWithTable(0, "O1", "SKU1", 215) + labelWithTable(150, "O2", "SKU2", 215) }]);
      const parsed = await parseWaybillText(TEXT, async () => xml);

      expect(parsed.layout).toMatchObject({ cols: 2, rows: 1, occupied: [0, 1] });
      expect(parsed.layout!.labelHeights).toEqual({ 0: 213, 1: 213 });
      expect(parsed.pages.map((p) => [p.shopeeOrderId, p.items[0].sku])).toEqual([
        ["O1", "SKU1"],
        ["O2", "SKU2"],
      ]);
      // the table's "OrderSN:" line is not taken for a second order id
      expect(parsed.orders).toEqual([
        { shopeeOrderId: "O1", trackingCode: "TRKO1" },
        { shopeeOrderId: "O2", trackingCode: "TRKO2" },
      ]);
    });

    it("reads the same when each sheet holds one label", async () => {
      const text = "Mã vận đơn: TRKO1\nMã đơn hàng: O1\nTHÔNG TIN ĐƠN HÀNG\f" + "Mã vận đơn: TRKO2\nMã đơn hàng: O2\nTHÔNG TIN ĐƠN HÀNG\f";
      const xml = infoXml([
        { width: 300, height: 400, labels: labelWithTable(0, "O1", "SKU1", 215) },
        { width: 300, height: 400, labels: labelWithTable(0, "O2", "SKU2", 215) },
      ]);
      const parsed = await parseWaybillText(text, async () => xml);

      expect(parsed.layout).toMatchObject({ cols: 1, rows: 1, occupied: [0, 1] });
      expect(parsed.pages.map((p) => [p.pageIndex, p.items[0].sku])).toEqual([
        [0, "SKU1"],
        [1, "SKU2"],
      ]);
      expect(parsed.orders.map((o) => o.shopeeOrderId)).toEqual(["O1", "O2"]);
    });

    it("falls back to the plain text when the sheets differ in size", async () => {
      const text =
        "Mã vận đơn: TRKO1\nMã đơn hàng: O1\n\nNội dung hàng (Tổng SL sản phẩm: 1)\n1. Hộp vít, Loại A, SL: 1\n\nTHÔNG TIN ĐƠN HÀNG\f" +
        "Mã vận đơn: TRKO2\nMã đơn hàng: O2\n\nNội dung hàng (Tổng SL sản phẩm: 1)\n1. Hộp vít, Loại A, SL: 1\n\nTHÔNG TIN ĐƠN HÀNG\f";
      const xml = infoXml([
        { width: 300, height: 400, labels: labelWithTable(0, "O1", "SKU1", 215) },
        { width: 200, height: 400, labels: labelWithTable(0, "O2", "SKU2", 215) },
      ]);
      const parsed = await parseWaybillText(text, async () => xml);

      expect(parsed.layout).toBeUndefined();
      expect(parsed.pages.map((p) => [p.shopeeOrderId, p.items[0].sku])).toEqual([
        ["O1", undefined],
        ["O2", undefined],
      ]);
      expect(parsed.orders.map((o) => o.shopeeOrderId)).toEqual(["O1", "O2"]);
    });

    it("keeps confirming orders when the word positions can't be read", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const text = "Mã vận đơn: TRKO1\nMã đơn hàng: O1\n\nNội dung hàng (Tổng SL sản phẩm: 1)\n1. Hộp vít, Loại A, SL: 1\n\nTHÔNG TIN ĐƠN HÀNG\f";
      const parsed = await parseWaybillText(text, async () => {
        throw new Error("pdftotext blew up");
      });

      expect(parsed.orders.map((o) => o.shopeeOrderId)).toEqual(["O1"]);
      expect(parsed.pages.map((p) => p.shopeeOrderId)).toEqual(["O1"]);
      expect(error).toHaveBeenCalled();
    });
  });
});

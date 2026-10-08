import { describe, it, expect, vi, afterEach } from "vitest";
import { extractOrderIdsFromWaybillText, extractOrdersFromWaybillText, parseWaybillText } from "@/lib/zalo/parseWaybill";
import { tiledXml, TILED_LAYOUT_TEXT } from "../waybill/bboxFixture";

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
});

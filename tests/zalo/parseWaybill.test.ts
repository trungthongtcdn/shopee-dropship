import { describe, it, expect } from "vitest";
import { extractOrderIdsFromWaybillText, extractOrdersFromWaybillText } from "@/lib/zalo/parseWaybill";

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

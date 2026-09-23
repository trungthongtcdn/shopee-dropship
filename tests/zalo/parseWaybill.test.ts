import { describe, it, expect } from "vitest";
import { extractOrderIdsFromWaybillText } from "@/lib/zalo/parseWaybill";

describe("extractOrderIdsFromWaybillText", () => {
  it("extracts one order id per page from pdftotext -layout output", () => {
    // Shape verified against a real Shopee SPX waybill PDF sample.
    const text = `
                                                    Mã vận đơn: SPXVN068985623989
                                                   Mã đơn hàng: 260922P8S4YMTB

Từ:                                                      Đến:
Furni Home                                               Cuong Manh
\f
                                                    Mã vận đơn: SPXVN064903569589
                                                   Mã đơn hàng: 260922P94CFJ24
`;
    expect(extractOrderIdsFromWaybillText(text)).toEqual(["260922P8S4YMTB", "260922P94CFJ24"]);
  });

  it("returns an empty array when no order id line is present", () => {
    expect(extractOrderIdsFromWaybillText("some unrelated pdf content")).toEqual([]);
  });
});

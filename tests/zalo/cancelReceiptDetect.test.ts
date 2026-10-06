import { describe, it, expect } from "vitest";
import { extractOrderCodes } from "@/lib/zalo/cancelReceiptDetect";

describe("extractOrderCodes", () => {
  it("finds a bare order id", () => {
    expect(extractOrderCodes("260621MB6WJXKM")).toEqual(["260621MB6WJXKM"]);
  });

  it("finds an order id inside a sentence", () => {
    expect(extractOrderCodes("shop ơi đơn 260621MB6WJXKM đã nhận hàng huỷ rồi nhé")).toEqual(["260621MB6WJXKM"]);
  });

  it("finds a bare tracking code and uppercases it", () => {
    expect(extractOrderCodes("spxvn068985623989")).toEqual(["SPXVN068985623989"]);
  });

  it("finds a tracking code with the trailing letter suffix Shopee now appends", () => {
    expect(extractOrderCodes("SPXVN06781167424A - XO,2 L - huỷ -đã nhận")).toEqual(["SPXVN06781167424A"]);
  });

  it("finds both an order id and a tracking code in the same message", () => {
    const content = "Đã nhận huỷ đơn 260621MB6WJXKM, mã vận đơn SPXVN068985623989 nhé shop";
    expect(extractOrderCodes(content)).toEqual(["260621MB6WJXKM", "SPXVN068985623989"]);
  });

  it("finds multiple order ids in one message", () => {
    const content = "Nhận huỷ mấy đơn này: 260621MB6WJXKM 260920HNF4JUM6 26090342NR0MSC";
    expect(extractOrderCodes(content)).toEqual(["260621MB6WJXKM", "260920HNF4JUM6", "26090342NR0MSC"]);
  });

  it("dedupes a code repeated in the same message", () => {
    expect(extractOrderCodes("260621MB6WJXKM ... 260621MB6WJXKM")).toEqual(["260621MB6WJXKM"]);
  });

  it("returns an empty array for a message with no recognizable code", () => {
    expect(extractOrderCodes("shop ơi khi nào có hàng mới")).toEqual([]);
  });

  it("does not match a run of letters/digits shorter than a real code", () => {
    expect(extractOrderCodes("mã ABC123")).toEqual([]);
  });
});

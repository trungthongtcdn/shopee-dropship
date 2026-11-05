import { describe, it, expect } from "vitest";
import type { KiotLine, WaybillPage } from "@/lib/waybill/items";
import { assignKho, canonicalKho, compareKho, decideKho, parseKhoOverrides, splitByKho } from "@/lib/waybill/khoGiao";

const line = (khoGiao?: string): KiotLine => ({ sku: "S", quantity: 1, kiotCode: "K", ...(khoGiao ? { khoGiao } : {}) });
const page = (id: string, lines: (string | undefined)[][], extra: Partial<WaybillPage> = {}): WaybillPage => ({
  pageIndex: 0,
  shopeeOrderId: id,
  trackingCode: `SPXVN_${id}`,
  declaredTotalQuantity: 1,
  items: lines.map((kiotLines) => ({ name: "x", variant: "", quantity: 1, sku: "S", kiotLines: kiotLines.map(line) })),
  ...extra,
});

describe("decideKho (kho gửi)", () => {
  it("is the kho every product of the order says", () => {
    expect(decideKho(page("A", [["khouni"], ["KHOUNI"]]))).toEqual({ kho: "khouni", reason: "sheet" });
    expect(decideKho(page("B", [[" kholuan "]]))).toEqual({ kho: "khoLuan", reason: "sheet" });
  });

  it("is EMPTY — not khoLuan — when two Kiot codes are in different kho, so it can be filled by hand", () => {
    expect(decideKho(page("A", [["khouni", "khoLuan"]]))).toEqual({ kho: "", reason: "mixed" });
    expect(decideKho(page("B", [["khouni"], ["khoLuan"]]))).toEqual({ kho: "", reason: "mixed" });
  });

  it("is empty when a product has no kho, or no Kiot line at all, or the order has no product", () => {
    expect(decideKho(page("A", [["khouni", undefined]]))).toEqual({ kho: "", reason: "unknown" });
    expect(decideKho(page("B", [[]]))).toEqual({ kho: "", reason: "unknown" });
    expect(decideKho(page("C", []))).toEqual({ kho: "", reason: "unknown" });
  });

  it("does not care how the parcel travels: a non-SPX order is not moved to khoLuan here", () => {
    expect(decideKho(page("A", [["khouni"]], { trackingCode: "GYRVYTHX" }))).toEqual({ kho: "khouni", reason: "sheet" });
  });
});

describe("assignKho", () => {
  const pages = [page("A", [["khouni"]]), page("B", [["khouni", "khoLuan"]])];

  it("keeps what the sheet decided next to the order's kho", () => {
    expect(assignKho(pages).map((p) => [p.khoGiao, p.khoAuto])).toEqual([
      ["khouni", { kho: "khouni", reason: "sheet" }],
      ["", { kho: "", reason: "mixed" }],
    ]);
  });

  it("applies an edit by order id, and can fill an empty kho or empty a filled one", () => {
    const edited = assignKho(pages, new Map([["B", "khoLuan"], ["A", ""]]));
    expect(edited.map((p) => p.khoGiao)).toEqual(["", "khoLuan"]);
    expect(edited[0].khoAuto?.kho).toBe("khouni");
  });
});

describe("compareKho / splitByKho", () => {
  it("lists khoLuan first, the others by name and 'no kho' last", () => {
    expect(["", "khouni", "khoabc", "khoLuan"].sort(compareKho)).toEqual(["khoLuan", "khoabc", "khouni", ""]);
  });

  it("makes one block per kho, pages keeping their order, the orders with no kho in the last block", () => {
    const blocks = splitByKho(assignKho([page("A", [["khouni"]]), page("B", [["khouni", "khoLuan"]]), page("C", [["khoLuan"]]), page("D", [["KHOUNI"]])]));
    expect(blocks.map((b) => [b.kho, b.pages.map((p) => p.shopeeOrderId)])).toEqual([
      ["khoLuan", ["C"]],
      ["khouni", ["A", "D"]],
      ["", ["B"]],
    ]);
  });

  it("writes khoLuan one way whatever the case", () => {
    expect(canonicalKho(" KHOLUAN ")).toBe("khoLuan");
    expect(canonicalKho("kho  Uni")).toBe("kho Uni");
    expect(canonicalKho("")).toBe("");
  });
});

describe("parseKhoOverrides", () => {
  it("reads a JSON object of order id → kho, '' meaning no kho", () => {
    expect([...parseKhoOverrides('{"A":"khouni","B":""}')]).toEqual([["A", "khouni"], ["B", ""]]);
    expect([...parseKhoOverrides(null)]).toEqual([]);
  });

  it.each([["not json"], ["[1]"], ['{"A":3}'], ['{"A":"a/b"}'], [`{"A":"${"x".repeat(31)}"}`], ['{"":"khouni"}']])("refuses %s", (raw) => {
    expect(() => parseKhoOverrides(raw)).toThrow("khoOverrides không hợp lệ");
  });
});

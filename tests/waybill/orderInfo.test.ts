import { describe, it, expect } from "vitest";
import type { BboxWord } from "@/lib/waybill/layout";
import { findOrderInfoHeadings, hasOrderInfoHeading, readOrderInfo } from "@/lib/waybill/orderInfo";

const word = (text: string, x0: number, y0: number, x1: number, y1 = y0 + 5.6): BboxWord => ({ text, x0, y0, x1, y1 });

// The words of one label's "THÔNG TIN ĐƠN HÀNG" block, positioned like a real print
// (Letter sheet, positions taken from a seller's file; texts are made up): the heading
// and "OrderSN" line, then the table header, whose columns start at x = 0.8 (#),
// 14.3 (SKU), 29.2 (Tên sản phẩm), 81.5 (SKU phân loại), 101.9 (Phân loại hàng),
// 141.2 (SL). `body` is whatever goes under the header.
function block(body: BboxWord[], x = 0, top = 310.3): BboxWord[] {
  const at = (dx: number) => x + dx;
  return [
    word("THÔNG", at(2), top, at(27.2), top + 7.8),
    word("TIN", at(29.1), top, at(40.3), top + 7.8),
    word("ĐƠN", at(42.3), top, at(58.4), top + 7.8),
    word("HÀNG", at(60.4), top, at(80.9), top + 7.8),
    word("OrderSN:", at(2), top + 12.9, at(28.6)),
    word("ORDER1", at(31.2), top + 12.9, at(60)),
    word("#", at(0.8), top + 24.7, at(3.6)),
    word("SKU", at(14.3), top + 24.7, at(24.8)),
    word("Tên", at(29.2), top + 24.7, at(38)),
    word("sản", at(39.4), top + 24.7, at(48.6)),
    word("phẩm", at(50), top + 24.7, at(63.9)),
    word("SKU", at(81.5), top + 24.7, at(92)),
    word("phân", at(81.5), top + 29.7, at(93.4)),
    word("loại", at(81.5), top + 34.7, at(90.6)),
    word("Phân", at(101.9), top + 24.7, at(114.1)),
    word("loại", at(115.4), top + 24.7, at(124.6)),
    word("hàng", at(126), top + 24.7, at(137.9)),
    word("SL", at(141.2), top + 24.7, at(147.6)),
    ...body,
  ];
}

// A body row: its number, the lines of its SKU (x extents as printed), the product name
// (a column that must never leak into the SKU), the lines of its variation SKU when given,
// and the lines of its "Phân loại hàng" (one word, "D160", unless given).
function row(
  n: number,
  y: number,
  skuLines: [string, number][],
  variantSkuLines: [string, number][] = [],
  x = 0,
  variantLines: [string, number][] | null = null
): BboxWord[] {
  const lines = (list: [string, number][], column: number) =>
    list.flatMap(([text, width], i) => {
      // "da 1": a line with two words in it; `width` is the line's whole extent
      const parts = text.split(" ");
      const letters = text.replace(/ /g, "").length;
      let cursor = x + column;
      return parts.map((part) => {
        const w = word(part, cursor, y + 5 * i, cursor + ((width - 1.4 * (parts.length - 1)) * part.length) / letters);
        cursor = w.x1 + 1.4;
        return w;
      });
    });
  return [
    word(String(n), x + 0.8, y, x + 3.6),
    ...lines(skuLines, 14.3),
    word("Piston", x + 29.2, y, x + 43),
    word("ghế", x + 44.4, y, x + 54),
    ...lines(variantSkuLines, 81.5),
    ...(variantLines ? lines(variantLines, 101.9) : [word("D160", x + 101.9, y, x + 113.8)]),
    word("1", x + 141.2, y, x + 144),
  ];
}

describe("findOrderInfoHeadings / hasOrderInfoHeading", () => {
  it("finds the heading wherever it sits, once per label", () => {
    const words = [...block([], 0), ...block([], 396)];
    expect(findOrderInfoHeadings(words).map((w) => w.x0)).toEqual([2, 398]);
  });

  it("needs the whole heading, not a word of it", () => {
    expect(findOrderInfoHeadings([word("THÔNG", 0, 0, 10), word("TIN", 12, 0, 20), word("khác", 22, 0, 30)])).toEqual([]);
  });

  it("recognises the heading in plain text", () => {
    expect(hasOrderInfoHeading("a\nTHÔNG TIN ĐƠN HÀNG\nOrderSN: X")).toBe(true);
    expect(hasOrderInfoHeading("Nội dung hàng (Tổng SL sản phẩm: 1)")).toBe(false);
  });
});

describe("readOrderInfo", () => {
  it("returns null for a label without the block", () => {
    expect(readOrderInfo([word("Mã", 10, 10, 20)])).toBeNull();
  });

  it("says where the block starts", () => {
    expect(readOrderInfo(block([], 396, 310.3))!.top).toBeCloseTo(310.3);
  });

  // The column is narrow, so a SKU takes several lines. Whether a wrap fell on a space or
  // inside a word can't be known from the PDF; the lines are run together, nothing added.
  it("runs a wrapped SKU's lines together", () => {
    const body = row(1, 351.4, [["TyHoi", 12.7], ["_D16", 11.9], ["0_De", 11.9], ["n", 2.7]]);
    expect(readOrderInfo(block(body))!.skus.get(1)).toBe("TyHoi_D160_Den");
  });

  it("keeps the spaces inside a line as they are printed", () => {
    const body = row(2, 377.8, [["Móc", 9.4], ["5-", 4.4], ["hyun", 10.8], ["dai", 6.6], ["kèm", 9.4], ["quai", 9.4], ["da 1", 9.6], ["lớp", 6.9]]);
    expect(readOrderInfo(block(body))!.skus.get(2)).toBe("Móc5-hyundaikèmquaida 1lớp");
  });

  it("reads a SKU that fits on one line untouched", () => {
    expect(readOrderInfo(block(row(1, 351.4, [["ABC", 7.5]])))!.skus.get(1)).toBe("ABC");
    expect(readOrderInfo(block(row(1, 351.4, [["da 1", 9.6]])))!.skus.get(1)).toBe("da 1");
  });

  it("reads each row's SKU under its own number", () => {
    const body = [...row(1, 351.4, [["Bo_0", 11.6], ["5Ban", 11.6], ["hXe", 8.8]]), ...row(2, 377.8, [["chup", 10.9], ["100", 8.4]])];
    expect([...readOrderInfo(block(body))!.skus]).toEqual([
      [1, "Bo_05BanhXe"],
      [2, "chup100"],
    ]);
  });

  it("reads the SKU column only — never the SKU phân loại column next to it", () => {
    const body = [...row(1, 351.4, [["ABC", 7.5]], [["XYZ", 7.5]]), ...row(2, 377.8, [], [["ONLYVAR", 7.5]])];
    const skus = readOrderInfo(block(body))!.skus;
    expect(skus.get(1)).toBe("ABC");
    // a line with nothing in the SKU column has no SKU, whatever its variation SKU says
    expect(skus.has(2)).toBe(false);
  });

  it("leaves out a row whose SKU cells are empty", () => {
    const info = readOrderInfo(block(row(1, 351.4, [])))!;
    expect(info.skus.size).toBe(0);
    expect(info.top).toBeCloseTo(310.3);
  });

  it("does not take the product name or variant for part of the SKU", () => {
    expect(readOrderInfo(block(row(1, 351.4, [["ABC", 7.5]])))!.skus.get(1)).toBe("ABC");
  });

  it("still locates the block when the table header can't be read", () => {
    const heading = block([]).filter((w) => w.y0 < 330);
    const info = readOrderInfo(heading)!;
    expect(info.top).toBeCloseTo(310.3);
    expect(info.skus.size).toBe(0);
  });

  // The "Phân loại hàng" column wraps at word boundaries, so a break is a space.
  it("reads the variation as printed: a line break is a space", () => {
    const body = row(1, 351.4, [["ABC", 7.5]], [], 0, [["cao su trắng 1", 30], ["cặp", 6]]);
    expect(readOrderInfo(block(body))!.variants.get(1)).toBe("cao su trắng 1 cặp");
  });

  it("joins a variation cut after a hyphen or slash without a space", () => {
    const hyphen = row(1, 351.4, [["ABC", 7.5]], [], 0, [["xà thanh lý 80-", 33], ["130", 6]]);
    expect(readOrderInfo(block(hyphen))!.variants.get(1)).toBe("xà thanh lý 80-130");
    const slash = row(1, 351.4, [["ABC", 7.5]], [], 0, [["D100/", 11], ["D120", 9]]);
    expect(readOrderInfo(block(slash))!.variants.get(1)).toBe("D100/D120");
    // a dash standing on its own is a word: the break after it is a space
    const spaced = row(1, 351.4, [["ABC", 7.5]], [], 0, [["Đen -", 12], ["Nâu", 7]]);
    expect(readOrderInfo(block(spaced))!.variants.get(1)).toBe("Đen - Nâu");
  });

  it("reads the product name of each row, from the name column only", () => {
    const body = [...row(1, 351.4, [["ABC", 7.5]], [["VV", 4.9]], 0, [["D160", 9.8]]), ...row(2, 377.8, [["B", 2]])];
    const info = readOrderInfo(block(body))!;
    // "Piston" "ghế": the words of the name column; not the SKU, SKU phân loại, variation or SL
    expect([...info.names]).toEqual([
      [1, "Piston ghế"],
      [2, "Piston ghế"],
    ]);
  });

  it("joins a product name's wrapped lines with a space, except after a closing hyphen or slash", () => {
    // `row` writes the name as two words on the row's first line; add the lines that wrap
    const wrapped = (...lines: [string, number][]) =>
      lines.map(([text, x], i) => word(text, 29.2, 351.4 + 5 * (i + 1), 29.2 + x));
    const spaced = [...row(1, 351.4, [["ABC", 7.5]]), ...wrapped(["xà đơn gắn cửa", 40])];
    expect(readOrderInfo(block(spaced))!.names.get(1)).toBe("Piston ghế xà đơn gắn cửa");
    const hyphen = [word("60-", 29.2, 351.4, 36), word("130cm", 29.2, 356.4, 45), word("1", 0.8, 351.4, 3.6)];
    expect(readOrderInfo(block(hyphen))!.names.get(1)).toBe("60-130cm");
  });

  it("does not take the SKU phân loại column for the variation, nor the quantity", () => {
    const body = row(1, 351.4, [["ABC", 7.5]], [["VV", 4.9]], 0, [["D160", 9.8]]);
    expect(readOrderInfo(block(body))!.variants.get(1)).toBe("D160");
    expect(readOrderInfo(block(body))!.skus.get(1)).toBe("ABC");
  });

  it("reads the variation of each row under its own number", () => {
    const body = [...row(1, 351.4, [["A", 2]], [], 0, [["chụp 100", 18]]), ...row(2, 377.8, [["B", 2]], [], 0, [["Đen,", 10], ["HYUNDAI", 17]])];
    expect([...readOrderInfo(block(body))!.variants]).toEqual([
      [1, "chụp 100"],
      [2, "Đen, HYUNDAI"],
    ]);
  });

  it("has no variations when the table has no \"Phân loại hàng\" header", () => {
    const heading = block(row(1, 351.4, [["ABC", 7.5]])).filter((w) => !["loại", "hàng"].includes(w.text) || w.x0 < 100);
    const info = readOrderInfo(heading)!;
    expect(info.variants.size).toBe(0);
    expect(info.skus.get(1)).toBe("ABC");
  });

  it("works for the second label on a sheet, whose table starts at the cell's edge", () => {
    const body = row(1, 351.4, [["TyHoi", 12.7], ["_D10", 11.9], ["0", 2.7]], [], 396);
    expect(readOrderInfo(block(body, 396))!.skus.get(1)).toBe("TyHoi_D100");
  });
});

import { describe, it, expect } from "vitest";
import { cellLayout, cellText, type BboxWord } from "@/lib/waybill/layout";
import { parseLabelText } from "@/lib/waybill/items";

const H = 6;
const word = (text: string, x0: number, y0: number, x1: number): BboxWord => ({ text, x0, y0, x1, y1: y0 + H });

// A label's item block: the header, then lines at y = 8, 16, 24 (a bit over one line apart).
// Line A runs to the full width of the block (100); B stops at 30; C at 50.
function itemBlock(): BboxWord[] {
  return [
    word("Nội", 0, 0, 10),
    word("dung", 12, 0, 24),
    word("hàng", 26, 0, 38),
    word("(Tổng", 40, 0, 56),
    word("SL", 58, 0, 64),
    word("sản", 66, 0, 76),
    word("phẩm:", 78, 0, 94),
    word("1)", 96, 0, 102),
    word("1.", 0, 8, 6),
    word("Móc", 8, 8, 30),
    word("khóa,", 32, 8, 60),
    word("Bộ", 62, 8, 76),
    word("XYZABCD", 78, 8, 100),
    word("QWE", 0, 16, 30),
    word("RTY,", 0, 24, 20),
    word("SL:", 22, 24, 34),
    word("1", 36, 24, 40),
  ];
}

describe("cellLayout", () => {
  it("gives the same text as cellText", () => {
    expect(cellLayout(itemBlock()).text).toBe(cellText(itemBlock()));
  });

  it("marks a line that stopped with room for the next line's first character", () => {
    const { text, spaceAfter } = cellLayout(itemBlock());
    expect(text.split("\n")).toEqual([
      "Nội dung hàng (Tổng SL sản phẩm: 1)",
      "1. Móc khóa, Bộ XYZABCD",
      "QWE",
      "RTY, SL: 1",
    ]);
    // the full line (100 of 100) is not marked; "QWE" (30 of 100) is: "RTY" can't have fitted after it by luck
    expect(spaceAfter).toEqual([false, false, true, false]);
  });

  it("marks nothing for a label with no item block", () => {
    const words = [word("Mã", 0, 0, 10), word("vận", 12, 0, 24), word("đơn:", 26, 0, 40), word("T1", 0, 8, 20)];
    expect(cellLayout(words).spaceAfter).toEqual([false, false]);
  });

  it("ignores the label's right-hand column when measuring where a line ends", () => {
    const words = [...itemBlock(), word("HN-20-17-HK04-N", 400, 16, 480)];
    // "QWE" shares a text line with a far-away sorting code; the code is not item text
    expect(cellLayout(words).spaceAfter).toEqual([false, false, true, false]);
  });
});

describe("parseLabelText with the wrap geometry", () => {
  const text = "Mã vận đơn: T1\nMã đơn hàng: O1\n\nNội dung hàng (Tổng SL sản phẩm: 1)\n1. Móc khóa, Bộ XYZ\nQWE, SL: 1";

  it("reads a wrap as a cut word when nothing says otherwise", () => {
    expect(parseLabelText(text, 0)!.items[0]).toMatchObject({ name: "Móc khóa", variant: "Bộ XYZQWE", quantity: 1 });
  });

  it("puts the space back where the geometry says the line had room to spare", () => {
    const spaceAfter = text.split("\n").map((line) => line.startsWith("1. Móc"));
    expect(parseLabelText(text, 0, spaceAfter)!.items[0]).toMatchObject({ name: "Móc khóa", variant: "Bộ XYZ QWE", quantity: 1 });
  });
});

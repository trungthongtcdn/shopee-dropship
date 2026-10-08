import { describe, it, expect } from "vitest";
import {
  extractWaybillPagesFromText,
  joinWrappedLines,
  groupWaybillPages,
  orderedPageIndexes,
  type WaybillPage,
} from "@/lib/waybill/items";

// Shape copied from a real Shopee SPX AWB (`pdftotext -layout`, pages split by
// \f) with the sender/receiver blocks removed — recipients are customers'
// personal data, and nothing here reads them.
const PAGE_PISTON = `
                                                    Mã vận đơn: SPXVN06320209888A
                                                   Mã đơn hàng: 261006UMM8YEW0

          MB-17-06-LG24-N                                                      YÊN MỸ 02
Nội dung hàng (Tổng SL sản phẩm: 1)
1. [FURNI HOME] Piston ghế/ Ben hơi ghế xoay văn phòng
D100 D120 D160 INOX KHÔNG GỈ, Piston hàng loại 1 chấ
t lượng cao, D100, SL: 1




                                                                                     HN-20-25-
                                                                                     HBVTU-N
`;

const PAGE_WALLET = `
                                                    Mã vận đơn: SPXVN06879914152A
                                                   Mã đơn hàng: 261006UXT0K4U8

Nội dung hàng (Tổng SL sản phẩm: 1)
1. [FURNI HOME] Ví đựng thẻ cao cấp 4K, ví da đựng đăn
g kiểm giấy tờ ô tô da bò chống thấm nước nhiều logo xe,
VÍ ĐEN,VINFAST, SL: 1


                                                                                     HN-20-25-
`;

const PAGE_FREESHIP_A = `
                                                    Mã vận đơn: SPXVN06351442813A
                                                   Mã đơn hàng: 261006UY0Q6UGG

Nội dung hàng (Tổng SL sản phẩm: 1)
1. [FURNI HOME] Phụ Kiện GHẾ VĂN PHÒNG FREESHI
P ghế xoay, bánh xe , chân ghế inox, chân inox + 5bánh x
e, SL: 1


`;

const PAGE_FREESHIP_B = PAGE_FREESHIP_A.replace("SPXVN06351442813A", "SPXVN06288328774A").replace("261006UY0Q6UGG", "261006V2GSYMCY");

const PAGE_TWO_ITEMS = `
                                                    Mã vận đơn: SPXVN06659627892A
                                                   Mã đơn hàng: 261006V7VWF1EH

Nội dung hàng (Tổng SL sản phẩm: 5)
1. [FURNI HOME] Sỉ Nắp chụp ống bạc, nắp chụp ống thô
ng gió, phi 100mm, SL: 4
2. [FURNI HOME] Ốc vít inox, M6, SL: 1


                                                                                     HN-20-25-
`;

const PAGE_NO_ITEMS = `
                                                    Mã vận đơn: GYRK89W4
                                                   Mã đơn hàng: 261003N15DHKM8

Từ:                                                      Đến:
`;

const PAGE_HIDDEN_ITEMS = `
                                                    Mã vận đơn: SPXVN06000000001A
                                                   Mã đơn hàng: 261006AAAAAAAA

Nội dung hàng (Tổng SL sản phẩm: 7)
1. [FURNI HOME] Ốc vít inox, M6, SL: 1


`;

const join = (...pages: string[]) => pages.join("\f");

describe("joinWrappedLines", () => {
  it("rejoins a word the label broke in the middle", () => {
    expect(joinWrappedLines(["1. Piston hàng loại 1 chấ", "t lượng cao"])).toBe("1. Piston hàng loại 1 chất lượng cao");
  });

  it("keeps a space where the wrap fell between two words", () => {
    expect(joinWrappedLines(["Sỉ Côn Thu Phễu Thu Ống Quạt Thông", "Gió Hút Mùi"])).toBe("Sỉ Côn Thu Phễu Thu Ống Quạt Thông Gió Hút Mùi");
  });

  it("does not split an ALL-CAPS word that the wrap cut in two", () => {
    expect(joinWrappedLines(["GHẾ VĂN PHÒNG FREESHI", "P ghế xoay"])).toBe("GHẾ VĂN PHÒNG FREESHIP ghế xoay");
  });

  it("puts a space after a line that ends in a comma", () => {
    expect(joinWrappedLines(["logo xe,", "VÍ ĐEN,VINFAST, SL: 1"])).toBe("logo xe, VÍ ĐEN,VINFAST, SL: 1");
  });
});

describe("extractWaybillPagesFromText", () => {
  it("reads name, variant and quantity of a wrapped single-item page", () => {
    const [page] = extractWaybillPagesFromText(PAGE_PISTON);
    expect(page.shopeeOrderId).toBe("261006UMM8YEW0");
    expect(page.trackingCode).toBe("SPXVN06320209888A");
    expect(page.declaredTotalQuantity).toBe(1);
    expect(page.items).toEqual([
      {
        name: "Piston ghế/ Ben hơi ghế xoay văn phòng D100 D120 D160 INOX KHÔNG GỈ, Piston hàng loại 1 chất lượng cao",
        variant: "D100",
        quantity: 1,
      },
    ]);
  });

  it("splits the variant off the end even when the name itself contains commas", () => {
    const [page] = extractWaybillPagesFromText(PAGE_WALLET);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe("Ví đựng thẻ cao cấp 4K, ví da đựng đăng kiểm giấy tờ ô tô da bò chống thấm nước nhiều logo xe");
    expect(page.items[0].variant).toBe("VÍ ĐEN,VINFAST");
  });

  it("reads several items of one order", () => {
    const [page] = extractWaybillPagesFromText(PAGE_TWO_ITEMS);
    expect(page.declaredTotalQuantity).toBe(5);
    expect(page.items.map((i) => [i.variant, i.quantity])).toEqual([
      ["phi 100mm", 4],
      ["M6", 1],
    ]);
  });

  it("reads every page of a multi-page document and ignores the empty tail after the last form feed", () => {
    const pages = extractWaybillPagesFromText(join(PAGE_PISTON, PAGE_WALLET, ""));
    expect(pages.map((p) => p.shopeeOrderId)).toEqual(["261006UMM8YEW0", "261006UXT0K4U8"]);
  });

  it("keeps a page whose items can't be read, with an empty item list", () => {
    const [page] = extractWaybillPagesFromText(PAGE_NO_ITEMS);
    expect(page).toMatchObject({ shopeeOrderId: "261003N15DHKM8", trackingCode: "GYRK89W4", items: [], declaredTotalQuantity: null });
  });

  it("returns nothing for text with no order id", () => {
    expect(extractWaybillPagesFromText("some unrelated pdf content")).toEqual([]);
  });
});

function pages(...texts: string[]): WaybillPage[] {
  return extractWaybillPagesFromText(join(...texts));
}

describe("groupWaybillPages", () => {
  it("puts identical orders next to each other even when the PDF interleaves them", () => {
    const groups = groupWaybillPages(pages(PAGE_FREESHIP_A, PAGE_WALLET, PAGE_FREESHIP_B));
    expect(groups.map((g) => g.pages.map((p) => p.shopeeOrderId))).toEqual([
      ["261006UY0Q6UGG", "261006V2GSYMCY"],
      ["261006UXT0K4U8"],
    ]);
  });

  it("treats two orders as identical only when variant and quantity both match", () => {
    const otherQty = PAGE_FREESHIP_B.replace("e, SL: 1", "e, SL: 2");
    const groups = groupWaybillPages(pages(PAGE_FREESHIP_A, otherQty));
    expect(groups).toHaveLength(2);
  });

  it("ignores whitespace and case when comparing items", () => {
    const wrappedDifferently = PAGE_FREESHIP_B.replace("FREESHI\nP ghế", "FREESHIP\nghế");
    const groups = groupWaybillPages(pages(PAGE_FREESHIP_A, wrappedDifferently));
    expect(groups).toHaveLength(1);
    expect(groups[0].pages).toHaveLength(2);
  });

  it("is order-insensitive for multi-item orders", () => {
    const swapped = PAGE_TWO_ITEMS.replace("261006V7VWF1EH", "261006SWAPPED0")
      .replace(/1\. \[FURNI HOME\] Sỉ Nắp chụp ống bạc, nắp chụp ống thô\nng gió, phi 100mm, SL: 4\n2\. \[FURNI HOME\] Ốc vít inox, M6, SL: 1/, "1. [FURNI HOME] Ốc vít inox, M6, SL: 1\n2. [FURNI HOME] Sỉ Nắp chụp ống bạc, nắp chụp ống thô\nng gió, phi 100mm, SL: 4");
    const groups = groupWaybillPages(pages(PAGE_TWO_ITEMS, swapped));
    expect(groups).toHaveLength(1);
  });

  it("orders groups largest first, and keeps PDF order inside a group", () => {
    const groups = groupWaybillPages(pages(PAGE_PISTON, PAGE_FREESHIP_A, PAGE_WALLET, PAGE_FREESHIP_B));
    expect(groups.map((g) => g.pages.length)).toEqual([2, 1, 1]);
    expect(groups[0].pages.map((p) => p.shopeeOrderId)).toEqual(["261006UY0Q6UGG", "261006V2GSYMCY"]);
  });

  it("breaks ties between same-size groups by product name so similar products sit together", () => {
    const groups = groupWaybillPages(pages(PAGE_WALLET, PAGE_PISTON));
    // "Piston…" sorts before "Ví…"
    expect(groups.map((g) => g.pages[0].shopeeOrderId)).toEqual(["261006UMM8YEW0", "261006UXT0K4U8"]);
  });

  it("puts pages with unreadable items in a last group instead of dropping them", () => {
    const groups = groupWaybillPages(pages(PAGE_NO_ITEMS, PAGE_PISTON));
    expect(groups.map((g) => g.pages[0].shopeeOrderId)).toEqual(["261006UMM8YEW0", "261003N15DHKM8"]);
    expect(groups[1].readable).toBe(false);
  });

  it("gives every page exactly one place in the output", () => {
    const all = pages(PAGE_PISTON, PAGE_WALLET, PAGE_FREESHIP_A, PAGE_FREESHIP_B, PAGE_TWO_ITEMS, PAGE_NO_ITEMS);
    const groups = groupWaybillPages(all);
    expect(groups.flatMap((g) => g.pages).map((p) => p.shopeeOrderId).sort()).toEqual(all.map((p) => p.shopeeOrderId).sort());
  });

  it("flags a page whose readable quantities don't add up to the label's total", () => {
    const [group] = groupWaybillPages(pages(PAGE_HIDDEN_ITEMS));
    expect(group.pages[0].note).toMatch(/7/);
  });

  it("raises no note when the quantities add up", () => {
    const [group] = groupWaybillPages(pages(PAGE_TWO_ITEMS));
    expect(group.pages[0].note).toBeNull();
  });
});

describe("pageIndex (which page of the source PDF an order is on)", () => {
  it("is the 0-based position in the document", () => {
    const pages = extractWaybillPagesFromText(join(PAGE_PISTON, PAGE_WALLET, PAGE_FREESHIP_A));
    expect(pages.map((p) => [p.shopeeOrderId, p.pageIndex])).toEqual([
      ["261006UMM8YEW0", 0],
      ["261006UXT0K4U8", 1],
      ["261006UY0Q6UGG", 2],
    ]);
  });

  it("still counts a page that names no order, so later pages keep their real position", () => {
    const COVER = "\n   Some cover page with no order on it\n";
    const pages = extractWaybillPagesFromText(join(COVER, PAGE_PISTON, COVER, PAGE_WALLET));
    expect(pages.map((p) => [p.shopeeOrderId, p.pageIndex])).toEqual([
      ["261006UMM8YEW0", 1],
      ["261006UXT0K4U8", 3],
    ]);
  });
});

describe("orderedPageIndexes", () => {
  it("lists source pages in exactly the order the groups (and so the Excel rows) have", () => {
    // PDF order: piston(0), freeship A(1), wallet(2), freeship B(3)
    const groups = groupWaybillPages(pages(PAGE_PISTON, PAGE_FREESHIP_A, PAGE_WALLET, PAGE_FREESHIP_B));
    // Groups: the two freeship orders first (pages 1, 3), then the singles by name.
    expect(orderedPageIndexes(groups)).toEqual([1, 3, 0, 2]);
    expect(orderedPageIndexes(groups)).toEqual(groups.flatMap((g) => g.pages.map((p) => p.pageIndex)));
  });

  it("includes pages whose items couldn't be read, last", () => {
    const groups = groupWaybillPages(pages(PAGE_NO_ITEMS, PAGE_PISTON));
    expect(orderedPageIndexes(groups)).toEqual([1, 0]);
  });

  it("is empty for no groups", () => {
    expect(orderedPageIndexes([])).toEqual([]);
  });
});

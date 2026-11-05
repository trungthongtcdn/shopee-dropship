import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWaybillFileSet } from "@/lib/waybill/files";
import { safeKhoName, waybillKhoFileName } from "@/lib/waybill/excel";
import { planKho } from "@/lib/waybill/khoSummary";
import type { WaybillPage } from "@/lib/waybill/items";
import { makePdf, pageWidths } from "./pdfFixture";

const AT = new Date("2026-10-09T02:20:00Z"); // 9h0910 in Vietnam

// An order whose Kiot lines say they ship from each of `khos` (a missing one = the sheet gives none).
function order(pageIndex: number, id: string, name: string, khos: (string | undefined)[]): WaybillPage {
  return {
    pageIndex,
    shopeeOrderId: id,
    trackingCode: `SPXVN_${id}`,
    declaredTotalQuantity: 1,
    shopName: "Furni Home",
    items: [
      {
        name,
        variant: "V",
        quantity: 1,
        sku: name,
        kiotLines: khos.map((khoGiao, i) => ({ sku: name, quantity: 1, kiotCode: `${name}_${i}`, kiotStore: "kho56", ...(khoGiao ? { khoGiao } : {}) })),
      },
    ],
  };
}

// Page i of the source PDF is (101 + i) wide.
const pages = [
  order(0, "K0", "Ghế", ["khoLuan"]),
  order(1, "K1", "Piston", ["khouni"]),
  order(2, "K2", "Ghế", ["khoLuan"]),
  order(3, "K3", "Ví", ["khoLuan", "khouni"]), // two kho: no kho gửi
  order(4, "K4", "Piston", ["khouni"]),
];
const widthsOf = async (data: Buffer) => (await pageWidths(data)).map((width) => width - 101);

async function rowsOf(data: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  const rows: { tracking: string; kho: string }[] = [];
  workbook.worksheets[0].eachRow((row, i) => {
    if (i > 1) rows.push({ tracking: String(row.getCell(5).value).replace(/^SPXVN_/, ""), kho: String(row.getCell(3).value ?? "") });
  });
  return rows;
}

describe("buildWaybillFileSet", () => {
  it("lists the orders kho by kho — khoLuan, the others, then the orders with no kho — identical orders together", async () => {
    const set = await buildWaybillFileSet({ pages, at: AT, sourcePdf: await makePdf(5) });

    expect((await rowsOf(set.excel.data)).map((r) => [r.tracking, r.kho])).toEqual([
      ["K0", "khoLuan"],
      ["K2", "khoLuan"],
      ["K1", "khouni"],
      ["K4", "khouni"],
      ["K3", ""],
    ]);
    expect(await widthsOf(set.pdf!.data)).toEqual([0, 2, 1, 4, 3]);
    expect(set.excel.name).toBe("Furni_9h0910_5 đơn_Đã gom.xlsx");
    expect(set.pdf!.name).toBe("Furni_9h0910_5 đơn_Đã gom.pdf");
  });

  it("makes one Excel and one PDF per kho, each with only that kho's orders, in the overall order", async () => {
    const set = await buildWaybillFileSet({ pages, at: AT, sourcePdf: await makePdf(5) });

    expect(set.perKho.map((f) => [f.kho, f.orderCount, f.excel.name, f.pdf?.name])).toEqual([
      ["khoLuan", 2, "Furni_9h0910_2 đơn_Đã gom_khoLuan.xlsx", "Furni_9h0910_2 đơn_Đã gom_khoLuan.pdf"],
      ["khouni", 2, "Furni_9h0910_2 đơn_Đã gom_khouni.xlsx", "Furni_9h0910_2 đơn_Đã gom_khouni.pdf"],
      ["", 1, "Furni_9h0910_1 đơn_Đã gom_chua-co-kho.xlsx", "Furni_9h0910_1 đơn_Đã gom_chua-co-kho.pdf"],
    ]);
    expect(await Promise.all(set.perKho.map((f) => widthsOf(f.pdf!.data)))).toEqual([[0, 2], [1, 4], [3]]);
    expect((await Promise.all(set.perKho.map((f) => rowsOf(f.excel.data)))).map((rows) => rows.map((r) => r.tracking))).toEqual([["K0", "K2"], ["K1", "K4"], ["K3"]]);
  });

  it("puts a parcel that is not Shopee Express in khoLuan, though the sheet says khouni", async () => {
    const viettel = { ...order(5, "V5", "Ví", ["khouni"]), trackingCode: "GYRVYTHX" };
    const set = await buildWaybillFileSet({ pages: [pages[1], viettel], at: AT, sourcePdf: await makePdf(6) });

    expect(set.summary.orders.map((o) => [o.orderId, o.kho, o.reason])).toEqual([
      ["V5", "khoLuan", "not-spx"],
      ["K1", "khouni", "sheet"],
    ]);
    expect(set.perKho.map((f) => [f.kho, f.orderCount])).toEqual([["khoLuan", 1], ["khouni", 1]]);
  });

  it("makes no per-kho file when every order is at one kho", async () => {
    const set = await buildWaybillFileSet({ pages: [pages[0], pages[2]], at: AT, sourcePdf: await makePdf(5) });
    expect(set.perKho).toEqual([]);
    expect(set.summary.groups).toEqual([{ kho: "khoLuan", orderCount: 2 }]);
  });

  it("applies the edits: filling the empty kho moves that order, in every file", async () => {
    const set = await buildWaybillFileSet({ pages, at: AT, sourcePdf: await makePdf(5), overrides: new Map([["K3", "khouni"]]) });

    expect(set.perKho.map((f) => [f.kho, f.orderCount])).toEqual([["khoLuan", 2], ["khouni", 3]]);
    expect(await widthsOf(set.perKho[1].pdf!.data)).toEqual([1, 4, 3]);
    expect(set.summary).toMatchObject({ edited: 1, blank: 0 });
  });

  it("makes only Excel files when there is no source PDF", async () => {
    const set = await buildWaybillFileSet({ pages, at: AT });
    expect(set.pdf).toBeNull();
    expect(set.perKho.map((f) => f.pdf)).toEqual([null, null, null]);
    expect(set.perKho.map((f) => f.excel.data.length > 0)).toEqual([true, true, true]);
  });

  it("puts the red alert on the overall Excel only, when the PDF has more labels than orders were read", async () => {
    const set = await buildWaybillFileSet({ pages, at: AT, labelCount: 7 });
    const first = async (data: Buffer) => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
      return String(workbook.worksheets[0].getCell("A1").value);
    };
    expect(await first(set.excel.data)).toMatch(/CẢNH BÁO/);
    expect(await first(set.perKho[0].excel.data)).toBe("Nhóm");
  });
});

describe("planKho: what the page shows", () => {
  it("says for every order which kho it is at, what the sheet decided and why, and what each line says", () => {
    const { summary } = planKho(pages, new Map(), ["khoLuan", "khoabc"]);

    expect(summary.options).toEqual(["khoLuan", "khoabc", "khouni"]);
    expect(summary.groups).toEqual([
      { kho: "khoLuan", orderCount: 2 },
      { kho: "khouni", orderCount: 2 },
      { kho: "", orderCount: 1 },
    ]);
    expect(summary.blank).toBe(1);
    const mixed = summary.orders.find((o) => o.orderId === "K3")!;
    expect(mixed).toMatchObject({ kho: "", auto: "", reason: "mixed", shopName: "Furni Home", products: "Ví [V] ×1" });
    expect(mixed.lines).toEqual([
      { code: "Ví_0", quantity: 1, kho: "khoLuan" },
      { code: "Ví_1", quantity: 1, kho: "khouni" },
    ]);
  });

  it("falls back to the SKU where a line has no Kiot code, and to nothing for an item with no SKU", () => {
    const page = order(0, "X", "Ghế", []);
    page.items = [
      { name: "A", variant: "", quantity: 2, sku: "SKU_A", kiotLines: [{ sku: "SKU_A", quantity: 2 }] },
      { name: "B", variant: "", quantity: 1, sku: "SKU_B" },
      { name: "C", variant: "", quantity: 1 },
    ];
    expect(planKho([page]).summary.orders[0].lines).toEqual([
      { code: "SKU_A", quantity: 2, kho: null },
      { code: "SKU_B", quantity: 1, kho: null },
    ]);
  });
});

describe("kho file names", () => {
  it("keeps letters, digits and . _ -, turns spaces into _, and names the empty kho", () => {
    expect(safeKhoName("kho Uni 2")).toBe("kho_Uni_2");
    expect(safeKhoName("kho/Luân:1")).toBe("khoLuân1");
    expect(safeKhoName("")).toBe("chua-co-kho");
    expect(safeKhoName("///")).toBe("chua-co-kho");
    expect(waybillKhoFileName(AT, 3, "khouni", "pdf")).toBe("Furni_9h0910_3 đơn_Đã gom_khouni.pdf");
  });
});

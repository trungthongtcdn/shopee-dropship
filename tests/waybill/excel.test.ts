import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWaybillExcel, waybillExcelFileName } from "@/lib/waybill/excel";
import { groupWaybillPages, type WaybillPage } from "@/lib/waybill/items";

let nextPageIndex = 0;
function page(orderId: string, tracking: string, items: [string, string, number][], declared?: number): WaybillPage {
  return {
    pageIndex: nextPageIndex++,
    shopeeOrderId: orderId,
    trackingCode: tracking,
    declaredTotalQuantity: declared ?? (items.length ? items.reduce((s, i) => s + i[2], 0) : null),
    items: items.map(([name, variant, quantity]) => ({ name, variant, quantity })),
  };
}

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  const rows: ExcelJS.CellValue[][] = [];
  sheet.eachRow((row) => rows.push((row.values as ExcelJS.CellValue[]).slice(1)));
  return { sheet, rows };
}

describe("buildWaybillExcel", () => {
  const pages = [
    page("ORDER_A1", "SPX_A1", [["Ghế xoay", "Đen", 1]]),
    page("ORDER_B1", "SPX_B1", [["Piston", "D100", 2]]),
    page("ORDER_A2", "SPX_A2", [["Ghế xoay", "Đen", 1]]),
    page("ORDER_M1", "SPX_M1", [["Ống", "phi 100", 4], ["Ốc vít", "M6", 1]], 6),
    page("ORDER_X1", "SPX_X1", []),
  ];
  const groups = groupWaybillPages(pages);

  it("writes a header row followed by one row per product line, identical orders adjacent", async () => {
    const { rows } = await readBack(await buildWaybillExcel(groups));

    expect(rows[0]).toEqual(["Nhóm", "Số đơn", "STT", "Mã đơn hàng", "Mã vận đơn", "Sản phẩm", "Phân loại", "SL", "Ghi chú"]);
    // Largest group first (the two "Ghế xoay", PDF order kept inside it), then
    // singles by product name, unreadable last.
    expect(rows.slice(1).map((r) => r[3])).toEqual(["ORDER_A1", "ORDER_A2", "ORDER_M1", "ORDER_M1", "ORDER_B1", "ORDER_X1"]);
  });

  it("numbers groups and orders, repeats order data on each line of a multi-item order", async () => {
    const { rows } = await readBack(await buildWaybillExcel(groups));
    const body = rows.slice(1);

    // Nhóm / Số đơn
    expect(body.slice(0, 2).map((r) => [r[0], r[1]])).toEqual([[1, 2], [1, 2]]);
    // STT counts orders, not lines: both lines of ORDER_M1 share one STT.
    const m = body.filter((r) => r[3] === "ORDER_M1");
    expect(m).toHaveLength(2);
    expect(m[0][2]).toBe(m[1][2]);
    expect(m.map((r) => [r[5], r[6], r[7]])).toEqual([["Ống", "phi 100", 4], ["Ốc vít", "M6", 1]]);
    expect(m[0][4]).toBe("SPX_M1");
  });

  it("writes SL as a number so the warehouse can sum it", async () => {
    const { rows } = await readBack(await buildWaybillExcel(groups));
    const piston = rows.slice(1).find((r) => r[3] === "ORDER_B1")!;
    expect(piston[7]).toBe(2);
  });

  it("lists unreadable orders last, with a note", async () => {
    const { rows } = await readBack(await buildWaybillExcel(groups));
    const last = rows[rows.length - 1];
    expect(last[3]).toBe("ORDER_X1");
    expect(String(last[8])).toMatch(/Không đọc được/);
  });

  it("freezes the header and turns on the filter", async () => {
    const { sheet } = await readBack(await buildWaybillExcel(groups));
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("still produces a valid workbook with only a header for an empty list", async () => {
    const { rows } = await readBack(await buildWaybillExcel([]));
    expect(rows).toHaveLength(1);
  });
});

describe("waybillExcelFileName", () => {
  it("uses Vietnam time and only filename-safe characters", () => {
    // 2026-10-07T03:15:00Z is 10:15 in Việt Nam.
    expect(waybillExcelFileName(new Date("2026-10-07T03:15:00Z"))).toBe("danh-sach-don-gom-nhom-20261007-1015.xlsx");
  });

  it("rolls the date over with the VN offset, not UTC", () => {
    expect(waybillExcelFileName(new Date("2026-10-06T20:30:00Z"))).toBe("danh-sach-don-gom-nhom-20261007-0330.xlsx");
  });
});

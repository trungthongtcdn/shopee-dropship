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

// Labels with an order-info table: the sheet follows the warehouse's accounting file
// ("FILE CONVERT FULL THÔNG TIN ĐƠN SHOPEE") — its 19 columns in its order.
describe("buildWaybillExcel for labels with SKUs", () => {
  const TEMPLATE_HEADERS = [
    "NGÀY IN", "BUỔI", "STT", "MÃ VẬN ĐƠN", "Mã Kiot", "Kho Kiot", "SKU PHÂN LOẠI HÀNG", "SỐ LƯỢNG", "GIAN", "Giá Vốn",
    "Tổng GV", "HỦY SAU IN", "TRÙNG", "Tiền xuất", "SL SP", "tổng Số Đơn", "phân loại hàng", "Nhóm", "số đơn giống",
  ];
  // 03:15Z is 10:15 in Việt Nam: morning of 8 Oct.
  const AT = new Date("2026-10-08T03:15:00Z");

  let index = 0;
  const withSku = (trackingCode: string, items: [string, string, number, string | undefined][], extra: Partial<WaybillPage> = {}): WaybillPage => ({
    pageIndex: index++,
    shopeeOrderId: `ORDER_${trackingCode}`,
    trackingCode,
    declaredTotalQuantity: items.reduce((sum, item) => sum + item[2], 0),
    shopName: "Kho Sỉ",
    items: items.map(([name, variant, quantity, sku]) => ({ name, variant, quantity, ...(sku ? { sku } : {}) })),
    ...extra,
  });

  const pages = [
    withSku("TRK_A1", [["Ghế xoay", "Đen", 1, "GX_DEN"]]),
    withSku("TRK_M1", [["Ống", "phi 100", 4, "ONG100"], ["Ốc vít", "M6", 1, "OC_M6"]]),
    withSku("TRK_A2", [["Ghế xoay", "Đen", 1, "GX_DEN"]]),
    withSku("TRK_N1", [["Piston", "D100", 2, undefined]]),
  ];

  async function build(list: WaybillPage[] = pages, at = AT) {
    const result = await readBack(await buildWaybillExcel(groupWaybillPages(list), at));
    return { ...result, merges: ((result.sheet.model as { merges?: string[] }).merges ?? []).slice().sort() };
  }

  it("has the accounting file's columns, in its order", async () => {
    const { rows } = await build();
    expect(rows[0]).toEqual(TEMPLATE_HEADERS);
  });

  it("writes one row per product line: tracking code, SKU, quantity, shop, variant, group", async () => {
    const { rows } = await build();
    // Groups: the two "Ghế xoay" first (2 identical orders), then singles by product name.
    expect(rows.slice(1).map((r) => [r[2], r[3], r[6] ?? null, r[7], r[8], r[16], r[17], r[18]])).toEqual([
      [1, "TRK_A1", "GX_DEN", 1, "Kho Sỉ", "Đen", 1, 2],
      [2, "TRK_A2", "GX_DEN", 1, "Kho Sỉ", "Đen", 1, 2],
      [3, "TRK_M1", "ONG100", 4, "Kho Sỉ", "phi 100", 2, 1],
      [3, "TRK_M1", "OC_M6", 1, "Kho Sỉ", "M6", 2, 1],
      [4, "TRK_N1", null, 2, "Kho Sỉ", "D100", 3, 1],
    ]);
  });

  it("merges the order's own cells over its lines — STT, tracking code, group, group size", async () => {
    const { merges } = await build();
    // The only two-line order is row 4-5 (header is row 1).
    expect(merges).toEqual(["C4:C5", "D4:D5", "R4:R5", "S4:S5"]);
  });

  it("leaves what the label can't say empty, and ties Tổng GV to Giá Vốn × Số lượng", async () => {
    const { rows, sheet } = await build();
    for (const column of [4, 5, 9, 11, 12, 13, 14, 15]) {
      expect(rows.slice(1).every((r) => r[column] === null || r[column] === undefined)).toBe(true);
    }
    const total = sheet.getCell("K2").value as ExcelJS.CellFormulaValue;
    expect(total.formula).toBe('IF(OR(J2="",H2=""),"",J2*H2)');
  });

  it("puts the print date and shift (Vietnam time) on every row", async () => {
    const { rows } = await build();
    for (const r of rows.slice(1)) {
      expect((r[0] as Date).toISOString().slice(0, 10)).toBe("2026-10-08");
      expect(r[1]).toBe("Sáng");
    }
  });

  it("calls the afternoon Chiều, and takes the date from Vietnam rather than UTC", async () => {
    const afternoon = await build(pages, new Date("2026-10-08T07:00:00Z")); // 14:00
    expect(afternoon.rows[1][1]).toBe("Chiều");
    const pastMidnight = await build(pages, new Date("2026-10-07T20:30:00Z")); // 03:30 on the 8th
    expect((pastMidnight.rows[1][0] as Date).toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(pastMidnight.rows[1][1]).toBe("Sáng");
  });

  it("adds a note column only when some order has a note", async () => {
    expect((await build()).rows[0]).toHaveLength(19);

    const hidden = withSku("TRK_H1", [["Ốc", "M6", 1, "OC"]], { declaredTotalQuantity: 5 });
    const { rows, merges } = await build([...pages, hidden]);
    expect(rows[0][19]).toBe("Ghi chú");
    expect(String(rows.find((r) => r[3] === "TRK_H1")![19])).toMatch(/ẩn bớt/);
    expect(merges.filter((m) => m.startsWith("T"))).toHaveLength(1); // the two-line order's note, merged like its STT
  });

  it("keeps an order whose products couldn't be read, with its tracking code and a note", async () => {
    const unread: WaybillPage = { pageIndex: 99, shopeeOrderId: "OX", trackingCode: "TRK_X", declaredTotalQuantity: null, items: [] };
    const { rows } = await build([...pages, unread]);
    const last = rows[rows.length - 1];
    expect([last[3], last[6] ?? null, last[7] ?? null]).toEqual(["TRK_X", null, null]);
    expect(String(last[19])).toMatch(/Không đọc được/);
  });

  it("is the packing sheet, as before, when no line has a SKU", async () => {
    const plain = [withSku("TRK_P1", [["Ghế", "Đen", 1, undefined]])];
    const { rows } = await build(plain);
    expect(rows[0]).toEqual(["Nhóm", "Số đơn", "STT", "Mã đơn hàng", "Mã vận đơn", "Sản phẩm", "Phân loại", "SL", "Ghi chú"]);
  });

  it("does not let SKUs change how orders are grouped", () => {
    const groups = groupWaybillPages([withSku("S1", [["Ghế", "Đen", 1, "A"]]), withSku("S2", [["Ghế", "Đen", 1, "B"]])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pages).toHaveLength(2);
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

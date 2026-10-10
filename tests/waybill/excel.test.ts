import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWaybillExcel, waybillExcelFileName } from "@/lib/waybill/excel";
import { groupWaybillPages, type WaybillPage } from "@/lib/waybill/items";

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  const rows: ExcelJS.CellValue[][] = [];
  sheet.eachRow((row) => rows.push((row.values as ExcelJS.CellValue[]).slice(1)));
  return { sheet, rows };
}

// Every file gets the warehouse's accounting sheet ("FILE CONVERT FULL THÔNG TIN ĐƠN
// SHOPEE"): its 19 columns in its order, whether or not the labels carry SKUs.
describe("buildWaybillExcel", () => {
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

  it("is the same sheet for labels that carry no SKU at all (SKU left empty)", async () => {
    const plain = [withSku("TRK_P1", [["Ghế", "Đen", 1, undefined]]), withSku("TRK_P2", [["Bàn", "Gỗ", 2, undefined]])];
    const { rows, sheet } = await build(plain);
    expect(rows[0]).toEqual(TEMPLATE_HEADERS);
    // singles are listed by product name: "Bàn" before "Ghế"
    expect(rows.slice(1).map((r) => [r[2], r[3], r[6] ?? null, r[7], r[8]])).toEqual([
      [1, "TRK_P2", null, 2, "Kho Sỉ"],
      [2, "TRK_P1", null, 1, "Kho Sỉ"],
    ]);
    expect(sheet.name).toBe("Sheet1");
  });

  it("sets every row 25 high and every cell's text to size 12", async () => {
    const { sheet } = await build();
    expect(sheet.rowCount).toBe(6);
    sheet.eachRow((row) => {
      expect(row.height).toBe(25);
      row.eachCell({ includeEmpty: true }, (cell) => expect(cell.font?.size).toBe(12));
    });
  });

  it("makes each column wide enough for its header on one line", async () => {
    const { sheet } = await build();
    // "SKU PHÂN LOẠI HÀNG" is 18 characters; bold size 12 needs more than 1.4 digit widths each
    expect(sheet.getColumn(7).width).toBeGreaterThanOrEqual(26);
    expect(sheet.getColumn(12).width).toBeGreaterThanOrEqual(16);
    expect(sheet.getColumn(19).width).toBeGreaterThanOrEqual(17);
  });

  it("widens the SKU column to the longest SKU so one 25-high line shows it all", async () => {
    const long = "Móc 5-hyundai kèm quai da 1 lớp";
    const { sheet } = await build([withSku("TRK_L1", [["Móc", "Đen", 1, long]])]);
    expect(sheet.getColumn(7).width).toBeGreaterThanOrEqual(long.length);
  });

  it("writes one row per product line: STT, tracking code, SKU, quantity, shop, identical orders", async () => {
    const { rows } = await build();
    // Groups: the two "Ghế xoay" first (2 identical orders), then singles by product name.
    expect(rows.slice(1).map((r) => [r[2], r[3], r[6] ?? null, r[7], r[8], r[18]])).toEqual([
      [1, "TRK_A1", "GX_DEN", 1, "Kho Sỉ", 2],
      [2, "TRK_A2", "GX_DEN", 1, "Kho Sỉ", 2],
      [3, "TRK_M1", "ONG100", 4, "Kho Sỉ", 1],
      [3, "TRK_M1", "OC_M6", 1, "Kho Sỉ", 1],
      [4, "TRK_N1", null, 2, "Kho Sỉ", 1],
    ]);
  });

  it("merges the order's own cells over its lines, so a tracking code appears once", async () => {
    const { merges, sheet } = await build();
    // The only two-line order is row 4-5 (header is row 1): STT, tracking code, group size.
    expect(merges).toEqual(["C4:C5", "D4:D5", "S4:S5"]);
    expect(sheet.getCell("D4").value).toBe("TRK_M1");
    // the products themselves stay one per line
    expect([sheet.getCell("G4").value, sheet.getCell("G5").value]).toEqual(["ONG100", "OC_M6"]);
  });

  it("leaves single-line orders unmerged", async () => {
    const { merges } = await build([withSku("TRK_O1", [["Ghế", "Đen", 1, "A"]]), withSku("TRK_O2", [["Bàn", "Gỗ", 2, "B"]])]);
    expect(merges).toEqual([]);
  });

  it("fills phân loại hàng (Q) from the label — each product line its own variant", async () => {
    const { rows } = await build();
    expect(rows.slice(1).map((r) => [r[3], r[16]])).toEqual([
      ["TRK_A1", "Đen"],
      ["TRK_A2", "Đen"],
      ["TRK_M1", "phi 100"],
      ["TRK_M1", "M6"],
      ["TRK_N1", "D100"],
    ]);
  });

  it("leaves everything the label can't say truly empty — Kiot, cost, bookkeeping, group", async () => {
    const { rows, sheet } = await build();
    // E Kiot, F Kho, J Giá Vốn, K Tổng GV, L–P bookkeeping, R Nhóm
    for (const column of [4, 5, 9, 10, 11, 12, 13, 14, 15, 17]) {
      expect(rows.slice(1).every((r) => r[column] === null || r[column] === undefined)).toBe(true);
    }
    expect(sheet.getCell("K2").value).toBeNull();
  });

  it("puts the print date and shift (Vietnam time) on every row", async () => {
    const { rows } = await build();
    for (const r of rows.slice(1)) {
      expect((r[0] as Date).toISOString().slice(0, 10)).toBe("2026-10-08");
      expect(r[1]).toBe("Sáng");
    }
  });

  it("calls the shift Sáng, Chiều or Tối by the hour, and takes the date from Vietnam rather than UTC", async () => {
    const shiftAt = async (iso: string) => (await build(pages, new Date(iso))).rows[1][1];
    expect(await shiftAt("2026-10-08T04:59:00Z")).toBe("Sáng"); // 11:59
    expect(await shiftAt("2026-10-08T05:00:00Z")).toBe("Chiều"); // 12:00
    expect(await shiftAt("2026-10-08T10:59:00Z")).toBe("Chiều"); // 17:59
    expect(await shiftAt("2026-10-08T11:00:00Z")).toBe("Tối"); // 18:00
    expect(await shiftAt("2026-10-08T16:30:00Z")).toBe("Tối"); // 23:30
    const pastMidnight = await build(pages, new Date("2026-10-07T20:30:00Z")); // 03:30 on the 8th
    expect((pastMidnight.rows[1][0] as Date).toISOString().slice(0, 10)).toBe("2026-10-08");
    expect(pastMidnight.rows[1][1]).toBe("Sáng");
  });

  it("adds a note column only when some order has a note", async () => {
    expect((await build()).rows[0]).toHaveLength(19);

    const hidden = withSku("TRK_H1", [["Ốc", "M6", 1, "OC"]], { declaredTotalQuantity: 5 });
    const { rows } = await build([...pages, hidden]);
    expect(rows[0][19]).toBe("Ghi chú");
    expect(String(rows.find((r) => r[3] === "TRK_H1")![19])).toMatch(/ẩn bớt/);
  });

  it("keeps an order whose products couldn't be read, with its tracking code and a note", async () => {
    const unread: WaybillPage = { pageIndex: 99, shopeeOrderId: "OX", trackingCode: "TRK_X", declaredTotalQuantity: null, items: [] };
    const { rows } = await build([...pages, unread]);
    const last = rows[rows.length - 1];
    expect([last[3], last[6] ?? null, last[7] ?? null]).toEqual(["TRK_X", null, null]);
    expect(String(last[19])).toMatch(/Không đọc được/);
  });

  it("freezes the header", async () => {
    const { sheet } = await build();
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("still produces a valid workbook with only a header for an empty list", async () => {
    const { rows } = await readBack(await buildWaybillExcel([]));
    expect(rows).toHaveLength(1);
  });

  it("does not let SKUs change how orders are grouped", () => {
    const groups = groupWaybillPages([withSku("S1", [["Ghế", "Đen", 1, "A"]]), withSku("S2", [["Ghế", "Đen", 1, "B"]])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].pages).toHaveLength(2);
  });
});

describe("waybillExcelFileName", () => {
  it("reads Furni_<hour>h<ddmm>_<orders> đơn_Đã gom, in Vietnam time", () => {
    // 2026-10-09T02:20:00Z is 09:20 on the 9th in Việt Nam.
    expect(waybillExcelFileName(new Date("2026-10-09T02:20:00Z"), 23)).toBe("Furni_9h0910_23 đơn_Đã gom.xlsx");
  });

  it("drops the zero of the hour only; the day and month always have two digits", () => {
    expect(waybillExcelFileName(new Date("2026-12-25T07:05:00Z"), 4)).toBe("Furni_14h2512_4 đơn_Đã gom.xlsx");
    expect(waybillExcelFileName(new Date("2026-03-05T01:05:00Z"), 4)).toBe("Furni_8h0503_4 đơn_Đã gom.xlsx");
  });

  it("rolls the date over with the VN offset, not UTC", () => {
    // 20:30 UTC on the 6th is 03:30 on the 7th in Việt Nam.
    expect(waybillExcelFileName(new Date("2026-10-06T20:30:00Z"), 1)).toBe("Furni_3h0710_1 đơn_Đã gom.xlsx");
  });
});

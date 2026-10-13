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

// The sheet the warehouse gets in the Zalo group ("Danh sách đơn", the "mẫu file excel
// Furni gửi KHO ĐÃ GOM"): Nhóm, Số đơn, STT, Mã vận đơn, Phân loại, SL, Sản phẩm, Ghi chú.
describe("buildWaybillExcel", () => {
  const HEADERS = ["Nhóm", "Số đơn", "STT", "Mã vận đơn", "Phân loại", "SL", "Sản phẩm", "Ghi chú"];

  let index = 0;
  const order = (trackingCode: string, items: [string, string, number][], extra: Partial<WaybillPage> = {}): WaybillPage => ({
    pageIndex: index++,
    shopeeOrderId: `ORDER_${trackingCode}`,
    trackingCode,
    declaredTotalQuantity: items.reduce((sum, item) => sum + item[2], 0),
    shopName: "Kho Sỉ",
    items: items.map(([name, variant, quantity]) => ({ name, variant, quantity })),
    ...extra,
  });

  const pages = [
    order("TRK_A1", [["Ghế xoay", "Đen", 1]]),
    order("TRK_M1", [["Ống", "phi 100", 4], ["Ốc vít", "M6", 1]]),
    order("TRK_A2", [["Ghế xoay", "Đen", 1]]),
    order("TRK_N1", [["Piston", "D100", 2]]),
  ];

  async function build(list: WaybillPage[] = pages) {
    const result = await readBack(await buildWaybillExcel(groupWaybillPages(list)));
    return { ...result, merges: ((result.sheet.model as { merges?: string[] }).merges ?? []).slice() };
  }

  const argb = (fill: ExcelJS.Fill | undefined) => (fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;
  const fontOf = (sheet: ExcelJS.Worksheet, address: string) => sheet.getCell(address).font;

  it("is one sheet, Danh sách đơn, with the warehouse's eight columns in its order", async () => {
    const { rows, sheet } = await build();
    expect(sheet.name).toBe("Danh sách đơn");
    expect(rows[0]).toEqual(HEADERS);
    expect(sheet.columnCount).toBe(8);
  });

  it("writes one row per product line: group, orders in group, STT, tracking code, variation, quantity, product", async () => {
    const { rows } = await build();
    // Groups: the two "Ghế xoay" first (2 identical orders), then the singles by product name.
    expect(rows.slice(1)).toEqual([
      [1, 2, 1, "TRK_A1", "Đen", 1, "Ghế xoay", ""],
      [1, 2, 2, "TRK_A2", "Đen", 1, "Ghế xoay", ""],
      [2, 1, 3, "TRK_M1", "phi 100", 4, "Ống", ""],
      [2, 1, 3, "TRK_M1", "M6", 1, "Ốc vít", ""],
      [3, 1, 4, "TRK_N1", "D100", 2, "Piston", ""],
    ]);
  });

  it("repeats the order's cells on each of its lines instead of merging them", async () => {
    const { merges, rows } = await build();
    expect(merges).toEqual([]);
    expect(rows[3].slice(0, 4)).toEqual(rows[4].slice(0, 4));
  });

  it("has no SKU, Kiot or cost columns", async () => {
    const { rows } = await build();
    expect(rows[0].some((header) => /sku|kiot|giá|gian/i.test(String(header)))).toBe(false);
  });

  it("writes the note once, on the first line of its order", async () => {
    const hidden = order("TRK_H1", [["Ốc", "M6", 1], ["Đai", "to", 1]], { declaredTotalQuantity: 5 });
    const { rows } = await build([...pages, hidden]);
    const lines = rows.filter((r) => r[3] === "TRK_H1");
    expect(lines).toHaveLength(2);
    expect(String(lines[0][7])).toMatch(/ẩn bớt/);
    expect(lines[1][7]).toBe("");
  });

  it("keeps an order whose products couldn't be read, with its tracking code, an empty SL and a note", async () => {
    const unread: WaybillPage = { pageIndex: 99, shopeeOrderId: "OX", trackingCode: "TRK_X", declaredTotalQuantity: null, items: [] };
    const { rows } = await build([...pages, unread]);
    const last = rows[rows.length - 1];
    expect(last.slice(2, 4)).toEqual([5, "TRK_X"]);
    expect([last[4], last[5] ?? null, last[6]]).toEqual(["", null, ""]);
    expect(String(last[7])).toMatch(/Không đọc được/);
  });

  it("shows an order without a tracking code with an empty cell, not 'null'", async () => {
    const { rows } = await build([{ ...order("X", [["Ghế", "Đen", 1]]), trackingCode: null }]);
    expect(rows[1][3]).toBe("");
  });

  it("styles the header: bold white on dark, centred, size 12, 25 high", async () => {
    const { sheet } = await build();
    const cell = sheet.getCell("A1");
    expect(argb(cell.fill)).toBe("FF1F2937");
    expect(cell.font).toMatchObject({ bold: true, size: 12, color: { argb: "FFFFFFFF" } });
    expect(cell.alignment).toMatchObject({ horizontal: "center", vertical: "middle" });
    expect(sheet.getRow(1).height).toBe(25);
  });

  it("sets every cell's text to size 12 and every one-line row 25 high", async () => {
    const { sheet } = await build();
    sheet.eachRow((row) => {
      expect(row.height).toBe(25);
      row.eachCell({ includeEmpty: true }, (cell) => expect(cell.font?.size).toBe(12));
    });
  });

  it("makes the quantity bold, and the order count bold orange only for a batch of several orders", async () => {
    const { sheet } = await build();
    expect(fontOf(sheet, "F2")?.bold).toBe(true);
    // rows 2-3 are the group of two identical orders; row 4 a single
    expect(fontOf(sheet, "B2")).toMatchObject({ bold: true, color: { argb: "FFB45309" } });
    expect(fontOf(sheet, "B4")?.bold).toBeFalsy();
  });

  it("aligns like the sample: numbers centred, text left and wrapped, all at the top", async () => {
    const { sheet } = await build();
    for (const address of ["A2", "B2", "C2", "F2"]) expect(sheet.getCell(address).alignment).toMatchObject({ horizontal: "center", vertical: "top" });
    for (const address of ["D2", "E2", "G2", "H2"]) {
      expect(sheet.getCell(address).alignment).toMatchObject({ horizontal: "left", vertical: "top", wrapText: true });
    }
  });

  it("bands each group in its own colour and puts a heavier rule above each group", async () => {
    const { sheet } = await build();
    // groups: rows 2-3, rows 4-5, row 6
    expect(["A2", "A3", "A4", "A5", "A6"].map((a) => argb(sheet.getCell(a).fill))).toEqual([
      "FFFFFFFF",
      "FFFFFFFF",
      "FFD6E4FA",
      "FFD6E4FA",
      "FFFFFFFF",
    ]);
    expect(sheet.getCell("A2").border.top?.style).toBe("medium");
    expect(sheet.getCell("A3").border.top?.style).toBe("thin");
    expect(sheet.getCell("A4").border.top?.style).toBe("medium");
    expect(sheet.getCell("A6").border.top?.style).toBe("medium");
    expect(sheet.getCell("D2").border.left?.style).toBe("thin");
  });

  it("uses the sample's column widths", async () => {
    const { sheet } = await build();
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((column) => sheet.getColumn(column).width)).toEqual([7, 8, 7, 25.2, 25.3, 9.2, 65.2, 27.2]);
  });

  it("widens the product column for a long name, up to a limit, and lets a longer one wrap", async () => {
    const long = "Piston ghế xoay văn phòng D100 D120 D160 INOX không gỉ chất lượng cao";
    const { sheet } = await build([order("TRK_L1", [[long, "D100", 1]])]);
    const width = sheet.getColumn(7).width!;
    expect(width).toBeGreaterThan(65.2);
    expect(width).toBeLessThanOrEqual(70);
    expect(sheet.getRow(2).height).toBe(25);

    const longer = `${long} ${long} ${long}`;
    const wrapped = await build([order("TRK_L2", [[longer, "D100", 1]])]);
    expect(wrapped.sheet.getColumn(7).width).toBe(70);
    // the text wraps in its cell, and the row is as high as its lines need
    expect(wrapped.sheet.getRow(2).height).toBeGreaterThan(25);
    expect(wrapped.sheet.getCell("G2").alignment?.wrapText).toBe(true);
  });

  it("keeps a name that fits the sample's width on one 25-high line", async () => {
    const sample = "Phụ Kiện GHẾ VĂN PHÒNG FREESHIP ghế xoay, bánh xe , chân ghế inox";
    const { sheet, rows } = await build([order("SPXVN06779130045A", [[sample, "5 bánh xe", 1]])]);
    expect(rows[1]).toEqual([1, 1, 1, "SPXVN06779130045A", "5 bánh xe", 1, sample, ""]);
    expect(sheet.getRow(2).height).toBe(25);
  });

  it("freezes the header, filters on it and prints it on every page", async () => {
    const { sheet } = await build();
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(JSON.stringify(sheet.autoFilter)).toMatch(/A1.*H1/);
    expect(sheet.pageSetup).toMatchObject({ orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 });
  });

  it("still produces a valid workbook with only a header for an empty list", async () => {
    const { rows } = await readBack(await buildWaybillExcel([]));
    expect(rows).toEqual([HEADERS]);
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

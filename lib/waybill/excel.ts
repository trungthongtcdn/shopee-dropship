import ExcelJS from "exceljs";
import type { WaybillGroup } from "./items";

// SheetJS (already used for the report export) can't style cells in its
// community build, and visible group banding is the whole point of this sheet.

const HEADERS = ["Nhóm", "Số đơn", "STT", "Mã đơn hàng", "Mã vận đơn", "Sản phẩm", "Phân loại", "SL", "Ghi chú"] as const;
const COLUMN_WIDTHS = [7, 8, 7, 18, 22, 60, 24, 6, 34];

const HEADER_FILL = "FF1F2937";
const BAND_FILLS = ["FFFFFFFF", "FFD6E4FA"];
const BORDER_COLOR = "FFD1D5DB";
const GROUP_DIVIDER_COLOR = "FF6B7280";

const thin = (color: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb: color } });

// A file whose labels carry the seller's SKUs (see orderInfo.ts) gets the sheet the
// warehouse's accounting file is filled from (buildSkuSheet below); every other file
// keeps the packing sheet.
function hasSkus(groups: WaybillGroup[]): boolean {
  return groups.some((group) => group.pages.some((page) => page.items.some((item) => item.sku)));
}

// `at` is when the file was made; only the SKU sheet shows it (print date and shift).
export async function buildWaybillExcel(groups: WaybillGroup[], at: Date = new Date()): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  if (hasSkus(groups)) buildSkuSheet(workbook, groups, at);
  else buildPackingSheet(workbook, groups);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// One row per product line (a multi-item order repeats its order/tracking code
// on each line so filtering and sorting by order still work). Rows of the same
// group share a band colour and each new group starts under a darker rule, so
// the clusters read at a glance from across a packing table.
function buildPackingSheet(workbook: ExcelJS.Workbook, groups: WaybillGroup[]): void {
  const sheet = workbook.addWorksheet("Danh sách đơn", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" },
  });
  sheet.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const header = sheet.addRow([...HEADERS]);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 22;

  let orderNumber = 0;
  groups.forEach((group, groupIndex) => {
    const fill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILLS[groupIndex % 2] } };
    let firstRowOfGroup = true;

    for (const page of group.pages) {
      orderNumber += 1;
      const lines = page.items.length > 0 ? page.items : [null];

      lines.forEach((item, lineIndex) => {
        const row = sheet.addRow([
          groupIndex + 1,
          group.pages.length,
          orderNumber,
          page.shopeeOrderId,
          page.trackingCode ?? "",
          item?.name ?? "",
          item?.variant ?? "",
          item?.quantity ?? "",
          lineIndex === 0 ? page.note ?? "" : "",
        ]);

        row.fill = fill;
        row.alignment = { vertical: "top", wrapText: true };
        for (const column of [1, 2, 3, 8]) row.getCell(column).alignment = { vertical: "top", horizontal: "center" };

        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = {
            top: firstRowOfGroup ? { style: "medium", color: { argb: GROUP_DIVIDER_COLOR } } : thin(BORDER_COLOR),
            bottom: thin(BORDER_COLOR),
            left: thin(BORDER_COLOR),
            right: thin(BORDER_COLOR),
          };
        });
        // Quantity is bold: it is the number the packer actually counts. So is
        // the order count of a group with more than one order — that's the batch.
        row.getCell(8).font = { bold: true };
        if (group.pages.length > 1) row.getCell(2).font = { bold: true, color: { argb: "FFB45309" } };
        firstRowOfGroup = false;
      });
    }
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
}

// The columns of the accounting file ("FILE CONVERT FULL THÔNG TIN ĐƠN SHOPEE"), in its
// order. What the labels can't tell (Kiot code and warehouse, cost, the cancelled /
// duplicate / payout bookkeeping) is left empty for whoever maps it afterwards.
const SKU_HEADERS = [
  "NGÀY IN",
  "BUỔI",
  "STT",
  "MÃ VẬN ĐƠN",
  "Mã Kiot",
  "Kho Kiot",
  "SKU PHÂN LOẠI HÀNG",
  "SỐ LƯỢNG",
  "GIAN",
  "Giá Vốn",
  "Tổng GV",
  "HỦY SAU IN",
  "TRÙNG",
  "Tiền xuất",
  "SL SP",
  "tổng Số Đơn",
  "phân loại hàng",
  "Nhóm",
  "số đơn giống",
] as const;
const NOTE_HEADER = "Ghi chú";
const SKU_WIDTHS = [13.8, 10.8, 8, 24, 14, 12, 24, 10.8, 20, 12, 12, 12, 10.8, 12, 10.8, 13.3, 20, 10.8, 12.8];
const NOTE_WIDTH = 36;

// The warehouse's format for this file: text in size 12, every row 25 high. A row that
// high holds one line, so each column is made wide enough for its header and for the
// longest text in it (up to a limit) — otherwise the text would be cut off.
const FONT_SIZE = 12;
const ROW_HEIGHT = 25;
const MAX_TEXT_WIDTH = 60;
// Column width is counted in digits of the default font; these are how many one character
// of the header (bold Arial, capitals wider) and of the body (Calibri) take, plus padding.
const HEADER_CHAR_WIDTH = { capital: 1.65, other: 1.4, space: 0.7 };
const BODY_CHAR_WIDTH = 1.2;
const COLUMN_PADDING = 2;

function headerWidth(text: string): number {
  let width = COLUMN_PADDING;
  for (const char of text) {
    width += char === " " ? HEADER_CHAR_WIDTH.space : char === char.toUpperCase() ? HEADER_CHAR_WIDTH.capital : HEADER_CHAR_WIDTH.other;
  }
  return Math.ceil(width);
}

function textWidth(texts: (string | null | undefined)[]): number {
  const longest = Math.max(0, ...texts.map((text) => text?.length ?? 0));
  return Math.min(MAX_TEXT_WIDTH, Math.ceil(longest * BODY_CHAR_WIDTH + COLUMN_PADDING));
}

// 1-based column numbers.
const COL = {
  date: 1,
  shift: 2,
  number: 3,
  tracking: 4,
  kiotCode: 5,
  kiotStore: 6,
  sku: 7,
  quantity: 8,
  shop: 9,
  cost: 10,
  costTotal: 11,
  variant: 17,
  group: 18,
  groupSize: 19,
  note: 20,
} as const;
// Order-level cells: one value for the whole order, merged over its product lines.
const ORDER_COLUMNS: number[] = [COL.number, COL.tracking, COL.group, COL.groupSize, COL.note];
// Text the eye reads left to right; the rest is centred.
const LEFT_COLUMNS = new Set<number>([COL.tracking, COL.kiotCode, COL.kiotStore, COL.sku, COL.shop, COL.variant, COL.note]);

// The date and shift (sáng before noon, chiều after) in Vietnam, where the warehouse is.
function printStamp(at: Date): { date: Date; shift: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // A calendar date has no time zone: Excel shows the UTC fields of the value as they are.
  return { date: new Date(Date.UTC(part("year"), part("month") - 1, part("day"))), shift: part("hour") < 12 ? "Sáng" : "Chiều" };
}

// One row per product line, each SKU on a line of its own; the cells that belong to the
// whole order (STT, tracking code, group, note) are merged over its lines. Orders keep
// the order of the groups, so identical orders still stand next to each other.
function buildSkuSheet(workbook: ExcelJS.Workbook, groups: WaybillGroup[], at: Date): void {
  const withNotes = groups.some((group) => group.pages.some((page) => page.note));
  const columnCount = SKU_HEADERS.length + (withNotes ? 1 : 0);
  const sheet = workbook.addWorksheet("Sheet1", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [...SKU_HEADERS, ...(withNotes ? [NOTE_HEADER] : [])];
  const pages = groups.flatMap((group) => group.pages);
  const items = pages.flatMap((page) => page.items);
  // Free-text columns grow to their longest text; the rest only to fit their header.
  const wanted = new Map<number, number>([
    [COL.tracking, textWidth(pages.map((page) => page.trackingCode))],
    [COL.sku, textWidth(items.map((item) => item.sku))],
    [COL.shop, textWidth(pages.map((page) => page.shopName))],
    [COL.variant, textWidth(items.map((item) => item.variant))],
  ]);
  sheet.columns = headers.map((text, i) => ({
    width: Math.max([...SKU_WIDTHS, NOTE_WIDTH][i], headerWidth(text), wanted.get(i + 1) ?? 0),
  }));

  const border = { top: thin("FF000000"), bottom: thin("FF000000"), left: thin("FF000000"), right: thin("FF000000") };
  const header = sheet.addRow(headers);
  header.height = ROW_HEIGHT;
  header.eachCell((cell) => {
    cell.font = { name: "Arial", size: FONT_SIZE, bold: true, color: { argb: "FF151515" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = border;
  });

  const { date, shift } = printStamp(at);
  let orderNumber = 0;
  groups.forEach((group, groupIndex) => {
    for (const page of group.pages) {
      orderNumber += 1;
      const lines = page.items.length > 0 ? page.items : [null];
      const firstRow = sheet.rowCount + 1;

      lines.forEach((item, lineIndex) => {
        // Cells with nothing to say stay truly empty (not ""), so ISBLANK and "fill the blanks"
        // work for whoever maps the Kiot columns afterwards.
        const cells: ExcelJS.CellValue[] = new Array(columnCount).fill(null);
        cells[COL.date - 1] = date;
        cells[COL.shift - 1] = shift;
        cells[COL.number - 1] = orderNumber;
        cells[COL.tracking - 1] = page.trackingCode || null;
        cells[COL.sku - 1] = item?.sku || null;
        cells[COL.quantity - 1] = item?.quantity ?? null;
        cells[COL.shop - 1] = page.shopName || null;
        cells[COL.variant - 1] = item?.variant || null;
        cells[COL.group - 1] = groupIndex + 1;
        cells[COL.groupSize - 1] = group.pages.length;
        if (withNotes) cells[COL.note - 1] = (lineIndex === 0 && page.note) || null;
        const row = sheet.addRow(cells);

        // Cost total = cost × quantity, once somebody has filled the cost in.
        const n = row.number;
        row.getCell(COL.costTotal).value = { formula: `IF(OR(J${n}="",H${n}=""),"",J${n}*H${n})`, result: "" };

        row.height = ROW_HEIGHT;
        for (let column = 1; column <= columnCount; column++) {
          const cell = row.getCell(column);
          cell.font = { name: "Calibri", size: FONT_SIZE };
          cell.alignment = { vertical: "middle", horizontal: LEFT_COLUMNS.has(column) ? "left" : "center", wrapText: true };
          cell.border = border;
        }
        row.getCell(COL.date).numFmt = "d/m/yyyy";
        row.getCell(COL.cost).numFmt = "#,##0";
        row.getCell(COL.costTotal).numFmt = "#,##0";
      });

      const lastRow = firstRow + lines.length - 1;
      if (lastRow > firstRow) {
        for (const column of ORDER_COLUMNS) {
          if (column <= columnCount) sheet.mergeCells(firstRow, column, lastRow, column);
        }
      }
    }
  });
}

// What the warehouse's file names look like: Furni_<hour>h<day><month>_<orders> đơn_Đã gom,
// e.g. Furni_9h0910_23 đơn_Đã gom — the hour the file was made (no leading zero) and its
// date as ddmm, both in Vietnam time rather than the server's UTC, and how many orders it
// holds. The Excel and the re-ordered PDF share it (only the extension differs) so the
// pair is obvious.
const FILE_PREFIX = "Furni";

export function waybillFileStem(at: Date, orderCount: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  return `${FILE_PREFIX}_${part("hour")}h${twoDigits(part("day"))}${twoDigits(part("month"))}_${orderCount} đơn_Đã gom`;
}

export function waybillExcelFileName(at: Date, orderCount: number): string {
  return `${waybillFileStem(at, orderCount)}.xlsx`;
}

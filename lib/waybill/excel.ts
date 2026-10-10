import ExcelJS from "exceljs";
import type { WaybillGroup } from "./items";

// The sheet is the warehouse's accounting file ("FILE CONVERT FULL THÔNG TIN ĐƠN SHOPEE"):
// its 19 columns in its order, whatever kind of label the PDF had. What a label can't tell
// (Kiot code and warehouse, cost, the cancelled / duplicate / payout bookkeeping, the group
// the warehouse works out afterwards) is left truly empty — not "" — so ISBLANK and "fill
// the blanks" work for whoever maps it later.
const HEADERS = [
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
// Only added to a file that has an order the sheet can't speak for (unreadable, or a label
// that hides some of its products): the one place a packer is told to look at the label.
const NOTE_HEADER = "Ghi chú";
const WIDTHS = [13.8, 10.8, 8, 24, 14, 12, 24, 10.8, 20, 12, 12, 12, 10.8, 12, 10.8, 13.3, 20, 10.8, 12.8];
const NOTE_WIDTH = 36;

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
  groupSize: 19,
  note: 20,
} as const;
// Order-level cells: one value for the whole order, merged over its product lines so each
// tracking code appears once however many products the order has.
const ORDER_COLUMNS: number[] = [COL.number, COL.tracking, COL.groupSize, COL.note];
// Text the eye reads left to right; the rest is centred.
const LEFT_COLUMNS = new Set<number>([COL.tracking, COL.kiotCode, COL.kiotStore, COL.sku, COL.shop, COL.variant, COL.note]);

// The warehouse's format: text in size 12, every row 25 high. A row that high holds one
// line, so each column is made wide enough for its header and for the longest text in it
// (up to a limit) — otherwise the text would be cut off.
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
  const longest = texts.reduce((max, text) => Math.max(max, text?.length ?? 0), 0);
  return Math.min(MAX_TEXT_WIDTH, Math.ceil(longest * BODY_CHAR_WIDTH + COLUMN_PADDING));
}

const thin = (color: string): Partial<ExcelJS.Border> => ({ style: "thin", color: { argb: color } });

// The date and shift (sáng before noon, chiều until 18:00, tối after) in Vietnam, where
// the warehouse is.
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
  const hour = part("hour");
  // A calendar date has no time zone: Excel shows the UTC fields of the value as they are.
  return {
    date: new Date(Date.UTC(part("year"), part("month") - 1, part("day"))),
    shift: hour < 12 ? "Sáng" : hour < 18 ? "Chiều" : "Tối",
  };
}

// One row per product line, each SKU on a line of its own; the cells that belong to the
// whole order (STT, tracking code, count of identical orders, note) are merged over its
// lines. Orders keep the order of the groups, so identical orders still stand next to
// each other. `at` is when the file was made (print date and shift).
export async function buildWaybillExcel(groups: WaybillGroup[], at: Date = new Date()): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const withNotes = groups.some((group) => group.pages.some((page) => page.note));
  const columnCount = HEADERS.length + (withNotes ? 1 : 0);
  const sheet = workbook.addWorksheet("Sheet1", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [...HEADERS, ...(withNotes ? [NOTE_HEADER] : [])];
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
    width: Math.max([...WIDTHS, NOTE_WIDTH][i], headerWidth(text), wanted.get(i + 1) ?? 0),
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
  for (const group of groups) {
    for (const page of group.pages) {
      orderNumber += 1;
      const lines = page.items.length > 0 ? page.items : [null];
      const firstRow = sheet.rowCount + 1;

      lines.forEach((item, lineIndex) => {
        const cells: ExcelJS.CellValue[] = new Array(columnCount).fill(null);
        cells[COL.date - 1] = date;
        cells[COL.shift - 1] = shift;
        cells[COL.number - 1] = orderNumber;
        cells[COL.tracking - 1] = page.trackingCode || null;
        cells[COL.sku - 1] = item?.sku || null;
        cells[COL.quantity - 1] = item?.quantity ?? null;
        cells[COL.shop - 1] = page.shopName || null;
        cells[COL.variant - 1] = item?.variant || null;
        cells[COL.groupSize - 1] = group.pages.length;
        if (withNotes) cells[COL.note - 1] = (lineIndex === 0 && page.note) || null;
        const row = sheet.addRow(cells);

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

      // Merge after the lines are styled: a merged cell takes the style of its top-left one.
      const lastRow = firstRow + lines.length - 1;
      if (lastRow > firstRow) {
        for (const column of ORDER_COLUMNS) {
          if (column <= columnCount) sheet.mergeCells(firstRow, column, lastRow, column);
        }
      }
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
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

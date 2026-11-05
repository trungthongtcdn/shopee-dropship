import ExcelJS from "exceljs";
import type { WaybillGroup, WaybillItem } from "./items";

// The sheet the warehouse gets in the Zalo group ("Danh sách đơn" — the "mẫu file excel
// Furni gửi KHO ĐÃ GOM"): one row per product line, the orders in the order of the
// groups so identical orders stand next to each other, and each group banded in its own
// colour with a rule above it so the batches read at a glance from across a packing table.
//
//   Nhóm | Số đơn | Kho gửi | STT | Mã vận đơn | Phân loại | SL | Sản phẩm | Mã Kiot | Kho Kiot | Ghi chú
//
// Nhóm is the group's number, Số đơn how many identical orders it holds (bold orange when
// more than one — that is the batch), Kho gửi the warehouse the order is sent from (left empty,
// and shaded, while nobody has chosen it — see khoGiao.ts), STT the order's number in the file,
// which is also the position of its label in the re-ordered PDF. Mã Kiot and Kho Kiot come from
// the price sheet (kiotMap.ts). An order with several products repeats its group / kho / STT /
// tracking code on each line, so filtering and sorting by any of them still work; the note is
// written once, on the order's first line.
const HEADERS = ["Nhóm", "Số đơn", "Kho gửi", "STT", "Mã vận đơn", "Phân loại", "SL", "Sản phẩm", "Mã Kiot", "Kho Kiot", "Ghi chú"] as const;

// 1-based column numbers.
const COL = { group: 1, groupSize: 2, kho: 3, number: 4, tracking: 5, variant: 6, quantity: 7, name: 8, kiotCode: 9, kiotStore: 10, note: 11 } as const;
// Text the eye reads left to right, wrapped in its cell; the rest is centred.
const TEXT_COLUMNS = new Set<number>([COL.tracking, COL.variant, COL.name, COL.kiotCode, COL.note]);

// The warehouse's widths. A text column grows to its longest text, up to a limit; what
// is longer wraps and the row grows with it, so nothing is cut off.
const BASE_WIDTHS = [7, 8, 11, 7, 25.2, 25.3, 9.2, 65.2, 22, 11, 27.2];
const MAX_WIDTHS = new Map<number, number>([
  [COL.tracking, 30],
  [COL.variant, 40],
  [COL.name, 70],
  [COL.kiotCode, 36],
  [COL.note, 45],
]);

// The warehouse's format: text in size 12, every row 25 high (a row with wrapped text is
// as high as its lines need).
const FONT_SIZE = 12;
const ROW_HEIGHT = 25;
const LINE_HEIGHT = 16;
const ROW_PADDING = 6;

const HEADER_FILL = "FF1F2937";
const BAND_FILLS = ["FFFFFFFF", "FFD6E4FA"];
const BATCH_COLOR = "FFB45309";
const ALERT_COLOR = "FFC00000";
const ALERT_FILL = "FFFFE5E5";
const BLACK = "FF000000";

// Estimating the width of text in Calibri 12: em widths of the character classes (a
// column unit is the width of a digit of the default font, 7 px; size 12 is 16 px an em).
// Slightly generous, so a text that is estimated to fit does fit.
const NARROW = new Set([..."iljtfrI.,;:'!|()[]/-"]);
const PX_PER_EM = 16;
const PX_PER_UNIT = 7;
const CELL_PADDING_PX = 6;
const SPACE_EM = 0.226;

function emWidth(char: string): number {
  if (char === " ") return SPACE_EM;
  if (/\p{M}/u.test(char)) return 0;
  if (/\d/.test(char)) return 0.507;
  if (NARROW.has(char)) return 0.28;
  return char !== char.toLowerCase() ? 0.56 : 0.45;
}

const textEm = (text: string) => [...text.normalize("NFC")].reduce((sum, char) => sum + emWidth(char), 0);

// Column units that show `text` on one line.
const unitsFor = (text: string) => Math.ceil((textEm(text) * PX_PER_EM + CELL_PADDING_PX) / PX_PER_UNIT);

// Lines `text` takes in a column `units` wide, breaking at spaces (a word longer than the
// column is broken wherever it falls).
function wrappedLines(text: string, units: number): number {
  const room = (units * PX_PER_UNIT - CELL_PADDING_PX) / PX_PER_EM;
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const em = textEm(word);
    if (used > 0 && used + SPACE_EM + em <= room) {
      used += SPACE_EM + em;
      continue;
    }
    if (used > 0) lines += 1;
    lines += Math.max(0, Math.ceil(em / room) - 1);
    used = em % room || Math.min(em, room);
  }
  return lines;
}

const thin = { style: "thin", color: { argb: BLACK } } as const;
const batchRule = { style: "medium", color: { argb: BLACK } } as const;

// `groups` as groupWaybillPages() makes them; the rows follow their order, which is the
// order of the re-ordered PDF's pages. `alert` — set when fewer orders were read than the
// PDF has labels — is written in red across the first row, above the header, so nobody
// packs from the sheet without seeing it; without one the sheet is exactly the template.
// The Kiot code(s) of an order line, one per Kiot product it stands for — "×n" where the number
// of Kiot units isn't the line's own SL (a combined SKU, or several products in one line) — and
// the Kiot store(s) they are kept in. Blank when the price sheet knows nothing of the SKU.
export function kiotCellsOf(item: WaybillItem | null): { codes: string; stores: string } {
  const lines = (item?.kiotLines ?? []).filter((line) => line.kiotCode);
  const codes = lines.map((line) => (lines.length > 1 || line.quantity !== item?.quantity ? `${line.kiotCode} ×${line.quantity}` : line.kiotCode));
  const stores = [...new Set(lines.map((line) => line.kiotStore).filter((store): store is string => Boolean(store)))];
  return { codes: codes.join("\n"), stores: stores.join(", ") };
}

export async function buildWaybillExcel(groups: WaybillGroup[], alert: string | null = null): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const headerRow = alert ? 2 : 1;
  const sheet = workbook.addWorksheet("Danh sách đơn", {
    views: [{ state: "frozen", ySplit: headerRow }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${headerRow}:${headerRow}`,
    },
  });

  const pages = groups.flatMap((group) => group.pages);
  const items = pages.flatMap((page) => page.items);
  const longest = (column: number, texts: (string | null | undefined)[]) =>
    Math.min(MAX_WIDTHS.get(column) ?? Infinity, Math.max(BASE_WIDTHS[column - 1], ...texts.map((text) => (text ? unitsFor(text) : 0))));
  const widths = [...BASE_WIDTHS];
  widths[COL.tracking - 1] = longest(COL.tracking, pages.map((page) => page.trackingCode));
  widths[COL.variant - 1] = longest(COL.variant, items.map((item) => item.variant));
  widths[COL.name - 1] = longest(COL.name, items.map((item) => item.name));
  widths[COL.kiotCode - 1] = longest(COL.kiotCode, items.flatMap((item) => kiotCellsOf(item).codes.split("\n")));
  widths[COL.note - 1] = longest(COL.note, pages.map((page) => page.note));
  sheet.columns = widths.map((width) => ({ width }));

  if (alert) {
    const row = sheet.addRow([alert]);
    sheet.mergeCells(1, 1, 1, HEADERS.length);
    row.height = ROW_HEIGHT;
    const cell = row.getCell(1);
    cell.font = { name: "Calibri", size: FONT_SIZE, bold: true, color: { argb: ALERT_COLOR } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALERT_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  }

  const header = sheet.addRow([...HEADERS]);
  header.height = ROW_HEIGHT;
  header.eachCell((cell) => {
    cell.font = { name: "Calibri", size: FONT_SIZE, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { top: thin, bottom: thin, left: thin, right: thin };
  });

  let orderNumber = 0;
  groups.forEach((group, groupIndex) => {
    const fill: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND_FILLS[groupIndex % BAND_FILLS.length] } };
    let firstRowOfGroup = true;

    for (const page of group.pages) {
      orderNumber += 1;
      // An order whose products couldn't be read still gets its row, with its note.
      const lines = page.items.length > 0 ? page.items : [null];

      lines.forEach((item, lineIndex) => {
        const kiot = kiotCellsOf(item);
        const cells: ExcelJS.CellValue[] = [
          groupIndex + 1,
          group.pages.length,
          page.khoGiao ?? "",
          orderNumber,
          page.trackingCode ?? "",
          item?.variant ?? "",
          item?.quantity ?? null,
          item?.name ?? "",
          kiot.codes,
          kiot.stores,
          lineIndex === 0 ? (page.note ?? "") : "",
        ];
        const row = sheet.addRow(cells);

        const wrapped = [COL.tracking, COL.variant, COL.name, COL.kiotCode, COL.note].map((column) => {
          const text = cells[column - 1];
          return typeof text === "string" ? wrappedLines(text, widths[column - 1]) : 1;
        });
        const height = Math.max(...wrapped);
        row.height = height > 1 ? height * LINE_HEIGHT + ROW_PADDING : ROW_HEIGHT;

        for (let column = 1; column <= HEADERS.length; column++) {
          const cell = row.getCell(column);
          cell.font = { name: "Calibri", size: FONT_SIZE };
          cell.fill = fill;
          cell.alignment = TEXT_COLUMNS.has(column)
            ? { vertical: "top", horizontal: "left", wrapText: true }
            : { vertical: "top", horizontal: "center" };
          cell.border = { top: firstRowOfGroup ? batchRule : thin, bottom: thin, left: thin, right: thin };
        }
        // An order nobody has chosen a kho for: its cell is shaded so it isn't passed over.
        if (!page.khoGiao) row.getCell(COL.kho).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALERT_FILL } };
        // Quantity is bold: it is the number the packer counts. So is the order count of a
        // group with more than one order — that's the batch.
        row.getCell(COL.quantity).font = { name: "Calibri", size: FONT_SIZE, bold: true };
        row.getCell(COL.groupSize).font =
          group.pages.length > 1
            ? { name: "Calibri", size: FONT_SIZE, bold: true, color: { argb: BATCH_COLOR } }
            : { name: "Calibri", size: FONT_SIZE };
        firstRowOfGroup = false;
      });
    }
  });

  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: HEADERS.length } };
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

// A kho as it can appear in a file name: letters, digits, `_`, `.` and `-`; spaces become `_`.
// "" (the orders that have no kho gửi yet) reads "chua-co-kho".
export function safeKhoName(kho: string): string {
  const text = kho.replace(/[^\p{L}\p{N}_.\- ]+/gu, "").trim().replace(/\s+/g, "_");
  return text === "" ? "chua-co-kho" : text;
}

// One kho's file: the overall file's name with the kho after it, the order count being that kho's.
export function waybillKhoFileName(at: Date, orderCount: number, kho: string, extension: "xlsx" | "pdf"): string {
  return `${waybillFileStem(at, orderCount)}_${safeKhoName(kho)}.${extension}`;
}

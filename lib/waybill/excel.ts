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

// One row per product line (a multi-item order repeats its order/tracking code
// on each line so filtering and sorting by order still work). Rows of the same
// group share a band colour and each new group starts under a darker rule, so
// the clusters read at a glance from across a packing table.
export async function buildWaybillExcel(groups: WaybillGroup[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
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
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Vietnam local time (not the server's UTC) — this name is what the warehouse
// sees on the file in the Zalo group and in their downloads.
export function waybillExcelFileName(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `danh-sach-don-gom-nhom-${part("year")}${part("month")}${part("day")}-${part("hour")}${part("minute")}.xlsx`;
}

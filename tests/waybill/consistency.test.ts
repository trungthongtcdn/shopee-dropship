import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildWaybillExcel } from "@/lib/waybill/excel";
import { groupWaybillPages, orderedPageIndexes, type WaybillPage } from "@/lib/waybill/items";
import { reorderPdfPages } from "@/lib/waybill/pdf";
import { makePdf, pageWidths } from "./pdfFixture";

function page(pageIndex: number, orderId: string, name: string, variant = "V", quantity = 1): WaybillPage {
  return {
    pageIndex,
    shopeeOrderId: orderId,
    trackingCode: `TRK_${orderId}`,
    declaredTotalQuantity: quantity,
    items: [{ name, variant, quantity }],
  };
}

// The whole point of the feature: whoever packs from the PDF and whoever packs
// from the Excel must see the orders in the same sequence.
describe("re-ordered PDF vs Excel", () => {
  it("lists the orders in the same sequence", async () => {
    // Source PDF page i is (101 + i) wide; page 6 is a cover the parser didn't read as an order.
    const source = await makePdf(7);
    const pages = [
      page(0, "O0", "Piston", "D100"),
      page(1, "O1", "Ghế", "Đen"),
      page(2, "O2", "Ví", "Đỏ"),
      page(3, "O3", "Ghế", "Đen"),
      page(4, "O4", "Piston", "D100"),
      page(5, "O5", "Ghế", "Đen"),
    ];
    const groups = groupWaybillPages(pages);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await buildWaybillExcel(groups)) as unknown as ExcelJS.Buffer);
    const excelOrders: string[] = [];
    workbook.worksheets[0].eachRow((row, index) => {
      if (index > 1) excelOrders.push(String(row.getCell(4).value).replace(/^TRK_/, ""));
    });

    const pdfWidths = await pageWidths(await reorderPdfPages(source, orderedPageIndexes(groups)));
    const orderByWidth = new Map(pages.map((p) => [101 + p.pageIndex, p.shopeeOrderId]));
    const pdfOrders = pdfWidths.map((width) => orderByWidth.get(width));

    // The three identical "Ghế" orders lead, then the two "Piston", then "Ví"...
    expect(excelOrders).toEqual(["O1", "O3", "O5", "O0", "O4", "O2"]);
    // ...and the PDF has the very same sequence, with the unread cover page last.
    expect(pdfOrders).toEqual([...excelOrders, undefined]);
  });
});

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { makePdf, pageWidths } from "./pdfFixture";
import { makeTiledPdf, renderedCellIds } from "./tiledFixture";
import { idsOf, makeLabelPages, renderedInk } from "./composeFixture";
import { outputSheet } from "@/lib/waybill/compose";

const sendFile = vi.fn(async () => {});
vi.mock("@/lib/zalo/bridge", () => ({ sendFile: (...args: unknown[]) => (sendFile as (...a: unknown[]) => Promise<void>)(...args) }));

import {
  storeWaybillFiles,
  sendWaybillExcel,
  sendSortedWaybillPdf,
  WAYBILL_EXCEL_MESSAGE,
  WAYBILL_SORTED_PDF_MESSAGE,
} from "@/lib/waybill/deliver";
import type { WaybillPage } from "@/lib/waybill/items";

function page(pageIndex: number, orderId: string, name: string, quantity = 1): WaybillPage {
  return { pageIndex, shopeeOrderId: orderId, trackingCode: `TRK_${orderId}`, declaredTotalQuantity: quantity, items: [{ name, variant: "V", quantity }] };
}

// O1 and O3 are the same product, so they are pulled together ahead of O2:
// Excel order O1, O3, O2  =>  PDF pages 0, 2, 1  =>  widths 101, 103, 102.
const PAGES = [page(0, "O1", "Ghế"), page(1, "O2", "Piston"), page(2, "O3", "Ghế")];
const SORTED_WIDTHS = [101, 103, 102];
const AT = new Date("2026-10-07T03:15:00Z");

async function newLog() {
  return prisma.zaloConfirmationLog.create({
    data: { threadId: "t", pdfUrl: "upload:x.pdf", orderIds: ["O1", "O2", "O3"], matchedCount: 3, confirmedAt: AT },
  });
}

// The sheet shows tracking codes (TRK_<order id> in these fixtures), not order ids.
async function orderIdsInExcel(data: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as ExcelJS.Buffer);
  const ids: string[] = [];
  workbook.worksheets[0].eachRow((row, index) => {
    if (index > 1) ids.push(String(row.getCell(4).value).replace(/^TRK_/, ""));
  });
  return ids;
}

describe("storeWaybillFiles", () => {
  beforeEach(async () => {
    sendFile.mockReset();
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
  });

  it("stores the grouped Excel and the re-ordered PDF against the confirmation log row", async () => {
    const log = await newLog();
    const sourcePdf = await makePdf(3);

    const result = await storeWaybillFiles({ logId: log.id, pages: PAGES, at: AT, sourcePdf });

    expect(result).toEqual({ stored: true, sortedPdfStored: true });
    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(file.xlsxName).toBe("Furni_10h0710_3 đơn_Đã gom.xlsx");
    expect(file.sortedPdfName).toBe("Furni_10h0710_3 đơn_Đã gom.pdf");
    expect(await orderIdsInExcel(file.xlsxData)).toEqual(["O1", "O3", "O2"]);
    expect(await pageWidths(file.sortedPdfData!)).toEqual(SORTED_WIDTHS);
    // Not an upload, so the original isn't copied.
    expect(file.pdfData).toBeNull();
  });

  it("keeps the original PDF too when it was uploaded by hand", async () => {
    const log = await newLog();
    const sourcePdf = await makePdf(3);

    await storeWaybillFiles({ logId: log.id, pages: PAGES, at: AT, sourcePdf, uploadedPdfName: "waybill.pdf" });

    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(file.pdfName).toBe("waybill.pdf");
    expect(Buffer.from(file.pdfData!).equals(sourcePdf)).toBe(true);
  });

  it("still stores the Excel when the PDF can't be re-ordered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = await newLog();

    const result = await storeWaybillFiles({ logId: log.id, pages: PAGES, at: AT, sourcePdf: Buffer.from("not a pdf") });
    vi.restoreAllMocks();

    expect(result).toEqual({ stored: true, sortedPdfStored: false });
    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(file.sortedPdfData).toBeNull();
    expect(await orderIdsInExcel(file.xlsxData)).toEqual(["O1", "O3", "O2"]);
  });

  it("does nothing when the PDF had no readable pages", async () => {
    const log = await newLog();
    const result = await storeWaybillFiles({ logId: log.id, pages: [], at: AT, sourcePdf: await makePdf(1) });
    expect(result).toEqual({ stored: false, sortedPdfStored: false });
    expect(await prisma.waybillFile.count()).toBe(0);
  });

  it("does not throw when the log row is gone (nothing to attach the files to)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await storeWaybillFiles({ logId: 999999, pages: PAGES, at: AT, sourcePdf: await makePdf(3) });
    vi.restoreAllMocks();
    expect(result.stored).toBe(false);
  });

  it("replaces the files if stored twice for the same log row", async () => {
    const log = await newLog();
    await storeWaybillFiles({ logId: log.id, pages: PAGES, at: AT, sourcePdf: await makePdf(3) });
    await storeWaybillFiles({ logId: log.id, pages: [page(0, "ONLY", "X")], at: AT, sourcePdf: await makePdf(1) });
    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(await orderIdsInExcel(file.xlsxData)).toEqual(["ONLY"]);
    expect(await pageWidths(file.sortedPdfData!)).toEqual([101]);
  });

  afterAll(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.$disconnect();
  });
});

describe("sendWaybillExcel", () => {
  beforeEach(() => {
    sendFile.mockReset();
    sendFile.mockResolvedValue(undefined);
  });

  it("posts the grouped Excel to the thread with the agreed caption", async () => {
    const result = await sendWaybillExcel({ pages: PAGES, at: AT, thread: { id: "G123", type: "group" } });

    expect(result).toEqual({ sent: true });
    expect(sendFile).toHaveBeenCalledTimes(1);
    const [threadId, threadType, fileName, data, message] = sendFile.mock.calls[0] as unknown as [string, string, string, Buffer, string];
    expect([threadId, threadType, fileName]).toEqual(["G123", "group", "Furni_10h0710_3 đơn_Đã gom.xlsx"]);
    expect(message).toBe("Đây là danh sách đơn đã gom các đơn giống nhau đứng gần nhau");
    expect(message).toBe(WAYBILL_EXCEL_MESSAGE);
    expect(await orderIdsInExcel(data)).toEqual(["O1", "O3", "O2"]);
  });

  it("does not throw when Zalo refuses the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendFile.mockRejectedValueOnce(new Error("bridge down"));

    const result = await sendWaybillExcel({ pages: PAGES, at: AT, thread: { id: "G123", type: "group" } });

    expect(result).toEqual({ sent: false });
    vi.restoreAllMocks();
  });

  it("sends nothing when the PDF had no readable pages", async () => {
    const result = await sendWaybillExcel({ pages: [], at: AT, thread: { id: "G123", type: "group" } });
    expect(result).toEqual({ sent: false });
    expect(sendFile).not.toHaveBeenCalled();
  });
});

describe("sendSortedWaybillPdf", () => {
  beforeEach(() => {
    sendFile.mockReset();
    sendFile.mockResolvedValue(undefined);
  });

  it("posts the re-ordered PDF to the thread, named like the Excel", async () => {
    const result = await sendSortedWaybillPdf({ pages: PAGES, at: AT, sourcePdf: await makePdf(3), thread: { id: "G123", type: "group" } });

    expect(result).toEqual({ sent: true });
    expect(sendFile).toHaveBeenCalledTimes(1);
    const [threadId, threadType, fileName, data, message] = sendFile.mock.calls[0] as unknown as [string, string, string, Buffer, string];
    expect([threadId, threadType, fileName]).toEqual(["G123", "group", "Furni_10h0710_3 đơn_Đã gom.pdf"]);
    expect(message).toBe(WAYBILL_SORTED_PDF_MESSAGE);
    expect(await pageWidths(data)).toEqual(SORTED_WIDTHS);
  });

  it("does not throw when Zalo refuses the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendFile.mockRejectedValueOnce(new Error("bridge down"));
    const result = await sendSortedWaybillPdf({ pages: PAGES, at: AT, sourcePdf: await makePdf(3), thread: { id: "G123", type: "group" } });
    vi.restoreAllMocks();
    expect(result).toEqual({ sent: false });
  });

  it("sends nothing, without throwing, when the source can't be read as a PDF", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendSortedWaybillPdf({ pages: PAGES, at: AT, sourcePdf: Buffer.from("not a pdf"), thread: { id: "G123", type: "group" } });
    vi.restoreAllMocks();
    expect(result).toEqual({ sent: false });
    expect(sendFile).not.toHaveBeenCalled();
  });

  it("sends nothing when the PDF had no readable pages", async () => {
    const result = await sendSortedWaybillPdf({ pages: [], at: AT, sourcePdf: await makePdf(1), thread: { id: "G123", type: "group" } });
    expect(result).toEqual({ sent: false });
    expect(sendFile).not.toHaveBeenCalled();
  });
});

// A PDF with several labels tiled on each sheet is re-ordered cell by cell, not page by page.
describe("a PDF with several labels per sheet", () => {
  // Two 2×2 sheets, slots 0..5 = products A B A B A C, so the order is A A A B B C = slots 0 2 4 1 3 5.
  const TILED_PAGES = ["A", "B", "A", "B", "A", "C"].map((product, slot) => page(slot, `O${slot}`, product));
  const LAYOUT = { cols: 2, rows: 2, occupied: [0, 1, 2, 3, 4, 5] };
  const EXPECTED = [
    [0, 2, 4, 1],
    [3, 5, null, null],
  ];
  const tiledSource = () => makeTiledPdf(2, 2, [[0, 1, 2, 3], [4, 5, null, null]]);
  // The file bytes of the n-th sendFile(thread, type, name, data, message) call.
  const sentData = (n: number) => (sendFile.mock.calls[n] as unknown as unknown[])[3] as Uint8Array;

  beforeEach(async () => {
    sendFile.mockReset();
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
  });

  it("posts a PDF whose labels follow the Excel order", async () => {
    const result = await sendSortedWaybillPdf({
      pages: TILED_PAGES,
      at: AT,
      sourcePdf: await tiledSource(),
      layout: LAYOUT,
      thread: { id: "G123", type: "group" },
    });

    expect(result).toEqual({ sent: true });
    expect(await renderedCellIds(sentData(0), 2, 2)).toEqual(EXPECTED);
  });

  it("stores that PDF, and the Excel lists the same sequence", async () => {
    const log = await newLog();
    const result = await storeWaybillFiles({ logId: log.id, pages: TILED_PAGES, at: AT, sourcePdf: await tiledSource(), layout: LAYOUT });

    expect(result).toEqual({ stored: true, sortedPdfStored: true });
    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(await renderedCellIds(file.sortedPdfData!, 2, 2)).toEqual(EXPECTED);
    expect(await orderIdsInExcel(file.xlsxData)).toEqual(["O0", "O2", "O4", "O1", "O3", "O5"]);
  });

  it("without a layout the same call would treat each sheet as one order's page", async () => {
    // The layout is what tells the two kinds of PDF apart; documents it is not set for behave as before.
    await sendSortedWaybillPdf({ pages: PAGES, at: AT, sourcePdf: await makePdf(3), thread: { id: "G123", type: "group" } });
    expect(await pageWidths(sentData(0))).toEqual(SORTED_WIDTHS);
  });
});

// The layout asked for on the Đóng đơn page: N labels per A4 sheet, whatever the PDF looked like.
describe("a chosen PDF layout (perPage)", () => {
  // Products A B A B A C on slots 0..5, so the order is A A A B B C = slots 0 2 4 1 3 5.
  const PAGES6 = ["A", "B", "A", "B", "A", "C"].map((product, slot) => page(slot, `O${slot}`, product));
  const sentData = (n: number) => (sendFile.mock.calls[n] as unknown as unknown[])[3] as Uint8Array;

  beforeEach(async () => {
    sendFile.mockReset();
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
  });

  it("posts a one-label-per-page PDF as N to a sheet", async () => {
    await sendSortedWaybillPdf({ pages: PAGES6, at: AT, sourcePdf: await makeLabelPages(6), perPage: 4, thread: { id: "G123", type: "group" } });
    expect(idsOf(await renderedInk(sentData(0), outputSheet(4)))).toEqual([
      [0, 2, 4, 1],
      [3, 5, null, null],
    ]);
  });

  it("posts a PDF with several labels per sheet as N to a sheet", async () => {
    const source = await makeTiledPdf(2, 2, [[0, 1, 2, 3], [4, 5, null, null]]);
    await sendSortedWaybillPdf({
      pages: PAGES6,
      at: AT,
      sourcePdf: source,
      layout: { cols: 2, rows: 2, occupied: [0, 1, 2, 3, 4, 5] },
      perPage: 6,
      thread: { id: "G123", type: "group" },
    });
    expect(idsOf(await renderedInk(sentData(0), outputSheet(6)))).toEqual([[0, 2, 4, 1, 3, 5]]);
  });

  it("stores the PDF in that layout, next to an Excel in the same order", async () => {
    const log = await newLog();
    const result = await storeWaybillFiles({ logId: log.id, pages: PAGES6, at: AT, sourcePdf: await makeLabelPages(6), perPage: 9 });

    expect(result).toEqual({ stored: true, sortedPdfStored: true });
    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(idsOf(await renderedInk(file.sortedPdfData!, outputSheet(9)))).toEqual([[0, 2, 4, 1, 3, 5, null, null, null]]);
    expect(await orderIdsInExcel(file.xlsxData)).toEqual(["O0", "O2", "O4", "O1", "O3", "O5"]);
  });

  it("falls back to no PDF (but keeps the Excel) when the layout can't be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = await newLog();
    const result = await storeWaybillFiles({ logId: log.id, pages: PAGES6, at: AT, sourcePdf: Buffer.from("not a pdf"), perPage: 4 });
    vi.restoreAllMocks();
    expect(result).toEqual({ stored: true, sortedPdfStored: false });
  });

  it("treats a null layout as 'keep the PDF as it is'", async () => {
    await sendSortedWaybillPdf({ pages: PAGES, at: AT, sourcePdf: await makePdf(3), perPage: null, thread: { id: "G123", type: "group" } });
    expect(await pageWidths(sentData(0))).toEqual(SORTED_WIDTHS);
  });
});

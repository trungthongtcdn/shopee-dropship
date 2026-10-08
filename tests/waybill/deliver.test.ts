import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { makePdf, pageWidths } from "./pdfFixture";

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

async function orderIdsInExcel(data: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(data) as unknown as ExcelJS.Buffer);
  const ids: string[] = [];
  workbook.worksheets[0].eachRow((row, index) => {
    if (index > 1) ids.push(String(row.getCell(4).value));
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
    expect(file.xlsxName).toBe("danh-sach-don-gom-nhom-20261007-1015.xlsx");
    expect(file.sortedPdfName).toBe("danh-sach-don-gom-nhom-20261007-1015.pdf");
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
    expect([threadId, threadType, fileName]).toEqual(["G123", "group", "danh-sach-don-gom-nhom-20261007-1015.xlsx"]);
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
    expect([threadId, threadType, fileName]).toEqual(["G123", "group", "danh-sach-don-gom-nhom-20261007-1015.pdf"]);
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

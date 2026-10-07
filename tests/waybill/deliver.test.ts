import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";

const sendFile = vi.fn(async () => {});
vi.mock("@/lib/zalo/bridge", () => ({ sendFile: (...args: unknown[]) => (sendFile as (...a: unknown[]) => Promise<void>)(...args) }));

import { storeWaybillExcel, sendWaybillExcel, WAYBILL_EXCEL_MESSAGE } from "@/lib/waybill/deliver";
import type { WaybillPage } from "@/lib/waybill/items";

function page(orderId: string, name: string, quantity = 1): WaybillPage {
  return { shopeeOrderId: orderId, trackingCode: `TRK_${orderId}`, declaredTotalQuantity: quantity, items: [{ name, variant: "V", quantity }] };
}

const PAGES = [page("O1", "Ghế"), page("O2", "Piston"), page("O3", "Ghế")];
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

describe("storeWaybillExcel", () => {
  beforeEach(async () => {
    sendFile.mockReset();
    sendFile.mockResolvedValue(undefined);
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
  });

  it("stores the grouped Excel against the confirmation log row", async () => {
    const log = await newLog();

    const result = await storeWaybillExcel({ logId: log.id, pages: PAGES, at: AT });

    expect(result).toEqual({ stored: true });
    const file = await prisma.waybillFile.findUnique({ where: { confirmationLogId: log.id } });
    expect(file?.xlsxName).toBe("danh-sach-don-gom-nhom-20261007-1015.xlsx");
    expect(file?.pdfData).toBeNull();
    // O1 and O3 are the same product, so they were pulled together ahead of O2.
    expect(await orderIdsInExcel(file!.xlsxData)).toEqual(["O1", "O3", "O2"]);
  });

  it("keeps the PDF too when one is handed over (hand-uploaded file)", async () => {
    const log = await newLog();
    const pdf = Buffer.from("%PDF-1.4 fake");

    await storeWaybillExcel({ logId: log.id, pages: PAGES, at: AT, pdf: { fileName: "waybill.pdf", data: pdf } });

    const file = await prisma.waybillFile.findUnique({ where: { confirmationLogId: log.id } });
    expect(file?.pdfName).toBe("waybill.pdf");
    expect(Buffer.from(file!.pdfData!).equals(pdf)).toBe(true);
  });

  it("does nothing when the PDF had no readable pages", async () => {
    const log = await newLog();
    const result = await storeWaybillExcel({ logId: log.id, pages: [], at: AT });
    expect(result).toEqual({ stored: false });
    expect(await prisma.waybillFile.count()).toBe(0);
  });

  it("does not throw when the log row is gone (nothing to attach the file to)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await storeWaybillExcel({ logId: 999999, pages: PAGES, at: AT });
    expect(result.stored).toBe(false);
    vi.restoreAllMocks();
  });

  it("replaces the file if delivered twice for the same log row", async () => {
    const log = await newLog();
    await storeWaybillExcel({ logId: log.id, pages: PAGES, at: AT });
    await storeWaybillExcel({ logId: log.id, pages: [page("ONLY", "X")], at: AT });
    const file = await prisma.waybillFile.findUnique({ where: { confirmationLogId: log.id } });
    expect(await orderIdsInExcel(file!.xlsxData)).toEqual(["ONLY"]);
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
    // O1 and O3 are the same product, so they were pulled together ahead of O2.
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

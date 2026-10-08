import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { makePdf, pageWidths } from "../waybill/pdfFixture";

const fetchMessages = vi.fn();
const sendFile = vi.fn();
vi.mock("@/lib/zalo/bridge", () => ({
  fetchMessages: (...args: unknown[]) => fetchMessages(...args),
  sendFile: (...args: unknown[]) => sendFile(...args),
}));

const GOOD_PARSE = {
  orders: [
    { shopeeOrderId: "SP1", trackingCode: "T1" },
    { shopeeOrderId: "SP2", trackingCode: "T2" },
  ],
  pages: [
    { pageIndex: 0, shopeeOrderId: "SP1", trackingCode: "T1", declaredTotalQuantity: 1, items: [{ name: "Ghế", variant: "Đen", quantity: 1 }] },
    { pageIndex: 1, shopeeOrderId: "SP2", trackingCode: "T2", declaredTotalQuantity: 1, items: [{ name: "Ghế", variant: "Đen", quantity: 1 }] },
  ],
};

const downloadWaybillPdf = vi.fn();
const parseWaybillPdf = vi.fn();
vi.mock("@/lib/zalo/parseWaybill", () => ({
  downloadWaybillPdf: (...args: unknown[]) => downloadWaybillPdf(...args),
  parseWaybillPdf: (...args: unknown[]) => parseWaybillPdf(...args),
}));

import { runPollCycle, WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";

// runPollCycle remembers which PDF messages it already answered (so a cycle
// that fails halfway and is retried doesn't post the file again), so every
// test uses message ids nobody else used.
let counter = 0;
function freshIds() {
  counter += 1;
  return { pdf: `pdf-${counter}`, confirm: `confirm-${counter}` };
}

function pdfMessage(id: string, ageMs = 60_000) {
  return {
    msg_id: id,
    from_uid: "u",
    from_name: "Đối tác",
    is_self: false,
    content: "AWB: https://cdn.example/air_waybill.pdf",
    ts: String(Date.now() - ageMs),
  };
}

function confirmMessage(id: string) {
  return { msg_id: id, from_uid: "u", from_name: "Luân", is_self: false, content: "Đã in 2 đơn", ts: String(Date.now()) };
}

describe("runPollCycle + grouped Excel", () => {
  beforeEach(async () => {
    fetchMessages.mockReset();
    sendFile.mockReset();
    downloadWaybillPdf.mockReset();
    parseWaybillPdf.mockReset();
    sendFile.mockResolvedValue(undefined);
    downloadWaybillPdf.mockImplementation(async () => makePdf(2));
    parseWaybillPdf.mockResolvedValue(GOOD_PARSE);
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.order.deleteMany();
    await prisma.zaloWatchConfig.create({
      data: { purpose: WAYBILL_CONFIRM_PURPOSE, threadId: "G1", threadType: "group", threadName: "Kho" },
    });
  });

  it("answers a PDF message right away with the grouped Excel and then the re-ordered PDF, without waiting for anyone to confirm", async () => {
    const ids = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf)]);

    const result = await runPollCycle();

    expect(result).toEqual({ processed: 1, confirmed: 0 });
    expect(sendFile).toHaveBeenCalledTimes(2);

    const [excelThread, excelType, excelName, , excelMessage] = sendFile.mock.calls[0];
    expect([excelThread, excelType]).toEqual(["G1", "group"]);
    expect(excelName).toMatch(/^danh-sach-don-gom-nhom-\d{8}-\d{4}\.xlsx$/);
    expect(excelMessage).toBe("Đây là danh sách đơn đã gom các đơn giống nhau đứng gần nhau");

    const [pdfThread, pdfType, pdfName, pdfData, pdfMessageText] = sendFile.mock.calls[1];
    expect([pdfThread, pdfType]).toEqual(["G1", "group"]);
    // Same stem as the Excel, so the two files pair up in the group.
    expect(pdfName).toBe(String(excelName).replace(/\.xlsx$/, ".pdf"));
    expect(pdfMessageText).toBe("Đây là file PDF phiếu gửi hàng đã sắp xếp lại theo đúng thứ tự trong file Excel");
    expect(await pageWidths(pdfData)).toEqual([101, 102]);

    // Nothing was confirmed, so no orders touched and nothing logged.
    expect(await prisma.zaloConfirmationLog.count()).toBe(0);
    const config = await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
    expect(config.lastProcessedMsgId).toBe(ids.pdf);
  });

  it("posts the files once when 'Đã in' follows, and keeps copies for the buttons on the page", async () => {
    const ids = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);

    const result = await runPollCycle();

    expect(result).toEqual({ processed: 2, confirmed: 1 });
    // Excel + PDF, once — the confirmation doesn't post them again.
    expect(sendFile).toHaveBeenCalledTimes(2);
    // One download serves both the files and the confirmation.
    expect(downloadWaybillPdf).toHaveBeenCalledTimes(1);

    const log = await prisma.zaloConfirmationLog.findFirstOrThrow();
    const stored = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(stored.sortedPdfData).not.toBeNull();
  });

  it("answers every PDF message in a batch", async () => {
    const a = freshIds();
    const b = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(a.pdf), pdfMessage(b.pdf)]);

    await runPollCycle();

    // Excel + PDF for each of the two messages.
    expect(sendFile).toHaveBeenCalledTimes(4);
  });

  it("still confirms and advances the cursor when Zalo refuses the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = freshIds();
    sendFile.mockRejectedValue(new Error("bridge down"));
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);

    const result = await runPollCycle();
    vi.restoreAllMocks();

    expect(result).toEqual({ processed: 2, confirmed: 1 });
    expect(await prisma.zaloConfirmationLog.count()).toBe(1);
    const config = await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
    expect(config.lastProcessedMsgId).toBe(ids.confirm);
    expect(await prisma.waybillFile.count()).toBe(1);
  });

  it("does not re-post the file when a failed cycle is retried with the same messages", async () => {
    const ids = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);
    // First cycle: the Excel goes out, then applying the confirmation blows up
    // (an order id Prisma refuses stands in for any DB failure).
    parseWaybillPdf.mockResolvedValueOnce({ ...GOOD_PARSE, orders: [{ shopeeOrderId: undefined, trackingCode: null }] });

    await expect(runPollCycle()).rejects.toThrow();
    expect(sendFile).toHaveBeenCalledTimes(2);
    expect(await prisma.zaloConfirmationLog.count()).toBe(0);

    // The cursor never advanced, so the next cycle sees the same messages.
    await runPollCycle();

    expect(sendFile).toHaveBeenCalledTimes(2);
    expect(await prisma.zaloConfirmationLog.count()).toBe(1);
  });

  it("still posts the Excel when the PDF can't be re-ordered", async () => {
    // restoreAllMocks() would also wipe sendFile's recorded calls, so restore only the console spy.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = freshIds();
    downloadWaybillPdf.mockImplementation(async () => Buffer.from("not really a pdf"));
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf)]);

    await runPollCycle();
    consoleSpy.mockRestore();

    expect(sendFile).toHaveBeenCalledTimes(1);
    expect(String(sendFile.mock.calls[0][2])).toMatch(/\.xlsx$/);
  });

  it("skips a PDF message that is hours old (backlog after an outage or a group change)", async () => {
    const ids = freshIds();
    const threeHours = 3 * 60 * 60 * 1000;
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf, threeHours), confirmMessage(ids.confirm)]);

    const result = await runPollCycle();

    expect(sendFile).not.toHaveBeenCalled();
    // ...but the confirmation logic is untouched by that.
    expect(result).toEqual({ processed: 2, confirmed: 1 });
  });

  it("does nothing for the Excel when the PDF cannot be downloaded, and does not fail the cycle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ids = freshIds();
    downloadWaybillPdf.mockRejectedValue(new Error("HTTP 404"));
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf)]);

    const result = await runPollCycle();
    vi.restoreAllMocks();

    expect(result).toEqual({ processed: 1, confirmed: 0 });
    expect(sendFile).not.toHaveBeenCalled();
    const config = await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
    expect(config.lastProcessedMsgId).toBe(ids.pdf);
  });

  afterAll(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

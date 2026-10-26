import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";
import { makePdf } from "../waybill/pdfFixture";

const fetchMessages = vi.fn();
const sendFile = vi.fn();
const sendGroupMessage = vi.fn();
vi.mock("@/lib/zalo/bridge", () => ({
  fetchMessages: (...args: unknown[]) => fetchMessages(...args),
  sendFile: (...args: unknown[]) => sendFile(...args),
  sendGroupMessage: (...args: unknown[]) => sendGroupMessage(...args),
}));

const downloadWaybillPdf = vi.fn();
const parseWaybillPdf = vi.fn();
vi.mock("@/lib/zalo/parseWaybill", () => ({
  downloadWaybillPdf: (...args: unknown[]) => downloadWaybillPdf(...args),
  parseWaybillPdf: (...args: unknown[]) => parseWaybillPdf(...args),
}));

// What the bridge can carry, shrunk to a few bytes so a tiny test PDF is "too big to send".
vi.mock("@/lib/zalo/waybillLimits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/zalo/waybillLimits")>()),
  MAX_SEND_BYTES: 100,
}));

import { runPollCycle, WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";

const PARSE = {
  orders: [{ shopeeOrderId: "SPBIG", trackingCode: "TBIG" }],
  pages: [{ pageIndex: 0, shopeeOrderId: "SPBIG", trackingCode: "TBIG", declaredTotalQuantity: 1, items: [{ name: "Ghế", variant: "Đen", quantity: 1 }] }],
  labelCount: 1,
};

describe("a re-ordered PDF too big for the bridge", () => {
  beforeEach(async () => {
    for (const mock of [fetchMessages, sendFile, sendGroupMessage, downloadWaybillPdf, parseWaybillPdf]) mock.mockReset();
    sendFile.mockResolvedValue(undefined);
    sendGroupMessage.mockResolvedValue(undefined);
    downloadWaybillPdf.mockImplementation(async () => makePdf(1));
    parseWaybillPdf.mockResolvedValue(PARSE);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.zaloWatchConfig.create({
      data: { purpose: WAYBILL_CONFIRM_PURPOSE, threadId: "G9", threadType: "group", threadName: "Kho" },
    });
  });

  it("is not uploaded (no 413 round trip): the Excel goes out and the group is told where to find the PDF", async () => {
    fetchMessages.mockResolvedValue([
      { msg_id: "big-1", from_uid: "u", from_name: "Đối tác", is_self: false, content: "AWB: https://cdn.example/big.pdf", ts: String(Date.now() - 1000) },
    ]);

    await runPollCycle();

    expect(sendFile).toHaveBeenCalledTimes(1);
    expect(String(sendFile.mock.calls[0][2])).toMatch(/\.xlsx$/);
    expect(sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(String(sendGroupMessage.mock.calls[0][1])).toContain("Đóng đơn");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.$disconnect();
  });
});

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/db";

const fetchMessages = vi.fn();
const sendFile = vi.fn();
vi.mock("@/lib/zalo/bridge", () => ({
  fetchMessages: (...args: unknown[]) => fetchMessages(...args),
  sendFile: (...args: unknown[]) => sendFile(...args),
}));
vi.mock("@/lib/zalo/parseWaybill", () => ({
  downloadWaybillPdf: vi.fn(async () => Buffer.from("pdf")),
  parseWaybillPdf: vi.fn(async () => ({
    orders: [
      { shopeeOrderId: "SP1", trackingCode: "T1" },
      { shopeeOrderId: "SP2", trackingCode: "T2" },
    ],
    pages: [
      { shopeeOrderId: "SP1", trackingCode: "T1", declaredTotalQuantity: 1, items: [{ name: "Ghế", variant: "Đen", quantity: 1 }] },
      { shopeeOrderId: "SP2", trackingCode: "T2", declaredTotalQuantity: 1, items: [{ name: "Ghế", variant: "Đen", quantity: 1 }] },
    ],
  })),
}));

import { runPollCycle, WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";

const MESSAGES = [
  { msg_id: "m1", from_uid: "u", from_name: "Luân", is_self: false, content: "https://cdn.example/air_waybill.pdf", ts: "1790000000000" },
  { msg_id: "m2", from_uid: "u", from_name: "Luân", is_self: false, content: "Đã in 2 đơn", ts: "1790000001000" },
];

describe("runPollCycle + grouped Excel", () => {
  beforeEach(async () => {
    fetchMessages.mockReset();
    sendFile.mockReset();
    fetchMessages.mockResolvedValue(MESSAGES);
    sendFile.mockResolvedValue(undefined);
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.order.deleteMany();
    await prisma.zaloWatchConfig.create({
      data: { purpose: WAYBILL_CONFIRM_PURPOSE, threadId: "G1", threadType: "group", threadName: "Kho" },
    });
  });

  it("posts the grouped Excel back into the group the PDF came from, once per confirmation", async () => {
    const result = await runPollCycle();

    expect(result).toEqual({ processed: 2, confirmed: 1 });
    expect(sendFile).toHaveBeenCalledTimes(1);
    const [threadId, threadType, fileName] = sendFile.mock.calls[0];
    expect([threadId, threadType]).toEqual(["G1", "group"]);
    expect(fileName).toMatch(/^danh-sach-don-gom-nhom-\d{8}-\d{4}\.xlsx$/);

    const log = await prisma.zaloConfirmationLog.findFirstOrThrow();
    expect(await prisma.waybillFile.findUnique({ where: { confirmationLogId: log.id } })).not.toBeNull();
  });

  it("still applies the confirmation and advances the cursor when Zalo refuses the file", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    sendFile.mockRejectedValue(new Error("bridge down"));

    const result = await runPollCycle();
    vi.restoreAllMocks();

    expect(result).toEqual({ processed: 2, confirmed: 1 });
    expect(await prisma.zaloConfirmationLog.count()).toBe(1);
    const config = await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
    expect(config.lastProcessedMsgId).toBe("m2");
    // The Excel is still kept for the "Xem excel" button.
    expect(await prisma.waybillFile.count()).toBe(1);
  });

  afterAll(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

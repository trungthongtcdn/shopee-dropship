import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const GOOD_PARSE = {
  orders: [{ shopeeOrderId: "SP1", trackingCode: "T1" }],
  pages: [{ pageIndex: 0, shopeeOrderId: "SP1", trackingCode: "T1", declaredTotalQuantity: 1, items: [{ name: "Ghế", variant: "Đen", quantity: 1 }] }],
  labelCount: 1,
};

const downloadWaybillPdf = vi.fn();
const parseWaybillPdf = vi.fn();
vi.mock("@/lib/zalo/parseWaybill", () => ({
  downloadWaybillPdf: (...args: unknown[]) => downloadWaybillPdf(...args),
  parseWaybillPdf: (...args: unknown[]) => parseWaybillPdf(...args),
}));

import { MAX_CONFIRM_ATTEMPTS, WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";

type PollerModule = typeof import("@/lib/zalo/poller");

let counter = 0;
const freshIds = () => {
  counter += 1;
  return { pdf: `g-pdf-${counter}`, confirm: `g-confirm-${counter}` };
};

const pdfMessage = (id: string) => ({
  msg_id: id,
  from_uid: "u",
  from_name: "Đối tác",
  is_self: false,
  content: "AWB: https://cdn.example/air_waybill.pdf",
  ts: String(Date.now() - 60_000),
});
const confirmMessage = (id: string) => ({ msg_id: id, from_uid: "u", from_name: "Luân", is_self: false, content: "Đã in 1 đơn", ts: String(Date.now()) });

let stateFile: string;

// A fresh copy of the poller module = a restarted process: its memory is gone, only the state file is left.
async function restartedPoller(): Promise<PollerModule> {
  vi.resetModules();
  return import("@/lib/zalo/poller");
}

describe("runPollCycle survives its own crashes", () => {
  beforeEach(async () => {
    stateFile = path.join(os.tmpdir(), `poller-state-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    vi.stubEnv("ZALO_POLLER_STATE_FILE", stateFile);
    for (const mock of [fetchMessages, sendFile, sendGroupMessage, downloadWaybillPdf, parseWaybillPdf]) mock.mockReset();
    sendFile.mockResolvedValue(undefined);
    sendGroupMessage.mockResolvedValue(undefined);
    downloadWaybillPdf.mockImplementation(async () => makePdf(1));
    parseWaybillPdf.mockResolvedValue(GOOD_PARSE);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.order.deleteMany();
    await prisma.zaloWatchConfig.create({
      data: { purpose: WAYBILL_CONFIRM_PURPOSE, threadId: "G1", threadType: "group", threadName: "Kho" },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(stateFile, { force: true });
    fs.rmSync(`${stateFile}.tmp`, { force: true });
  });

  it("does not post the same files again when the poller restarts before its cursor moved", async () => {
    const ids = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);
    // The first run posts the files, then the confirmation blows up: the cursor stays put.
    parseWaybillPdf.mockResolvedValueOnce({ ...GOOD_PARSE, orders: [{ shopeeOrderId: undefined, trackingCode: null }] });

    const first = await restartedPoller();
    await expect(first.runPollCycle()).rejects.toThrow();
    expect(sendFile).toHaveBeenCalledTimes(2);

    // Same messages, new process (the memory of the first one is gone).
    const second = await restartedPoller();
    await second.runPollCycle();

    expect(sendFile).toHaveBeenCalledTimes(2);
    expect(await prisma.zaloConfirmationLog.count()).toBe(1);
  });

  it("gives up on a confirmation that keeps failing: moves on, tells the group once, and leaves the orders alone", async () => {
    const ids = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);
    parseWaybillPdf.mockRejectedValue(new Error("killed by the OOM killer, say"));

    for (let attempt = 1; attempt <= MAX_CONFIRM_ATTEMPTS; attempt++) {
      const poller = await restartedPoller();
      await expect(poller.runPollCycle()).rejects.toThrow("OOM");
    }
    expect(sendGroupMessage).not.toHaveBeenCalled();

    const result = await (await restartedPoller()).runPollCycle();

    expect(result).toEqual({ processed: 2, confirmed: 0 });
    expect(sendGroupMessage).toHaveBeenCalledTimes(1);
    expect(sendGroupMessage.mock.calls[0][0]).toBe("G1");
    expect(String(sendGroupMessage.mock.calls[0][1])).toContain("xác nhận tay");
    const config = await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
    expect(config.lastProcessedMsgId).toBe(ids.confirm);
    expect(await prisma.zaloConfirmationLog.count()).toBe(0);
  });

  it("skips a file over the size cap, says so once in the group, and does not stall the cursor", async () => {
    const ids = freshIds();
    // Built from whichever copy of the module the (restarted) poller is using, or instanceof fails.
    downloadWaybillPdf.mockImplementation(async () => {
      const { WaybillTooLargeError } = await import("@/lib/zalo/waybillLimits");
      throw new WaybillTooLargeError("too big", "31,4 MB");
    });
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);

    const poller = await restartedPoller();
    const result = await poller.runPollCycle();

    expect(result).toEqual({ processed: 2, confirmed: 0 });
    expect(sendFile).not.toHaveBeenCalled();
    // One line for the file, one for the "Đã in" that could not be applied — never a loop of them.
    const notices = sendGroupMessage.mock.calls.map((call) => String(call[1]));
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain("31,4 MB");
    expect(notices[1]).toContain("Đã in");
    const config = await prisma.zaloWatchConfig.findUniqueOrThrow({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
    expect(config.lastProcessedMsgId).toBe(ids.confirm);

    // Replaying the same messages (a restart before the cursor was saved) is silent.
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);
    await (await restartedPoller()).runPollCycle();
    expect(sendGroupMessage).toHaveBeenCalledTimes(2);
  });

  it("applies a normal confirmation and clears its tries", async () => {
    const ids = freshIds();
    fetchMessages.mockResolvedValue([pdfMessage(ids.pdf), confirmMessage(ids.confirm)]);

    const result = await (await restartedPoller()).runPollCycle();

    expect(result).toEqual({ processed: 2, confirmed: 1 });
    expect(sendGroupMessage).not.toHaveBeenCalled();
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    expect(state.attempts).toEqual({});
  });

  afterAll(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.zaloWatchConfig.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

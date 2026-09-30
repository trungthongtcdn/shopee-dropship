import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { planCancelReceiptMessages, applyCancelReceiptCodes, tsToDate } from "@/lib/zalo/cancelReceiptPoller";
import type { ZaloMessage } from "@/lib/zalo/bridge";

function msg(overrides: Partial<ZaloMessage> & { msg_id: string }): ZaloMessage {
  return {
    from_uid: "u1",
    from_name: "Luân",
    is_self: false,
    content: "",
    ts: 1_790_000_000_000,
    ...overrides,
  };
}

describe("tsToDate", () => {
  it("treats a 13-digit value as milliseconds directly", () => {
    expect(tsToDate(1_790_000_000_000).getTime()).toBe(1_790_000_000_000);
  });

  it("scales up a 10-digit value as seconds", () => {
    expect(tsToDate(1_790_000_000).getTime()).toBe(1_790_000_000_000);
  });

  // Production bug: the bridge sends ts as a numeric STRING (confirmed via
  // a real crash — new Date("1790326992116") is Invalid Date, since the
  // Date string constructor tries to parse it as a date string, not a
  // numeric timestamp). Every cancel-receipt confirmation was failing
  // Prisma validation on cancelReceivedAt until this was coerced.
  it("coerces a numeric-string ts the same way as a number", () => {
    expect(tsToDate("1790326992116").getTime()).toBe(1790326992116);
  });

  it("coerces a numeric-string seconds-scale ts too", () => {
    expect(tsToDate("1790000000").getTime()).toBe(1_790_000_000_000);
  });
});

describe("planCancelReceiptMessages", () => {
  it("produces a match for a message naming an order id", () => {
    const messages = [msg({ msg_id: "1", content: "260621MB6WJXKM đã nhận huỷ", ts: 1_790_000_000_000 })];
    const result = planCancelReceiptMessages(messages);

    expect(result.matches).toEqual([
      {
        codes: ["260621MB6WJXKM"],
        messageContent: "260621MB6WJXKM đã nhận huỷ",
        confirmedByName: "Luân",
        confirmedAt: new Date(1_790_000_000_000),
      },
    ]);
    expect(result.lastMsgId).toBe("1");
  });

  it("skips a message with no recognizable code", () => {
    const messages = [msg({ msg_id: "1", content: "chào buổi sáng cả nhà" })];
    const result = planCancelReceiptMessages(messages);

    expect(result.matches).toEqual([]);
    expect(result.lastMsgId).toBe("1");
  });

  it("processes is_self messages too, same reasoning as the waybill poller", () => {
    const messages = [msg({ msg_id: "1", is_self: true, content: "SPXVN068985623989 nhận rồi" })];
    const result = planCancelReceiptMessages(messages);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].codes).toEqual(["SPXVN068985623989"]);
  });

  it("produces one match per code-bearing message in a batch", () => {
    const messages = [
      msg({ msg_id: "1", content: "260621MB6WJXKM" }),
      msg({ msg_id: "2", content: "chào buổi sáng" }),
      msg({ msg_id: "3", content: "260920HNF4JUM6" }),
    ];
    const result = planCancelReceiptMessages(messages);

    expect(result.matches.map((m) => m.codes[0])).toEqual(["260621MB6WJXKM", "260920HNF4JUM6"]);
    expect(result.lastMsgId).toBe("3");
  });

  // Production bug: a sticker/image/system-notice message comes through
  // from the bridge with non-string content (an object, not text) since
  // the bridge passes raw Zalo payloads through uncoerced. Before this was
  // guarded, extractOrderCodes threw on .match() and crashed the whole
  // cycle, so lastProcessedMsgId never advanced and every message stayed
  // stuck unprocessed forever, including real order codes sent afterward.
  it("skips a non-text message instead of crashing the whole batch", () => {
    const messages = [
      msg({ msg_id: "1", content: "260621MB6WJXKM" }),
      { ...msg({ msg_id: "2" }), content: { href: "sticker.png" } } as unknown as ZaloMessage,
      msg({ msg_id: "3", content: "260920HNF4JUM6" }),
    ];
    const result = planCancelReceiptMessages(messages);

    expect(result.matches.map((m) => m.codes[0])).toEqual(["260621MB6WJXKM", "260920HNF4JUM6"]);
    expect(result.lastMsgId).toBe("3");
  });
});

describe("applyCancelReceiptCodes", () => {
  beforeEach(async () => {
    await prisma.zaloCancelReceiptLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("matches by shopeeOrderId and sets received_full + the message's own date", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "260621MB6WJXKM", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });
    const confirmedAt = new Date("2026-06-25T10:00:00.000Z");

    const result = await applyCancelReceiptCodes({
      codes: ["260621MB6WJXKM"],
      messageContent: "260621MB6WJXKM đã nhận huỷ",
      confirmedByName: "Luân",
      confirmedAt,
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(1);
    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "260621MB6WJXKM" } });
    expect(order?.cancelReceiptStatus).toBe("received_full");
    expect(order?.cancelReceivedAt?.toISOString()).toBe(confirmedAt.toISOString());

    const log = await prisma.zaloCancelReceiptLog.findFirst({ where: { threadId: "group-1" } });
    expect(log?.matchedCount).toBe(1);
    expect(log?.codes).toEqual(["260621MB6WJXKM"]);
    expect(log?.confirmedByName).toBe("Luân");
  });

  it("matches by trackingCode when the message only names that", async () => {
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP001",
        categoryName: "D100",
        trackingCode: "SPXVN068985623989",
        status: "pending",
        rawRowHash: "h",
        sheetRowIndex: 1,
      },
    });

    const result = await applyCancelReceiptCodes({
      codes: ["SPXVN068985623989"],
      messageContent: "SPXVN068985623989 nhận rồi",
      confirmedByName: "Luân",
      confirmedAt: new Date(),
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(1);
  });

  it("updates every line of a multi-line order sharing the same order id", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "SP002", categoryName: "D100", status: "pending", rawRowHash: "h1", sheetRowIndex: 1 },
    });
    await prisma.order.create({
      data: { shopeeOrderId: "SP002", categoryName: "D120", status: "pending", rawRowHash: "h2", sheetRowIndex: 2 },
    });

    const result = await applyCancelReceiptCodes({
      codes: ["SP002"],
      messageContent: "SP002",
      confirmedByName: null,
      confirmedAt: new Date(),
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(2);
  });

  it("still logs the message even when no order matches", async () => {
    const result = await applyCancelReceiptCodes({
      codes: ["SP-UNKNOWN"],
      messageContent: "SP-UNKNOWN",
      confirmedByName: null,
      confirmedAt: new Date(),
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(0);
    const log = await prisma.zaloCancelReceiptLog.findFirst({ where: { threadId: "group-1" } });
    expect(log?.matchedCount).toBe(0);
  });

  it("uses the given cancelReceiptStatus instead of the received_full default", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "SP003", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });

    await applyCancelReceiptCodes({
      codes: ["SP003"],
      messageContent: "SP003",
      confirmedByName: "Quét mã thủ công",
      confirmedAt: new Date(),
      threadId: "manual-scan",
      cancelReceiptStatus: "received_partial",
    });

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP003" } });
    expect(order?.cancelReceiptStatus).toBe("received_partial");
  });

  afterAll(async () => {
    await prisma.zaloCancelReceiptLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

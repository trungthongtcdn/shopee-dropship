import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { applyCancelledPayload, applyReturnedRefundedPayload } from "@/lib/sync/apply";
import { applyCancelReceiptCodes } from "@/lib/zalo/cancelReceiptPoller";
import { loadCancellationRows } from "@/lib/cancellation/loadCancellationRows";
import { loadCancellationSummaries } from "@/lib/report/cancellationLookup";
import type { IncomingRow } from "@/lib/sync/types";

// Sheet 5 can list one order twice: the buyer opened a return, cancelled it, then
// opened another, each with its own complaint id and return tracking code. The
// table holds one row per (order, type), so those rows are merged into one that
// keeps every return tracking code.

function returnRow(rowIndex: number, hash: string, orderId: string, returnCode: string | null, extra: Record<string, unknown> = {}): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      "Mã đơn hàng": orderId,
      "Mã vận đơn trả hàng": returnCode ?? "",
      "Mã số khiếu nại": `complaint-${hash}`,
      "Trạng thái Trả hàng/Hoàn tiền": "Chờ bạn xác nhận hàng trả về",
      ...extra,
    },
  };
}

const ORDER = "261013FXK1BRFS";

describe("returned_refunded rows that share an order", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
  });

  it("merges them into one row that keeps every return tracking code", async () => {
    const result = await applyReturnedRefundedPayload([
      returnRow(6, "h6", ORDER, "GYMCLK9Q", { "Trạng thái Trả hàng/Hoàn tiền": "Yêu cầu của Người mua đã hủy" }),
      returnRow(48, "h48", ORDER, "GYM344XL"),
    ]);

    expect(result.rowErrors).toEqual([]);
    expect(result.inserted).toBe(1);
    const rows = await prisma.cancellation.findMany({ where: { shopeeOrderId: ORDER } });
    expect(rows).toHaveLength(1);
    expect([...rows[0].returnTrackingCodes].sort()).toEqual(["GYM344XL", "GYMCLK9Q"]);
  });

  it("shows the latest sheet row's own data, with its code first", async () => {
    await applyReturnedRefundedPayload([
      returnRow(6, "h6", ORDER, "GYMCLK9Q", { "Trạng thái Trả hàng/Hoàn tiền": "Yêu cầu của Người mua đã hủy" }),
      returnRow(48, "h48", ORDER, "GYM344XL"),
    ]);

    const row = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: ORDER } });
    expect(row.returnTrackingCode).toBe("GYM344XL");
    expect(row.returnTrackingCodes).toEqual(["GYM344XL", "GYMCLK9Q"]);
    expect(row.returnRefundStatus).toBe("Chờ bạn xác nhận hàng trả về");
    expect(row.complaintId).toBe("complaint-h48");
    expect(row.sheetRowIndex).toBe(48);
  });

  it("gives the same result whichever order the rows arrive in", async () => {
    await applyReturnedRefundedPayload([
      returnRow(48, "h48", ORDER, "GYM344XL"),
      returnRow(6, "h6", ORDER, "GYMCLK9Q", { "Trạng thái Trả hàng/Hoàn tiền": "Yêu cầu của Người mua đã hủy" }),
    ]);

    const row = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: ORDER } });
    expect(row.returnTrackingCode).toBe("GYM344XL");
    expect(row.sheetRowIndex).toBe(48);
  });

  it("does not flip-flop: syncing the same sheet again changes nothing", async () => {
    const payload = [returnRow(6, "h6", ORDER, "GYMCLK9Q"), returnRow(48, "h48", ORDER, "GYM344XL")];
    await applyReturnedRefundedPayload(payload);

    for (let cycle = 0; cycle < 3; cycle++) {
      const again = await applyReturnedRefundedPayload(payload);
      expect(again).toEqual({ inserted: 0, updated: 0, softDeleted: 0, rowErrors: [] });
    }
    expect((await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: ORDER } })).returnTrackingCode).toBe("GYM344XL");
  });

  it("updates the merged row when either of the sheet rows changes", async () => {
    await applyReturnedRefundedPayload([returnRow(6, "h6", ORDER, "GYMCLK9Q"), returnRow(48, "h48", ORDER, "GYM344XL")]);

    const result = await applyReturnedRefundedPayload([returnRow(6, "h6-edited", ORDER, "GYMCLK9Q"), returnRow(48, "h48", ORDER, "GYM344XL")]);

    expect(result.updated).toBe(1);
  });

  it("goes back to one code when the sheet drops the older row", async () => {
    await applyReturnedRefundedPayload([returnRow(6, "h6", ORDER, "GYMCLK9Q"), returnRow(48, "h48", ORDER, "GYM344XL")]);

    await applyReturnedRefundedPayload([returnRow(47, "h48", ORDER, "GYM344XL")]);

    const row = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: ORDER } });
    expect(row.returnTrackingCodes).toEqual(["GYM344XL"]);
  });

  it("keeps a list of one for a normal order and an empty list when there is no code", async () => {
    await applyReturnedRefundedPayload([returnRow(2, "a", "ORDER-A", "SPXVN000001"), returnRow(3, "b", "ORDER-B", null)]);

    const a = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: "ORDER-A" } });
    const b = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: "ORDER-B" } });
    expect(a.returnTrackingCodes).toEqual(["SPXVN000001"]);
    expect(b.returnTrackingCodes).toEqual([]);
  });

  it("skips a repeated code and an empty one, keeping the others", async () => {
    await applyReturnedRefundedPayload([
      returnRow(2, "a", ORDER, "GYM344XL"),
      returnRow(3, "b", ORDER, "GYM344XL"),
      returnRow(4, "c", ORDER, null),
      returnRow(5, "d", ORDER, "  GYMCLK9Q "),
    ]);

    const row = await prisma.cancellation.findFirstOrThrow({ where: { shopeeOrderId: ORDER } });
    expect([...row.returnTrackingCodes].sort()).toEqual(["GYM344XL", "GYMCLK9Q"]);
  });
});

describe("other cancellation tabs with two lines of one order", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.cancellation.deleteMany();
  });

  it("become one row without an error, and stay put on the next sync", async () => {
    const payload: IncomingRow[] = [
      { rowIndex: 3, hash: "l1", data: { "Mã đơn hàng": "SP-CANCEL", "Tên sản phẩm": "Line one" } },
      { rowIndex: 4, hash: "l2", data: { "Mã đơn hàng": "SP-CANCEL", "Tên sản phẩm": "Line two" } },
    ];

    const first = await applyCancelledPayload(payload);
    const second = await applyCancelledPayload(payload);

    expect(first.rowErrors).toEqual([]);
    expect(first.inserted).toBe(1);
    expect(second).toEqual({ inserted: 0, updated: 0, softDeleted: 0, rowErrors: [] });
  });
});

describe("finding an order through any of its return tracking codes", () => {
  beforeEach(async () => {
    await prisma.zaloCancelReceiptLog.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.order.deleteMany();
    await prisma.order.create({
      data: { shopeeOrderId: ORDER, categoryName: "D100", status: "Hoàn thành", rawRowHash: "h", sheetRowIndex: 1 },
    });
    await applyReturnedRefundedPayload([returnRow(6, "h6", ORDER, "GYMCLK9Q"), returnRow(48, "h48", ORDER, "GYM344XL")]);
  });

  it("maps a receipt that names the older return's code", async () => {
    const result = await applyCancelReceiptCodes({
      codes: ["GYMCLK9Q"],
      messageContent: "GYMCLK9Q",
      confirmedByName: "Luân",
      confirmedAt: new Date("2026-10-26T03:00:00.000Z"),
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(1);
  });

  it("maps a receipt that names the latest return's code", async () => {
    const result = await applyCancelReceiptCodes({
      codes: ["GYM344XL"],
      messageContent: "GYM344XL",
      confirmedByName: "Luân",
      confirmedAt: new Date("2026-10-26T03:00:00.000Z"),
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(1);
  });

  it("is found by searching the older code on the Đơn hoàn huỷ page", async () => {
    const rows = await loadCancellationRows({ types: [], q: "GYMCLK9Q" });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual([ORDER]);
  });

  it("is found by the older code in lowercase too", async () => {
    const rows = await loadCancellationRows({ types: [], q: "gymclk9q" });
    expect(rows.map((r) => r.shopeeOrderId)).toEqual([ORDER]);
  });

  it("lists every code on the Report page's summary", async () => {
    const summary = (await loadCancellationSummaries([ORDER])).get(ORDER);
    expect(summary?.returnTrackingCode).toBe("GYM344XL, GYMCLK9Q");
  });

  it("still matches a row synced before the codes column existed, by its single code", async () => {
    await prisma.cancellation.deleteMany();
    await prisma.cancellation.create({
      data: { shopeeOrderId: ORDER, type: "returned_refunded", returnTrackingCode: "SPXVN060152102809", rawRowHash: "old", sheetRowIndex: 1 },
    });

    const result = await applyCancelReceiptCodes({
      codes: ["SPXVN060152102809"],
      messageContent: "SPXVN060152102809",
      confirmedByName: null,
      confirmedAt: new Date("2026-10-26T03:00:00.000Z"),
      threadId: "group-1",
    });

    expect(result.matchedCount).toBe(1);
  });
});

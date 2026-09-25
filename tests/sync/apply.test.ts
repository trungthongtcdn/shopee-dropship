// tests/sync/apply.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyOrdersPayload, applyCancelledPayload, applyDeliveryFailedPayload } from "@/lib/sync/apply";
import type { IncomingRow } from "@/lib/sync/types";

function orderRow(rowIndex: number, hash: string, orderId: string, categoryName?: string): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      "Mã đơn hàng": orderId,
      "Số lượng sản phẩm 1 đơn": 1,
      "Trạng Thái Đơn Hàng": "pending",
      ...(categoryName ? { "Tên phân loại hàng": categoryName } : {}),
    },
  };
}

describe("applyOrdersPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("inserts a new row and logs an insert", async () => {
    const result = await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          "Mã đơn hàng": "SP001",
          "Số lượng sản phẩm 1 đơn": 2,
          "Trạng Thái Đơn Hàng": "pending",
        },
      },
    ]);

    expect(result.inserted).toBe(1);
    expect(result.rowErrors).toHaveLength(0);
    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(order?.rawRowHash).toBe("hash-1");
    expect(order?.orderQuantity).toBe(2);
    const log = await prisma.syncLog.findFirst({ where: { changeType: "insert" } });
    expect(log?.sheetRowIndex).toBe(2);
  });

  it("updates a changed row, then soft-deletes it when it disappears", async () => {
    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          "Mã đơn hàng": "SP001",
          "Số lượng sản phẩm 1 đơn": 2,
          "Trạng Thái Đơn Hàng": "pending",
        },
      },
    ]);

    const updateResult = await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-2",
        data: {
          "Mã đơn hàng": "SP001",
          "Số lượng sản phẩm 1 đơn": 3,
          "Trạng Thái Đơn Hàng": "shipped",
        },
      },
    ]);

    expect(updateResult.updated).toBe(1);
    const updated = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(updated?.status).toBe("shipped");
    expect(updated?.isActive).toBe(true);

    const deleteResult = await applyOrdersPayload([]);
    expect(deleteResult.softDeleted).toBe(1);

    const softDeleted = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(softDeleted?.isActive).toBe(false);
    expect(softDeleted?.deletedAt).not.toBeNull();
  });

  it("recognizes unchanged orders that shifted sheet position, without updating them", async () => {
    // Seed a newest-first sheet: SP001 at row 2, SP002 at row 3.
    const first = await applyOrdersPayload([orderRow(2, "hash-sp001", "SP001"), orderRow(3, "hash-sp002", "SP002")]);
    expect(first.inserted).toBe(2);

    // Next cycle: a brand-new SP003 lands at the top (row 2), pushing SP001 to
    // row 3 and SP002 to row 4. Their data (and therefore hashes) are unchanged.
    const second = await applyOrdersPayload([
      orderRow(2, "hash-sp003", "SP003"),
      orderRow(3, "hash-sp001", "SP001"),
      orderRow(4, "hash-sp002", "SP002"),
    ]);

    expect(second.inserted).toBe(1);
    expect(second.updated).toBe(0);
    expect(second.softDeleted).toBe(0);
    expect(second.rowErrors).toEqual([]);

    const sp001 = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    const sp002 = await prisma.order.findFirst({ where: { shopeeOrderId: "SP002" } });
    const sp003 = await prisma.order.findFirst({ where: { shopeeOrderId: "SP003" } });

    // Untouched rows keep their original hash and stored row index, and stay active.
    expect(sp001?.isActive).toBe(true);
    expect(sp001?.rawRowHash).toBe("hash-sp001");
    expect(sp001?.sheetRowIndex).toBe(2);
    expect(sp002?.isActive).toBe(true);
    expect(sp002?.rawRowHash).toBe("hash-sp002");
    expect(sp002?.sheetRowIndex).toBe(3);
    expect(sp003?.isActive).toBe(true);

    expect(await prisma.order.count({ where: { isActive: true } })).toBe(3);
    expect(await prisma.syncLog.count({ where: { changeType: "update" } })).toBe(0);
    expect(await prisma.syncLog.count({ where: { changeType: "delete" } })).toBe(0);
  });

  it("keeps two product lines of the same order as separate rows", async () => {
    // Confirmed against live data: one shopee_order_id can span multiple sheet
    // rows, one per product variant — same order, different "Tên phân loại hàng".
    const result = await applyOrdersPayload([
      orderRow(2, "hash-white", "SP001", "cao su trắng (cặp)"),
      orderRow(3, "hash-black", "SP001", "cao su đen (cặp)"),
    ]);

    expect(result.inserted).toBe(2);
    expect(result.rowErrors).toEqual([]);

    const lines = await prisma.order.findMany({ where: { shopeeOrderId: "SP001" } });
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.categoryName).sort()).toEqual(["cao su trắng (cặp)", "cao su đen (cặp)"].sort());
  });

  it("records a row error instead of throwing when a reappearing order collides with a unique key", async () => {
    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          "Mã đơn hàng": "SP001",
          "Số lượng sản phẩm 1 đơn": 1,
          "Trạng Thái Đơn Hàng": "pending",
        },
      },
    ]);
    await applyOrdersPayload([]);

    const result = await applyOrdersPayload([
      {
        rowIndex: 5,
        hash: "hash-2",
        data: {
          "Mã đơn hàng": "SP001",
          "Số lượng sản phẩm 1 đơn": 1,
          "Trạng Thái Đơn Hàng": "pending",
        },
      },
    ]);

    expect(result.inserted).toBe(0);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].identifier).toBe("5");
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

describe("applyOrdersPayload adopting a Zalo placeholder row", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("replaces a single-line placeholder with the real row, carrying sendStatus/sentAt forward", async () => {
    const sentAt = new Date("2026-06-20T10:00:00.000Z");
    const placeholder = await prisma.order.create({
      data: {
        shopeeOrderId: "SP001",
        categoryName: "",
        trackingCode: "SPXVN001",
        status: "Chưa đồng bộ",
        sendStatus: "sent",
        sentAt,
        isPlaceholder: true,
        rawRowHash: "zalo-placeholder",
        sheetRowIndex: 0,
      },
    });

    const result = await applyOrdersPayload([orderRow(2, "hash-1", "SP001", "D100")]);

    expect(result.inserted).toBe(1);
    const stale = await prisma.order.findUnique({ where: { id: placeholder.id } });
    expect(stale).toBeNull();

    const real = await prisma.order.findFirst({ where: { shopeeOrderId: "SP001" } });
    expect(real?.isPlaceholder).toBe(false);
    expect(real?.categoryName).toBe("D100");
    expect(real?.status).toBe("pending");
    expect(real?.sendStatus).toBe("sent");
    expect(real?.sentAt?.toISOString()).toBe(sentAt.toISOString());
  });

  it("carries sendStatus/sentAt onto every line of a multi-line order, not just the first", async () => {
    const sentAt = new Date("2026-06-20T10:00:00.000Z");
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP002",
        categoryName: "",
        status: "Chưa đồng bộ",
        sendStatus: "sent",
        sentAt,
        isPlaceholder: true,
        rawRowHash: "zalo-placeholder",
        sheetRowIndex: 0,
      },
    });

    await applyOrdersPayload([
      orderRow(2, "hash-1", "SP002", "D100"),
      orderRow(3, "hash-2", "SP002", "D120"),
    ]);

    const lines = await prisma.order.findMany({ where: { shopeeOrderId: "SP002" } });
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.sendStatus === "sent")).toBe(true);
    expect(lines.every((line) => line.sentAt?.toISOString() === sentAt.toISOString())).toBe(true);
  });

  it("carries forward a manual note/luanCheck set on the placeholder before it synced", async () => {
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP003",
        categoryName: "",
        status: "Chưa đồng bộ",
        sendStatus: "sent",
        sentAt: new Date(),
        note: "khách hối gấp",
        luanCheck: true,
        isPlaceholder: true,
        rawRowHash: "zalo-placeholder",
        sheetRowIndex: 0,
      },
    });

    await applyOrdersPayload([orderRow(2, "hash-1", "SP003", "D100")]);

    const real = await prisma.order.findFirst({ where: { shopeeOrderId: "SP003" } });
    expect(real?.note).toBe("khách hối gấp");
    expect(real?.luanCheck).toBe(true);
  });

  it("does not touch a real (non-placeholder) row for an unrelated order", async () => {
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP004",
        categoryName: "D100",
        status: "Hoàn thành",
        rawRowHash: "real-seed",
        sheetRowIndex: 9,
      },
    });

    await applyOrdersPayload([orderRow(2, "hash-1", "SP005", "D100")]);

    const untouched = await prisma.order.findFirst({ where: { shopeeOrderId: "SP004" } });
    expect(untouched?.status).toBe("Hoàn thành");
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

function cancellationRow(rowIndex: number, hash: string, orderId: string, buyerNote: string): IncomingRow {
  return {
    rowIndex,
    hash,
    data: {
      "Mã đơn hàng": orderId,
      "Nhận xét từ Người mua": buyerNote,
      "Trạng Thái Đơn Hàng": "Đã hủy",
    },
  };
}

describe("applyCancelledPayload / applyDeliveryFailedPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.cancellation.deleteMany();
  });

  it("inserts and updates a cancellation row scoped to its type", async () => {
    const inserted = await applyCancelledPayload([cancellationRow(2, "hash-1", "SP001", "buyer changed mind")]);
    expect(inserted.inserted).toBe(1);

    const updated = await applyCancelledPayload([cancellationRow(2, "hash-2", "SP001", "buyer changed mind, confirmed")]);
    expect(updated.updated).toBe(1);

    const rows = await prisma.cancellation.findMany({ where: { shopeeOrderId: "SP001", isActive: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("cancelled");
    expect(rows[0].buyerNote).toBe("buyer changed mind, confirmed");
  });

  it("keeps the same order id independent across different cancellation types", async () => {
    // The same order can legitimately appear on both the "cancelled" and
    // "delivery_failed" sheet tabs (e.g. re-shipped after a failed attempt,
    // then separately cancelled) — the two sync paths must not collide.
    await applyCancelledPayload([cancellationRow(2, "hash-1", "SP001", "cancelled by buyer")]);
    await applyDeliveryFailedPayload([cancellationRow(2, "hash-1", "SP001", "recipient unreachable")]);

    const rows = await prisma.cancellation.findMany({ where: { shopeeOrderId: "SP001", isActive: true } });
    expect(rows).toHaveLength(2);
    const types = rows.map((row) => row.type).sort();
    expect(types).toEqual(["cancelled", "delivery_failed"]);
  });

  it("soft-deletes a cancellation row that disappears from its tab", async () => {
    await applyCancelledPayload([cancellationRow(2, "hash-1", "SP001", "cancelled by buyer")]);
    const result = await applyCancelledPayload([]);
    expect(result.softDeleted).toBe(1);

    const row = await prisma.cancellation.findFirst({ where: { shopeeOrderId: "SP001", type: "cancelled" } });
    expect(row?.isActive).toBe(false);
  });

  afterAll(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.cancellation.deleteMany();
    await prisma.$disconnect();
  });
});

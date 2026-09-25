import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyWaybillConfirmation } from "@/lib/zalo/poller";
import type { WaybillOrder } from "@/lib/zalo/parseWaybill";

function order(shopeeOrderId: string, trackingCode: string | null = null): WaybillOrder {
  return { shopeeOrderId, trackingCode };
}

describe("applyWaybillConfirmation", () => {
  beforeEach(async () => {
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("marks every order line matching a given shopeeOrderId as sent, and logs the confirmation", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "SP001", categoryName: "D100", status: "pending", rawRowHash: "h1", sheetRowIndex: 1 },
    });
    await prisma.order.create({
      data: { shopeeOrderId: "SP001", categoryName: "D120", status: "pending", rawRowHash: "h2", sheetRowIndex: 2 },
    });
    const confirmedAt = new Date("2026-06-25T10:00:00.000Z");

    const result = await applyWaybillConfirmation({
      orders: [order("SP001")],
      confirmedAt,
      confirmedByName: "Nhập thủ công",
      pdfUrl: "upload:waybill.pdf",
      threadId: "manual",
    });

    expect(result.matchedCount).toBe(2);
    expect(result.createdCount).toBe(0);
    const orders = await prisma.order.findMany({ where: { shopeeOrderId: "SP001" } });
    expect(orders.every((o) => o.sendStatus === "sent")).toBe(true);
    expect(orders.every((o) => o.sentAt?.toISOString() === confirmedAt.toISOString())).toBe(true);

    const log = await prisma.zaloConfirmationLog.findFirst({ where: { threadId: "manual" } });
    expect(log?.matchedCount).toBe(2);
    expect(log?.orderIds).toEqual(["SP001"]);
    expect(log?.confirmedByName).toBe("Nhập thủ công");
    expect(log?.pdfUrl).toBe("upload:waybill.pdf");
  });

  it("creates a placeholder row for an order the PDF names that hasn't synced in yet", async () => {
    const confirmedAt = new Date("2026-06-25T10:00:00.000Z");

    const result = await applyWaybillConfirmation({
      orders: [order("SP-NEW", "SPXVN999")],
      confirmedAt,
      confirmedByName: "Nhập thủ công",
      pdfUrl: "https://example.com/waybill.pdf",
      threadId: "manual",
    });

    expect(result.matchedCount).toBe(0);
    expect(result.createdCount).toBe(1);

    const placeholder = await prisma.order.findFirst({ where: { shopeeOrderId: "SP-NEW" } });
    expect(placeholder?.isPlaceholder).toBe(true);
    expect(placeholder?.trackingCode).toBe("SPXVN999");
    expect(placeholder?.categoryName).toBe("");
    expect(placeholder?.sendStatus).toBe("sent");
    expect(placeholder?.sentAt?.toISOString()).toBe(confirmedAt.toISOString());

    const log = await prisma.zaloConfirmationLog.findFirst({ where: { threadId: "manual" } });
    expect(log?.matchedCount).toBe(1);
  });

  it("does not create a duplicate placeholder for an order that already has one", async () => {
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP-DUP",
        categoryName: "",
        status: "Chưa đồng bộ",
        isPlaceholder: true,
        rawRowHash: "zalo-placeholder",
        sheetRowIndex: 0,
      },
    });

    const result = await applyWaybillConfirmation({
      orders: [order("SP-DUP")],
      confirmedAt: new Date(),
      confirmedByName: null,
      pdfUrl: "https://example.com/waybill.pdf",
      threadId: "manual",
    });

    expect(result.createdCount).toBe(0);
    expect(await prisma.order.count({ where: { shopeeOrderId: "SP-DUP" } })).toBe(1);
  });

  afterAll(async () => {
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

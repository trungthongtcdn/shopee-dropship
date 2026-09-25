import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyWaybillConfirmation } from "@/lib/zalo/poller";

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
      orderIds: ["SP001", "SP999-does-not-exist"],
      confirmedAt,
      confirmedByName: "Nhập thủ công",
      pdfUrl: "upload:waybill.pdf",
      threadId: "manual",
    });

    expect(result.matchedCount).toBe(2);
    const orders = await prisma.order.findMany({ where: { shopeeOrderId: "SP001" } });
    expect(orders.every((o) => o.sendStatus === "sent")).toBe(true);
    expect(orders.every((o) => o.sentAt?.toISOString() === confirmedAt.toISOString())).toBe(true);

    const log = await prisma.zaloConfirmationLog.findFirst({ where: { threadId: "manual" } });
    expect(log?.matchedCount).toBe(2);
    expect(log?.orderIds).toEqual(["SP001", "SP999-does-not-exist"]);
    expect(log?.confirmedByName).toBe("Nhập thủ công");
    expect(log?.pdfUrl).toBe("upload:waybill.pdf");
  });

  it("still logs the confirmation even when no order matches", async () => {
    const result = await applyWaybillConfirmation({
      orderIds: ["SP-UNKNOWN"],
      confirmedAt: new Date(),
      confirmedByName: null,
      pdfUrl: "https://example.com/waybill.pdf",
      threadId: "manual",
    });

    expect(result.matchedCount).toBe(0);
    const log = await prisma.zaloConfirmationLog.findFirst({ where: { threadId: "manual" } });
    expect(log?.matchedCount).toBe(0);
  });

  afterAll(async () => {
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

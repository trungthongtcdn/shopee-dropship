import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { receiptLabelFor, receiptStatusFor, loadReceiptLabels, loadReceiptStatuses } from "@/lib/cancellation/receiptStatus";

describe("receiptLabelFor", () => {
  it("is blank when nobody has entered a receipt", () => {
    expect(receiptLabelFor([])).toBe("");
    expect(receiptLabelFor([null])).toBe("");
  });

  it("says Đã nhận for a fully received order", () => {
    expect(receiptLabelFor(["received_full"])).toBe("Đã nhận");
    expect(receiptLabelFor(["received_full", "received_full"])).toBe("Đã nhận");
  });

  it("keeps the other explicit statuses visible with the report's wording", () => {
    expect(receiptLabelFor(["received_partial"])).toBe("Nhận thiếu");
    expect(receiptLabelFor(["not_received"])).toBe("Chưa nhận");
    expect(receiptLabelFor(["not_needed"])).toBe("Không cần nhận");
  });

  it("stays blank while any line of a multi-line order is still empty (same rule as the overdue warning)", () => {
    expect(receiptLabelFor(["received_full", null])).toBe("");
  });

  it("shows the least complete status when the lines disagree", () => {
    expect(receiptLabelFor(["received_full", "received_partial"])).toBe("Nhận thiếu");
    expect(receiptLabelFor(["received_full", "not_received"])).toBe("Chưa nhận");
  });
});

describe("loadReceiptLabels", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  async function seedLine(shopeeOrderId: string, categoryName: string, extra: Record<string, unknown> = {}) {
    return prisma.order.create({
      data: { shopeeOrderId, categoryName, status: "Hoàn thành", rawRowHash: "seed", sheetRowIndex: 1, ...extra },
    });
  }

  it("labels each asked order from its lines and leaves unknown / unreceived ones out", async () => {
    await seedLine("R1", "A", { cancelReceiptStatus: "received_full", cancelReceivedAt: new Date() });
    await seedLine("R2", "A", { cancelReceiptStatus: "received_full" });
    await seedLine("R2", "B"); // second line still empty -> blank
    await seedLine("R3", "A"); // nothing entered
    await seedLine("R4", "A", { cancelReceiptStatus: "received_full", isActive: false }); // retired line ignored

    const labels = await loadReceiptLabels(["R1", "R2", "R3", "R4", "NOPE"]);

    expect(labels.get("R1")).toBe("Đã nhận");
    expect(labels.get("R2")).toBeUndefined();
    expect(labels.get("R3")).toBeUndefined();
    expect(labels.get("R4")).toBeUndefined();
    expect(labels.get("NOPE")).toBeUndefined();
  });

  it("does nothing for an empty list", async () => {
    expect((await loadReceiptLabels([])).size).toBe(0);
  });
});

describe("receiptStatusFor", () => {
  it("is null while nothing is entered, or while any line is still empty", () => {
    expect(receiptStatusFor([])).toBeNull();
    expect(receiptStatusFor([null])).toBeNull();
    expect(receiptStatusFor(["received_full", null])).toBeNull();
  });

  it("is the least complete status present", () => {
    expect(receiptStatusFor(["received_full"])).toBe("received_full");
    expect(receiptStatusFor(["received_full", "received_partial"])).toBe("received_partial");
    expect(receiptStatusFor(["received_full", "not_received"])).toBe("not_received");
    expect(receiptStatusFor(["not_needed"])).toBe("not_needed");
  });
});

describe("loadReceiptStatuses", () => {
  beforeEach(async () => {
    await prisma.order.deleteMany();
  });

  it("maps each asked order to its status and leaves unresolved ones out", async () => {
    const seed = (id: string, categoryName: string, extra: Record<string, unknown> = {}) =>
      prisma.order.create({ data: { shopeeOrderId: id, categoryName, status: "Hoàn thành", rawRowHash: "seed", sheetRowIndex: 1, ...extra } });
    await seed("T1", "A", { cancelReceiptStatus: "received_full" });
    await seed("T2", "A", { cancelReceiptStatus: "not_needed" });
    await seed("T3", "A", { cancelReceiptStatus: "received_full" });
    await seed("T3", "B");
    await seed("T4", "A");

    const statuses = await loadReceiptStatuses(["T1", "T2", "T3", "T4", "NOPE"]);

    expect(Object.fromEntries(statuses)).toEqual({ T1: "received_full", T2: "not_needed" });
    expect((await loadReceiptStatuses([])).size).toBe(0);
  });
});

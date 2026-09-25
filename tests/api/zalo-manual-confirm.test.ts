import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

vi.mock("@/lib/zalo/parseWaybill", () => ({
  extractOrderIdsFromWaybillPdf: vi.fn(async () => ["SP001"]),
  downloadAndExtractOrderIds: vi.fn(async (url: string) => (url.includes("empty") ? [] : ["SP002"])),
}));

import { POST } from "@/app/api/zalo/manual-confirm/route";

function makeFormRequest(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value as string | Blob);
  }
  return new NextRequest("http://localhost/api/zalo/manual-confirm", { method: "POST", body: form });
}

describe("POST /api/zalo/manual-confirm", () => {
  beforeEach(async () => {
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("accepts a pdfUrl and marks the matching order sent", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "SP002", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });

    const response = await POST(
      makeFormRequest({ pdfUrl: "https://example.com/waybill.pdf", sentAt: "2026-06-25T10:00" })
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.matchedCount).toBe(1);
    expect(json.orderIds).toEqual(["SP002"]);

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP002" } });
    expect(order?.sendStatus).toBe("sent");

    const log = await prisma.zaloConfirmationLog.findFirst({ where: { threadId: "manual" } });
    expect(log?.pdfUrl).toBe("https://example.com/waybill.pdf");
    expect(log?.confirmedByName).toBe("Nhập thủ công");
  });

  it("accepts an uploaded file instead of a url", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "SP001", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });
    const file = new File([new Uint8Array([1, 2, 3])], "waybill.pdf", { type: "application/pdf" });

    const response = await POST(makeFormRequest({ pdfFile: file, sentAt: "2026-06-25T10:00" }));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.orderIds).toEqual(["SP001"]);

    const log = await prisma.zaloConfirmationLog.findFirst({ where: { threadId: "manual" } });
    expect(log?.pdfUrl).toBe("upload:waybill.pdf");
  });

  it("rejects when neither url nor file is given", async () => {
    const response = await POST(makeFormRequest({ sentAt: "2026-06-25T10:00" }));
    expect(response.status).toBe(400);
  });

  it("rejects a missing sentAt", async () => {
    const response = await POST(makeFormRequest({ pdfUrl: "https://example.com/waybill.pdf" }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid sentAt", async () => {
    const response = await POST(
      makeFormRequest({ pdfUrl: "https://example.com/waybill.pdf", sentAt: "not-a-date" })
    );
    expect(response.status).toBe(400);
  });

  it("returns 422 when no order ids are found in the pdf", async () => {
    const response = await POST(
      makeFormRequest({ pdfUrl: "https://example.com/empty.pdf", sentAt: "2026-06-25T10:00" })
    );
    expect(response.status).toBe(422);
  });

  afterAll(async () => {
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

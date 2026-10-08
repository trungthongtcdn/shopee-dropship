import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { makePdf, pageWidths } from "../waybill/pdfFixture";

// downloadWaybillPdf hands back a real (1-page) PDF so the re-ordered copy can
// actually be built; what parseWaybillPdf "finds" in it is chosen by the url the
// test asked for (or "SP001" for an upload, which never goes through a url).
let requestedUrl: string | null = null;
vi.mock("@/lib/zalo/parseWaybill", () => ({
  downloadWaybillPdf: vi.fn(async (url: string) => {
    requestedUrl = url;
    const { makePdf } = await import("../waybill/pdfFixture");
    return makePdf(1);
  }),
  parseWaybillPdf: vi.fn(async () => {
    if (requestedUrl?.includes("empty")) return { orders: [], pages: [] };
    const orderId = requestedUrl ? "SP002" : "SP001";
    return {
      orders: [{ shopeeOrderId: orderId, trackingCode: null }],
      pages: [
        {
          pageIndex: 0,
          shopeeOrderId: orderId,
          trackingCode: null,
          declaredTotalQuantity: 1,
          items: [{ name: "Ghế", variant: "Đen", quantity: 1 }],
        },
      ],
    };
  }),
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
    requestedUrl = null;
    await prisma.waybillFile.deleteMany();
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
    const file = new File([new Uint8Array(await makePdf(1))], "waybill.pdf", { type: "application/pdf" });

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

  it("keeps a grouped Excel and a re-ordered PDF for a pasted link, but not a copy of the original (the link still opens it)", async () => {
    const response = await POST(makeFormRequest({ pdfUrl: "https://example.com/waybill.pdf", sentAt: "2026-06-25T10:00" }));
    const json = await response.json();
    expect([json.hasExcel, json.hasSortedPdf]).toEqual([true, true]);

    const log = await prisma.zaloConfirmationLog.findFirstOrThrow({ where: { threadId: "manual" } });
    const file = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(file.xlsxName).toMatch(/^danh-sach-don-gom-nhom-\d{8}-\d{4}\.xlsx$/);
    expect(file.sortedPdfName).toMatch(/^danh-sach-don-gom-nhom-\d{8}-\d{4}\.pdf$/);
    expect(await pageWidths(file.sortedPdfData!)).toEqual([101]);
    expect(file.pdfData).toBeNull();
  });

  it("keeps the Excel, the re-ordered PDF and the original bytes for an uploaded file, since an upload has no URL", async () => {
    const bytes = await makePdf(1);
    const file = new File([new Uint8Array(bytes)], "waybill.pdf", { type: "application/pdf" });

    const response = await POST(makeFormRequest({ pdfFile: file, sentAt: "2026-06-25T10:00" }));
    const json = await response.json();
    expect([json.hasExcel, json.hasSortedPdf]).toEqual([true, true]);

    const log = await prisma.zaloConfirmationLog.findFirstOrThrow({ where: { threadId: "manual" } });
    const stored = await prisma.waybillFile.findUniqueOrThrow({ where: { confirmationLogId: log.id } });
    expect(stored.pdfName).toBe("waybill.pdf");
    expect(Buffer.from(stored.pdfData!).equals(bytes)).toBe(true);
    expect(stored.sortedPdfData).not.toBeNull();
  });

  it("returns 422 when no order ids are found in the pdf", async () => {
    const response = await POST(
      makeFormRequest({ pdfUrl: "https://example.com/empty.pdf", sentAt: "2026-06-25T10:00" })
    );
    expect(response.status).toBe(422);
    expect(await prisma.waybillFile.count()).toBe(0);
  });

  afterAll(async () => {
    await prisma.waybillFile.deleteMany();
    await prisma.zaloConfirmationLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

// tests/api/reconcile-upload.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { POST } from "@/app/api/reconcile/upload/route";
import { prisma } from "@/lib/db";

function bufferFromRows(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer" }) as Buffer;
}

function makeUploadRequest(buffer: Buffer) {
  const formData = new FormData();
  formData.append("file", new File([new Uint8Array(buffer)], "reconcile.xlsx"));
  return new NextRequest("http://localhost/api/reconcile/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/reconcile/upload", () => {
  beforeEach(async () => {
    await prisma.reconciliationResult.deleteMany();
    await prisma.reconciliationBatch.deleteMany();
    await prisma.order.deleteMany();
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP001",
        sku: "SKU1",
        productName: "P1",
        quantity: 1,
        unitPrice: 20000,
        totalAmount: 20000,
        status: "completed",
        rawRowHash: "h1",
        sheetRowIndex: 2,
      },
    });
  });

  it("creates a batch and matches rows", async () => {
    const buffer = bufferFromRows([{ shopee_order_id: "SP001", amount: 20000, status: "completed" }]);

    const response = await POST(makeUploadRequest(buffer));
    expect(response.status).toBe(200);
    const json = await response.json();

    const results = await prisma.reconciliationResult.findMany({ where: { batchId: json.batchId } });
    expect(results).toHaveLength(1);
    expect(results[0].matchStatus).toBe("matched");

    const batch = await prisma.reconciliationBatch.findUnique({ where: { id: json.batchId } });
    expect(batch?.status).toBe("done");
  });

  it("rejects a file missing required columns", async () => {
    const buffer = bufferFromRows([{ foo: "bar" }]);
    const response = await POST(makeUploadRequest(buffer));
    expect(response.status).toBe(400);
  });

  it("rejects a non-excel buffer without creating a batch", async () => {
    const response = await POST(makeUploadRequest(Buffer.from("not an excel file")));
    expect(response.status).toBe(400);
    expect(await prisma.reconciliationBatch.count()).toBe(0);
  });

  it("rejects a corrupt spreadsheet the parser throws on, without creating a batch", async () => {
    // Legacy .xls (OLE/CFB) magic bytes followed by nothing: the parser throws
    // rather than returning a result, which used to escape as a 500 the client
    // could not read.
    const corrupt = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);

    const response = await POST(makeUploadRequest(corrupt));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "could not parse file" });
    expect(await prisma.reconciliationBatch.count()).toBe(0);
  });

  afterAll(async () => {
    // Leave the database as this file found it: tests/schema.test.ts asserts
    // empty tables, so an order row surviving this file makes the suite
    // order-dependent. Same cleanup pattern as tests/sync/apply.test.ts.
    await prisma.reconciliationResult.deleteMany();
    await prisma.reconciliationBatch.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

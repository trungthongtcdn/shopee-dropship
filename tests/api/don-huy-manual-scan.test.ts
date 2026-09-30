import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/don-huy/manual-scan/route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/don-huy/manual-scan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/don-huy/manual-scan", () => {
  beforeEach(async () => {
    await prisma.zaloCancelReceiptLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("matches scanned codes and marks the order received_full by default", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "260625MB6WJXKM", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });

    const response = await POST(
      makeRequest({ codes: ["260625MB6WJXKM"], confirmedAt: "2026-06-25T10:00:00.000Z", cancelReceiptStatus: "received_full" })
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.matchedCount).toBe(1);

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "260625MB6WJXKM" } });
    expect(order?.cancelReceiptStatus).toBe("received_full");
    expect(order?.cancelReceivedAt?.toISOString()).toBe("2026-06-25T10:00:00.000Z");

    const log = await prisma.zaloCancelReceiptLog.findFirst({ where: { threadId: "manual-scan" } });
    expect(log?.confirmedByName).toBe("Quét mã thủ công");
  });

  it("applies a non-default cancelReceiptStatus", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "260625AAAAAAAA", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });

    await POST(
      makeRequest({ codes: ["260625AAAAAAAA"], confirmedAt: "2026-06-25T10:00:00.000Z", cancelReceiptStatus: "not_needed" })
    );

    const order = await prisma.order.findFirst({ where: { shopeeOrderId: "260625AAAAAAAA" } });
    expect(order?.cancelReceiptStatus).toBe("not_needed");
  });

  it("extracts and dedupes codes found inside noisy scanned text", async () => {
    await prisma.order.create({
      data: { shopeeOrderId: "260625BBBBBBBB", categoryName: "D100", status: "pending", rawRowHash: "h", sheetRowIndex: 1 },
    });

    const response = await POST(
      makeRequest({
        codes: ["  260625bbbbbbbb  ", "260625BBBBBBBB"],
        confirmedAt: "2026-06-25T10:00:00.000Z",
        cancelReceiptStatus: "received_full",
      })
    );
    const json = await response.json();
    expect(json.codes).toEqual(["260625BBBBBBBB"]);
    expect(json.matchedCount).toBe(1);
  });

  it("rejects an empty codes array", async () => {
    const response = await POST(makeRequest({ codes: [], confirmedAt: "2026-06-25T10:00:00.000Z", cancelReceiptStatus: "received_full" }));
    expect(response.status).toBe(400);
  });

  it("rejects an invalid cancelReceiptStatus", async () => {
    const response = await POST(
      makeRequest({ codes: ["260625MB6WJXKM"], confirmedAt: "2026-06-25T10:00:00.000Z", cancelReceiptStatus: "bogus" })
    );
    expect(response.status).toBe(400);
  });

  it("rejects a missing confirmedAt", async () => {
    const response = await POST(makeRequest({ codes: ["260625MB6WJXKM"], cancelReceiptStatus: "received_full" }));
    expect(response.status).toBe(400);
  });

  it("returns 422 when none of the given codes look like a real order/tracking code", async () => {
    const response = await POST(
      makeRequest({ codes: ["not a code at all"], confirmedAt: "2026-06-25T10:00:00.000Z", cancelReceiptStatus: "received_full" })
    );
    expect(response.status).toBe(422);
  });

  afterAll(async () => {
    await prisma.zaloCancelReceiptLog.deleteMany();
    await prisma.order.deleteMany();
    await prisma.$disconnect();
  });
});

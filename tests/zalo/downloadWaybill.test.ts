import { describe, it, expect, afterEach, vi } from "vitest";
import { downloadWaybillPdf } from "@/lib/zalo/parseWaybill";
import { MAX_WAYBILL_BYTES, WaybillTooLargeError, assertWaybillSize } from "@/lib/zalo/waybillLimits";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response) {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

function streamOf(totalBytes: number, chunkBytes = 1024 * 1024): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) return controller.close();
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

describe("downloadWaybillPdf", () => {
  it("returns the bytes of a normal file", async () => {
    stubFetch(new Response(new Uint8Array([1, 2, 3, 4])));
    expect([...(await downloadWaybillPdf("https://cdn.example/a.pdf"))]).toEqual([1, 2, 3, 4]);
  });

  it("refuses a file whose declared length is over the cap, without reading it", async () => {
    stubFetch(new Response(streamOf(1024), { headers: { "content-length": String(MAX_WAYBILL_BYTES + 1) } }));
    await expect(downloadWaybillPdf("https://cdn.example/a.pdf")).rejects.toMatchObject({
      name: "WaybillTooLargeError",
      found: "30,0 MB",
    });
  });

  it("stops a stream that outgrows the cap even when it declares no length", async () => {
    stubFetch(new Response(streamOf(MAX_WAYBILL_BYTES + 2 * 1024 * 1024)));
    const error = await downloadWaybillPdf("https://cdn.example/a.pdf").catch((e) => e);
    expect(error).toBeInstanceOf(WaybillTooLargeError);
  });

  it("still reports an HTTP error as a plain error, not a size problem", async () => {
    stubFetch(new Response("gone", { status: 404 }));
    const error = await downloadWaybillPdf("https://cdn.example/a.pdf").catch((e) => e);
    expect(error).not.toBeInstanceOf(WaybillTooLargeError);
    expect(String(error.message)).toContain("404");
  });
});

describe("assertWaybillSize", () => {
  const parsed = (labels: number) => ({ orders: [], pages: [], labelCount: labels });

  it("accepts up to 1000 labels and names the count above that", () => {
    expect(() => assertWaybillSize(parsed(1000))).not.toThrow();
    expect(() => assertWaybillSize(parsed(1001))).toThrowError(WaybillTooLargeError);
    try {
      assertWaybillSize(parsed(1200));
    } catch (error) {
      expect((error as WaybillTooLargeError).found).toBe("1200 phiếu");
    }
  });
});

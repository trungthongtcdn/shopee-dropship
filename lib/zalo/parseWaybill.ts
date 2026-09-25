import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

export interface WaybillOrder {
  shopeeOrderId: string;
  trackingCode: string | null;
}

// Pure text-extraction — kept separate from the PDF/shell-out plumbing below
// so it can be unit tested with plain strings, no real PDF required.
//
// Each waybill page has exactly one "Mã vận đơn:" line immediately followed
// by one "Mã đơn hàng:" line (confirmed against a real sample PDF — see
// tests/zalo/parseWaybill.test.ts), so the two match lists line up 1:1 by
// position across the whole document; trackingCode is null only if a page
// is missing its tracking-code line (shouldn't happen on a real waybill).
export function extractOrdersFromWaybillText(text: string): WaybillOrder[] {
  const trackingCodes = [...text.matchAll(/Mã vận đơn:\s*(\S+)/g)].map((match) => match[1]);
  const shopeeOrderIds = [...text.matchAll(/Mã đơn hàng:\s*(\S+)/g)].map((match) => match[1]);
  return shopeeOrderIds.map((shopeeOrderId, i) => ({ shopeeOrderId, trackingCode: trackingCodes[i] ?? null }));
}

export function extractOrderIdsFromWaybillText(text: string): string[] {
  return extractOrdersFromWaybillText(text).map((order) => order.shopeeOrderId);
}

// Shells out to `pdftotext -layout` (poppler-utils) rather than a JS PDF
// library: tried pdf-parse first, but its text extraction does not preserve
// the label/value reading order on this waybill layout ("Mã vận đơn:" and
// "Mã đơn hàng:" values came out scrambled) — pdftotext -layout reproduces
// the visual left-to-right order faithfully, which this regex depends on.
export async function extractOrdersFromWaybillPdf(buffer: Buffer): Promise<WaybillOrder[]> {
  const tmpPath = path.join(tmpdir(), `waybill-${randomUUID()}.pdf`);
  await writeFile(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", tmpPath, "-"]);
    return extractOrdersFromWaybillText(stdout);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function extractOrderIdsFromWaybillPdf(buffer: Buffer): Promise<string[]> {
  return (await extractOrdersFromWaybillPdf(buffer)).map((order) => order.shopeeOrderId);
}

export async function downloadAndExtractOrders(pdfUrl: string): Promise<WaybillOrder[]> {
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to download waybill PDF: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return extractOrdersFromWaybillPdf(buffer);
}

export async function downloadAndExtractOrderIds(pdfUrl: string): Promise<string[]> {
  return (await downloadAndExtractOrders(pdfUrl)).map((order) => order.shopeeOrderId);
}

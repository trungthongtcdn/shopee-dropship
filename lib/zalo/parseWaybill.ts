import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extractWaybillPagesFromText, type WaybillPage } from "@/lib/waybill/items";

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
async function pdfToText(buffer: Buffer): Promise<string> {
  const tmpPath = path.join(tmpdir(), `waybill-${randomUUID()}.pdf`);
  await writeFile(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", tmpPath, "-"], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function extractOrdersFromWaybillPdf(buffer: Buffer): Promise<WaybillOrder[]> {
  return extractOrdersFromWaybillText(await pdfToText(buffer));
}

export async function extractOrderIdsFromWaybillPdf(buffer: Buffer): Promise<string[]> {
  return (await extractOrdersFromWaybillPdf(buffer)).map((order) => order.shopeeOrderId);
}

export interface ParsedWaybill {
  // What the confirmation flow acts on (order id + tracking code per page).
  orders: WaybillOrder[];
  // The same pages with their product lines, for the grouped Excel.
  pages: WaybillPage[];
}

// One pdftotext run feeds both readings of the document.
export async function parseWaybillPdf(buffer: Buffer): Promise<ParsedWaybill> {
  const text = await pdfToText(buffer);
  return { orders: extractOrdersFromWaybillText(text), pages: extractWaybillPagesFromText(text) };
}

export async function downloadWaybillPdf(pdfUrl: string): Promise<Buffer> {
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to download waybill PDF: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

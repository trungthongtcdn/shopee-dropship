import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { countLabels, extractWaybillPagesFromText, findOrderId, type WaybillPage } from "@/lib/waybill/items";
import { extractTiledLabels, looksTiled, parseBboxXml, type SheetLayout } from "@/lib/waybill/layout";
import { hasOrderInfoHeading } from "@/lib/waybill/orderInfo";
import { MAX_WAYBILL_BYTES, WaybillTooLargeError, megabytes } from "@/lib/zalo/waybillLimits";

const execFileAsync = promisify(execFile);

export interface WaybillOrder {
  shopeeOrderId: string;
  trackingCode: string | null;
}

// Pure text-extraction — kept separate from the PDF/shell-out plumbing below
// so it can be unit tested with plain strings, no real PDF required.
//
// A waybill page has one "Mã vận đơn:" line and, right under it, one "Mã đơn hàng:"
// line (confirmed against a real sample PDF — see tests/zalo/parseWaybill.test.ts);
// trackingCode is null only if a page is missing its tracking-code line (shouldn't
// happen on a real waybill). Pages are read one at a time (pdftotext ends each with a
// form feed, and a tiled sheet's cell has none), so a page that names no order — or
// a pre-order label, which is not confirmed — can't shift the tracking codes of the
// pages after it. A label with no "Mã đơn hàng:" caption (the drop-off point label
// prints the id bare under the tracking code) is read by findOrderId.
const PRE_ORDER_RE = /Mã đơn đặt trước:/;

function ordersOfPage(page: string): WaybillOrder[] {
  const trackingCodes = [...page.matchAll(/Mã vận đơn:\s*(\S+)/g)].map((match) => match[1]);
  const shopeeOrderIds = [...page.matchAll(/Mã đơn hàng:\s*(\S+)/g)].map((match) => match[1]);
  if (trackingCodes.length === 1 && shopeeOrderIds.length <= 1) {
    if (PRE_ORDER_RE.test(page)) return [];
    const shopeeOrderId = findOrderId(page);
    return shopeeOrderId ? [{ shopeeOrderId, trackingCode: trackingCodes[0] }] : [];
  }
  // Several labels interleaved line by line (a tiled sheet whose grid wasn't found):
  // the two lists run in the same left-to-right order, so they line up by position.
  return shopeeOrderIds.map((shopeeOrderId, i) => ({ shopeeOrderId, trackingCode: trackingCodes[i] ?? null }));
}

export function extractOrdersFromWaybillText(text: string): WaybillOrder[] {
  return text.split("\f").flatMap(ordersOfPage);
}

export function extractOrderIdsFromWaybillText(text: string): string[] {
  return extractOrdersFromWaybillText(text).map((order) => order.shopeeOrderId);
}

// Shells out to `pdftotext` (poppler-utils) rather than a JS PDF library: tried
// pdf-parse first, but its text extraction does not preserve the label/value
// reading order on this waybill layout ("Mã vận đơn:" and "Mã đơn hàng:" values
// came out scrambled) — `-layout` reproduces the visual left-to-right order
// faithfully, which this regex depends on.
async function runPdftotext(buffer: Buffer, flags: string[]): Promise<string> {
  const tmpPath = path.join(tmpdir(), `waybill-${randomUUID()}.pdf`);
  await writeFile(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync("pdftotext", [...flags, tmpPath, "-"], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

const pdfToText = (buffer: Buffer) => runPdftotext(buffer, ["-layout"]);
// Every word with its position — only needed when several labels share a sheet.
const pdfToBboxXml = (buffer: Buffer) => runPdftotext(buffer, ["-bbox"]);

export async function extractOrdersFromWaybillPdf(buffer: Buffer): Promise<WaybillOrder[]> {
  return extractOrdersFromWaybillText(await pdfToText(buffer));
}

export async function extractOrderIdsFromWaybillPdf(buffer: Buffer): Promise<string[]> {
  return (await extractOrdersFromWaybillPdf(buffer)).map((order) => order.shopeeOrderId);
}

export interface ParsedWaybill {
  // What the confirmation flow acts on (order id + tracking code per page).
  orders: WaybillOrder[];
  // The same pages with their product lines, for the grouped Excel. Empty when
  // the document's layout couldn't be read (the confirmation still goes ahead).
  pages: WaybillPage[];
  // How many shipping labels the PDF holds (pages, or cells of a tiled sheet, carrying a
  // tracking code, an order id or the product block). More than `pages.length` means some
  // label wasn't read as an order — the Excel and the Zalo caption then say so.
  labelCount: number;
  // Set when several labels are tiled on each sheet, or when each label has an
  // order-info table under it to be cut off: `pages` are then labels, not PDF pages,
  // and the re-ordered PDF has to be built label by label.
  layout?: SheetLayout;
}

// Both readings of a document's text. A normal waybill PDF has one label per page
// and is read from the `-layout` text alone. A PDF with several labels tiled on a
// sheet (a browser's "N pages per sheet" print) interleaves them line by line in
// that text, so each label is read from its own cell instead (waybill/layout.ts);
// so is one whose labels carry an order-info table (its SKU columns wrap too narrowly
// for plain text, and the PDF is cut above the table). `readBboxXml` is only called
// then. If the grid can't be worked out, the order codes are still taken from the
// whole text — confirming orders must not depend on the grouped files — and for a
// tiled document just `pages` stays empty.
export async function parseWaybillText(text: string, readBboxXml: () => Promise<string>): Promise<ParsedWaybill> {
  const tiledSheets = looksTiled(text);
  const pageLabels = countLabels(text.split("\f"));
  if (!tiledSheets && !hasOrderInfoHeading(text)) {
    return { orders: extractOrdersFromWaybillText(text), pages: extractWaybillPagesFromText(text), labelCount: pageLabels };
  }

  try {
    const tiled = extractTiledLabels(parseBboxXml(await readBboxXml()));
    if (tiled) {
      return {
        orders: tiled.cells.flatMap((cell) => extractOrdersFromWaybillText(cell.text)),
        pages: tiled.labels,
        labelCount: countLabels(tiled.cells.map((cell) => cell.text)),
        layout: tiled.layout,
      };
    }
    if (tiledSheets) console.warn("[waybill] several labels per page but no recognisable grid — grouped files skipped");
  } catch (error) {
    console.error("[waybill] reading tiled labels failed:", error);
  }
  // One label per page whose sheets can't be read by position: as plain text, the
  // order-info table stays in the PDF and the SKUs stay out of the Excel.
  return {
    orders: extractOrdersFromWaybillText(text),
    pages: tiledSheets ? [] : extractWaybillPagesFromText(text),
    labelCount: pageLabels,
  };
}

export async function parseWaybillPdf(buffer: Buffer): Promise<ParsedWaybill> {
  return parseWaybillText(await pdfToText(buffer), () => pdfToBboxXml(buffer));
}

export async function downloadWaybillPdf(pdfUrl: string): Promise<Buffer> {
  const response = await fetch(pdfUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`Failed to download waybill PDF: HTTP ${response.status}`);
  }
  const tooLarge = (bytes: number) =>
    new WaybillTooLargeError(`Waybill PDF is larger than ${MAX_WAYBILL_BYTES} bytes`, megabytes(bytes));

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WAYBILL_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge(declared);
  }

  // Counted while it streams in, so a link that lies about (or hides) its length can't fill the memory.
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_WAYBILL_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge(received);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, received);
}

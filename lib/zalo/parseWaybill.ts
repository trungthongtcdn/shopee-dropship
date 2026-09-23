import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

// Pure text-extraction — kept separate from the PDF/shell-out plumbing below
// so it can be unit tested with plain strings, no real PDF required.
export function extractOrderIdsFromWaybillText(text: string): string[] {
  return [...text.matchAll(/Mã đơn hàng:\s*(\S+)/g)].map((match) => match[1]);
}

// Shells out to `pdftotext -layout` (poppler-utils) rather than a JS PDF
// library: tried pdf-parse first, but its text extraction does not preserve
// the label/value reading order on this waybill layout ("Mã vận đơn:" and
// "Mã đơn hàng:" values came out scrambled) — pdftotext -layout reproduces
// the visual left-to-right order faithfully, which this regex depends on.
export async function extractOrderIdsFromWaybillPdf(buffer: Buffer): Promise<string[]> {
  const tmpPath = path.join(tmpdir(), `waybill-${randomUUID()}.pdf`);
  await writeFile(tmpPath, buffer);
  try {
    const { stdout } = await execFileAsync("pdftotext", ["-layout", tmpPath, "-"]);
    return extractOrderIdsFromWaybillText(stdout);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

export async function downloadAndExtractOrderIds(pdfUrl: string): Promise<string[]> {
  const response = await fetch(pdfUrl);
  if (!response.ok) {
    throw new Error(`Failed to download waybill PDF: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return extractOrderIdsFromWaybillPdf(buffer);
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, grayscale } from "pdf-lib";
import type { OutputSheet } from "@/lib/waybill/compose";
import { PAGE_MARGIN } from "@/lib/waybill/compose";

const execFileAsync = promisify(execFile);
const LEVELS = 12;
const gray = (id: number) => grayscale((id + 1) / LEVELS);

// One label per page: page i carries a flat gray block (its id) inset from the
// page's edge, like a label with a little white round it.
export async function makeLabelPages(count: number, width = 200, height = 300, inset = 10, weight = 0): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let id = 0; id < count; id++) {
    const page = doc.addPage([width, height]);
    for (let n = 0; n < weight; n++) {
      const a = (n * 2654435761) % 4294967296;
      page.drawRectangle({ x: inset + (a % ((width - 2 * inset) * 10)) / 10, y: inset + ((a >> 7) % ((height - 2 * inset) * 10)) / 10, width: 0.4, height: 0.4, color: grayscale(0.999) });
    }
    page.drawRectangle({ x: inset, y: inset, width: width - 2 * inset, height: height - 2 * inset, color: gray(id) });
  }
  return Buffer.from(await doc.save());
}

// A big blank page with a small label in its top-left corner (a label printed on
// an A4 sheet, say) — the part that must be cut out and scaled, not the page.
export async function makeCornerLabelPdf(id: number, pageWidth = 400, pageHeight = 600, labelWidth = 100, labelHeight = 150): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([pageWidth, pageHeight]);
  page.drawRectangle({ x: 20, y: pageHeight - 20 - labelHeight, width: labelWidth, height: labelHeight, color: gray(id) });
  return Buffer.from(await doc.save());
}

export interface InkCell {
  id: number | null; // which label (its gray level); null when the cell is empty
  box: { x0: number; y0: number; x1: number; y1: number } | null; // the ink, in pt from the top-left of the page
}

function parsePgm(bytes: Buffer) {
  let at = 0;
  const token = () => {
    while (/\s/.test(String.fromCharCode(bytes[at]))) at++;
    let text = "";
    while (!/\s/.test(String.fromCharCode(bytes[at]))) text += String.fromCharCode(bytes[at++]);
    return text;
  };
  token();
  const width = Number(token());
  const height = Number(token());
  token();
  at++;
  return { width, height, pixel: (x: number, y: number) => bytes[at + y * width + x] };
}

// For every page of `pdf`, and every cell of the output grid, what is drawn there:
// the label's id and the box its ink covers. Read from a RENDERED picture, so it
// checks what a person would see — clipping, scaling and centring included.
export async function renderedInk(pdf: Uint8Array, sheet: OutputSheet): Promise<InkCell[][]> {
  const dpi = 36;
  const dir = await mkdtemp(path.join(tmpdir(), "compose-test-"));
  try {
    await writeFile(path.join(dir, "in.pdf"), pdf);
    await execFileAsync("pdftoppm", ["-gray", "-r", String(dpi), path.join(dir, "in.pdf"), path.join(dir, "page")]);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".pgm")).sort();

    const pxPerPt = dpi / 72;
    const cellWidth = (sheet.width - 2 * PAGE_MARGIN) / sheet.cols;
    const cellHeight = (sheet.height - 2 * PAGE_MARGIN) / sheet.rows;
    const pages: InkCell[][] = [];
    for (const file of files) {
      const image = parsePgm(await readFile(path.join(dir, file)));
      const cells: InkCell[] = [];
      for (let cell = 0; cell < sheet.cols * sheet.rows; cell++) {
        const left = Math.floor((PAGE_MARGIN + (cell % sheet.cols) * cellWidth) * pxPerPt);
        const right = Math.ceil((PAGE_MARGIN + ((cell % sheet.cols) + 1) * cellWidth) * pxPerPt);
        const top = Math.floor((PAGE_MARGIN + Math.floor(cell / sheet.cols) * cellHeight) * pxPerPt);
        const bottom = Math.ceil((PAGE_MARGIN + (Math.floor(cell / sheet.cols) + 1) * cellHeight) * pxPerPt);
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let y = top; y < Math.min(bottom, image.height); y++) {
          for (let x = left; x < Math.min(right, image.width); x++) {
            if (image.pixel(x, y) < 245) {
              x0 = Math.min(x0, x);
              y0 = Math.min(y0, y);
              x1 = Math.max(x1, x + 1);
              y1 = Math.max(y1, y + 1);
            }
          }
        }
        if (x1 < x0) {
          cells.push({ id: null, box: null });
          continue;
        }
        const level = Math.round((image.pixel(Math.floor((x0 + x1) / 2), Math.floor((y0 + y1) / 2)) / 255) * LEVELS);
        cells.push({ id: level - 1, box: { x0: x0 / pxPerPt, y0: y0 / pxPerPt, x1: x1 / pxPerPt, y1: y1 / pxPerPt } });
      }
      pages.push(cells);
    }
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const idsOf = (pages: InkCell[][]) => pages.map((cells) => cells.map((cell) => cell.id));

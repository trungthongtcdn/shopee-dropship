import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, grayscale, rgb } from "pdf-lib";
import { SHEET_HEIGHT, SHEET_WIDTH } from "./tiledFixture";

const execFileAsync = promisify(execFile);
const LEVELS = 12;

// Where things are inside a cell, as fractions of its height from the top.
export const LABEL_TOP = 0.04;
export const LABEL_BOTTOM = 0.4;
export const TABLE_TOP = 0.5;
// Halfway between the label and the table: where a cut belongs.
export const CUT = 0.45;

// A tiled PDF whose cells each hold a label (a flat gray of its own, in the top part
// of the cell) with an order-info table under it (a black block running from the cell's
// left edge to its right, in the bottom part) — the picture of "label + SKU table" the
// real prints have. null = empty cell.
export async function makeInfoSheetPdf(cols: number, rows: number, sheets: (number | null)[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const cellWidth = SHEET_WIDTH / cols;
  const cellHeight = SHEET_HEIGHT / rows;
  for (const ids of sheets) {
    const page = doc.addPage([SHEET_WIDTH, SHEET_HEIGHT]);
    ids.forEach((id, cell) => {
      if (id === null) return;
      const left = (cell % cols) * cellWidth;
      const top = SHEET_HEIGHT - Math.floor(cell / cols) * cellHeight;
      page.drawRectangle({
        x: left + 4,
        y: top - LABEL_BOTTOM * cellHeight,
        width: cellWidth - 8,
        height: (LABEL_BOTTOM - LABEL_TOP) * cellHeight,
        color: grayscale((id + 1) / LEVELS),
      });
      page.drawRectangle({
        x: left,
        y: top - cellHeight + 4,
        width: cellWidth,
        height: (1 - TABLE_TOP) * cellHeight - 8,
        color: rgb(0, 0, 0),
      });
    });
  }
  return Buffer.from(await doc.save());
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

export interface CellSample {
  label: number | null; // the label's id, null when its spot is blank
  table: "dark" | "blank";
}

// What a person sees in each cell of each sheet of `pdf`, when the sheets are cut into
// cols × rows cells: the label (sampled in the middle of its part) and the table (in
// the middle of its part). Read from a RENDERED picture, so clipping counts.
export async function renderedCells(pdf: Uint8Array, cols: number, rows: number): Promise<CellSample[][]> {
  const dir = await mkdtemp(path.join(tmpdir(), "info-test-"));
  try {
    await writeFile(path.join(dir, "in.pdf"), pdf);
    await execFileAsync("pdftoppm", ["-gray", "-r", "24", path.join(dir, "in.pdf"), path.join(dir, "page")]);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".pgm")).sort();

    const sheets: CellSample[][] = [];
    for (const file of files) {
      const { width, height, pixel } = parsePgm(await readFile(path.join(dir, file)));
      const cells: CellSample[] = [];
      for (let cell = 0; cell < cols * rows; cell++) {
        const x = Math.floor(((cell % cols) + 0.5) * (width / cols));
        const rowTop = Math.floor(cell / cols) * (height / rows);
        const at = (fraction: number) => pixel(x, Math.floor(rowTop + fraction * (height / rows)));
        const level = Math.round((at((LABEL_TOP + LABEL_BOTTOM) / 2) / 255) * LEVELS);
        cells.push({ label: level >= LEVELS ? null : level - 1, table: at((TABLE_TOP + 1) / 2) < 100 ? "dark" : "blank" });
      }
      sheets.push(cells);
    }
    return sheets;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

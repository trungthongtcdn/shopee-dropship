import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument, grayscale } from "pdf-lib";

const execFileAsync = promisify(execFile);

export const SHEET_WIDTH = 300;
export const SHEET_HEIGHT = 400;
const LEVELS = 12;

// A tiled PDF whose cells can be told apart: each sheet is `ids` laid out row by
// row, and a cell with id n is filled with a flat gray of its own (null = empty,
// i.e. stays white). `weight` adds that many tiny shapes per sheet, to stand in
// for the barcodes/text that make a real sheet hundreds of KB.
export async function makeTiledPdf(cols: number, rows: number, sheets: (number | null)[][], weight = 0): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const cellWidth = SHEET_WIDTH / cols;
  const cellHeight = SHEET_HEIGHT / rows;

  for (const ids of sheets) {
    const page = doc.addPage([SHEET_WIDTH, SHEET_HEIGHT]);
    for (let n = 0; n < weight; n++) {
      // Light gray, so they never read as one of the id levels the tests look for.
      // Pseudo-random positions so the content stream doesn't compress to nothing.
      const a = (n * 2654435761) % 4294967296;
      const b = (n * 40503 + 12345) % 65536;
      page.drawRectangle({ x: (a % 2900) / 10, y: (b % 3900) / 10, width: 1 + (a % 37) / 10, height: 1 + (b % 29) / 10, color: grayscale(0.995) });
    }
    ids.forEach((id, cell) => {
      if (id === null) return;
      page.drawRectangle({
        x: (cell % cols) * cellWidth + 4,
        y: SHEET_HEIGHT - (Math.floor(cell / cols) + 1) * cellHeight + 4,
        width: cellWidth - 8,
        height: cellHeight - 8,
        color: grayscale((id + 1) / LEVELS),
      });
    });
  }
  return Buffer.from(await doc.save());
}

// The ids of the cells of every sheet of `pdf`, read back from a RENDERED image
// (so it checks what a person would see, clipping included). null = blank cell.
export async function renderedCellIds(pdf: Uint8Array, cols: number, rows: number): Promise<(number | null)[][]> {
  const dir = await mkdtemp(path.join(tmpdir(), "tiled-test-"));
  try {
    await writeFile(path.join(dir, "in.pdf"), pdf);
    await execFileAsync("pdftoppm", ["-gray", "-r", "24", path.join(dir, "in.pdf"), path.join(dir, "page")]);
    const files = (await readdir(dir)).filter((name) => name.endsWith(".pgm")).sort();

    const sheets: (number | null)[][] = [];
    for (const file of files) {
      const { width, height, pixel } = parsePgm(await readFile(path.join(dir, file)));
      const ids: (number | null)[] = [];
      for (let cell = 0; cell < cols * rows; cell++) {
        const x = Math.floor(((cell % cols) + 0.5) * (width / cols));
        const y = Math.floor((Math.floor(cell / cols) + 0.5) * (height / rows));
        const level = Math.round((pixel(x, y) / 255) * LEVELS);
        ids.push(level >= LEVELS ? null : level - 1);
      }
      sheets.push(ids);
    }
    return sheets;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function parsePgm(bytes: Buffer) {
  let at = 0;
  const token = () => {
    while (/\s/.test(String.fromCharCode(bytes[at]))) at++;
    let text = "";
    while (!/\s/.test(String.fromCharCode(bytes[at]))) text += String.fromCharCode(bytes[at++]);
    return text;
  };
  token(); // P5
  const width = Number(token());
  const height = Number(token());
  token(); // max value
  at++;
  return { width, height, pixel: (x: number, y: number) => bytes[at + y * width + x] };
}

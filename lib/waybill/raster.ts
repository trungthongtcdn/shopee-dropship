import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// A page as a small grayscale picture, used only to find where on the page the
// ink actually is. 50 dpi is plenty for that and keeps a whole waybill file to a
// few MB of pixels.
export const RASTER_DPI = 50;

export interface PageRaster {
  width: number; // pixels
  height: number;
  pixels: Uint8Array; // 0 = black … 255 = white, row by row from the top-left
}

function parsePgm(bytes: Buffer): PageRaster {
  let at = 0;
  const token = () => {
    while (/\s/.test(String.fromCharCode(bytes[at]))) at++;
    let text = "";
    while (at < bytes.length && !/\s/.test(String.fromCharCode(bytes[at]))) text += String.fromCharCode(bytes[at++]);
    return text;
  };
  if (token() !== "P5") throw new Error("unexpected image format from pdftoppm");
  const width = Number(token());
  const height = Number(token());
  token(); // maximum value (255)
  at++; // the single whitespace byte before the pixels
  return { width, height, pixels: new Uint8Array(bytes.subarray(at, at + width * height)) };
}

// One picture per page of the PDF, in page order (poppler's `pdftoppm`). The PDF
// goes to a private temp directory that is always removed.
export async function rasterizePages(pdf: Buffer): Promise<PageRaster[]> {
  const dir = await mkdtemp(path.join(tmpdir(), "waybill-raster-"));
  try {
    const input = path.join(dir, "in.pdf");
    await writeFile(input, pdf, { mode: 0o600 });
    await execFileAsync("pdftoppm", ["-gray", "-r", String(RASTER_DPI), input, path.join(dir, "p")], { timeout: 60_000 });

    // Files are p-1.pgm … p-10.pgm, zero-padded to the page count's width ("p-01").
    const files = (await readdir(dir))
      .map((name) => ({ name, page: /^p-(\d+)\.pgm$/.exec(name)?.[1] }))
      .filter((file): file is { name: string; page: string } => file.page !== undefined)
      .sort((a, b) => Number(a.page) - Number(b.page));
    return Promise.all(files.map(async (file) => parsePgm(await readFile(path.join(dir, file.name)))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

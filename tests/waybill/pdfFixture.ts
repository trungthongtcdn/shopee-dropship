import { PDFDocument } from "pdf-lib";

// A real, loadable PDF whose pages can be told apart: page i is (101 + i) wide.
export async function makePdf(pageCount: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([101 + i, 200]);
  return Buffer.from(await doc.save());
}

export async function pageWidths(buffer: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(buffer);
  return doc.getPages().map((page) => page.getWidth());
}

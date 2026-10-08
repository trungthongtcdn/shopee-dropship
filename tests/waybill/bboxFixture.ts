// `pdftotext -bbox` output for a Shopee waybill printed several labels to a sheet
// (Letter 612×792, 3×3, 204×264 pt per cell), made up from scratch: positions
// follow a real sheet, the texts are invented (real labels hold customers' data).

const H = 5.27;
const CHAR = 2.6;

interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function line(text: string, x: number, y: number): Word[] {
  let cursor = x;
  return text.split(" ").map((word) => {
    const box = { text: word, x0: cursor, y0: y, x1: cursor + word.length * CHAR, y1: y + H };
    cursor = box.x1 + 1.3;
    return box;
  });
}

export interface LabelSpec {
  id: string;
  tracking: string;
  product: string;
  // "Mã đơn hàng" on a normal label, "Mã đơn đặt trước" on a pre-order one.
  idLabel?: "Mã đơn hàng" | "Mã đơn đặt trước";
}

function label(cellX: number, cellY: number, spec: LabelSpec): Word[] {
  const x = cellX + 13;
  const y = cellY + 3;
  return [
    ...line(`Mã vận đơn: ${spec.tracking}`, x + 85, y + 20),
    ...line(`${spec.idLabel ?? "Mã đơn hàng"}: ${spec.id}`, x + 85, y + 26),
    ...line("Từ: Đến:", x + 4, y + 36),
    ...line("Nội dung hàng (Tổng SL sản phẩm: 1)", x + 4, y + 92),
    ...line(`1. ${spec.product}, V, SL: 1`, x + 4, y + 100),
    ...line("Gọi 1900 6885", x + 4, y + 240),
  ];
}

// One sheet as <page> XML; `labels` run row by row, null leaves a cell empty.
function sheetXml(labels: (LabelSpec | null)[]): string {
  const width = 612;
  const height = 792;
  const words = labels.flatMap((spec, cell) => (spec ? label((cell % 3) * (width / 3), Math.floor(cell / 3) * (height / 3), spec) : []));
  const body = words
    .map((w) => `<word xMin="${w.x0.toFixed(6)}" yMin="${w.y0.toFixed(6)}" xMax="${w.x1.toFixed(6)}" yMax="${w.y1.toFixed(6)}">${w.text}</word>`)
    .join("\n");
  return `<page width="${width}.000000" height="${height}.000000">\n${body}\n</page>`;
}

export function tiledXml(sheets: (LabelSpec | null)[][]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><html><body><doc>${sheets.map(sheetXml).join("\n")}</doc></body></html>`;
}

// The `-layout` text of such a document is what looksTiled() reads: two labels
// on one text line means two tracking codes next to each other.
export const TILED_LAYOUT_TEXT = "Mã vận đơn: A1                    Mã vận đơn: B2\nMã đơn hàng: X1                  Mã đơn hàng: Y2\n";

// Product lines of a Shopee AWB (phiếu gửi hàng) and the grouping of identical
// orders — see docs/superpowers/specs/2026-10-07-waybill-excel-design.md.
//
// Pure text in, plain objects out (no PDF / DB / network), so it is unit
// tested against real `pdftotext -layout` output.

export interface WaybillItem {
  name: string;
  variant: string;
  quantity: number;
  // The seller's SKU of this line (the table's "SKU" column), for labels that carry an
  // order-info table — see orderInfo.ts. Never part of the grouping: the
  // same product always has the same SKU.
  sku?: string;
  // What the warehouse's price sheet says about that SKU (kiotMap.ts): the Kiot product(s)
  // it stands for, one line each. Absent when the sheet knows nothing of the SKU. Never part
  // of the grouping either.
  kiotLines?: KiotLine[];
}

// One Kiot product of an order line. A plain SKU has one; a combined SKU written
// "SKU1*2+SKU2" (two of SKU1 and one of SKU2 in each unit sold) has one per base SKU.
export interface KiotLine {
  // The SKU this line stands for: the item's own, or one base SKU of a combined one.
  sku: string;
  // Kiot units to take out: the item's quantity × the base SKU's count in the combined SKU.
  quantity: number;
  // From the price sheet; each is absent when the sheet has none for this SKU.
  kiotCode?: string;
  kiotStore?: string;
  // Cost of one Kiot unit, in đồng.
  cost?: number;
}

export interface WaybillPage {
  // 0-based position of this order's label in the source PDF — the key to
  // re-ordering the PDF itself the same way the Excel is ordered. With one label
  // per page that is the page number; with several labels per sheet it is
  // sheet × labels-per-sheet + cell (row by row), see layout.ts.
  pageIndex: number;
  shopeeOrderId: string;
  trackingCode: string | null;
  // "Tổng SL sản phẩm: N" printed on the label; null when the page has no
  // item block at all.
  declaredTotalQuantity: number | null;
  items: WaybillItem[];
  // The sender printed under "Từ:" — the shop the parcel goes out under ("gian hàng").
  shopName?: string;
}

export interface GroupedPage extends WaybillPage {
  note: string | null;
}

export interface WaybillGroup {
  // false only for the trailing group of pages whose items couldn't be read.
  readable: boolean;
  // true for orders whose label can't show every product (see hidesItems): they are
  // grouped among themselves and listed after every ordinary group.
  hidden: boolean;
  pages: GroupedPage[];
}

// The label hard-wraps item text by pixel width, in the MIDDLE of words
// ("chấ" / "t lượng cao") as well as at spaces, and the space a wrap lands on is
// lost. There is no telling the two apart from the PDF, and guessing puts wrong text
// in the file, so none is made: the text is taken exactly as printed and every line
// break counts as one space — a comma already followed by its space, or a "SL:"
// marker cut in two ("…, S" / "L: 1"), being the only things that must stay whole for
// the line to be read at all. Grouping compares whitespace-stripped text (see itemKey),
// so identical products group together whatever their wraps did.
export function joinWrappedLines(lines: string[]): string {
  let result = "";
  for (const line of lines) {
    if (result === "") {
      result = line;
      continue;
    }
    result += isSplitQuantityMarker(result, line) ? line : ` ${line}`;
  }
  return result;
}

// The quantity marker "SL:" itself can be what gets cut: "…, S" / "L: 1" or "…, SL" / ": 1".
function isSplitQuantityMarker(previous: string, next: string): boolean {
  return (/(^|\s)S$/.test(previous) && /^L:/.test(next)) || (/(^|\s)SL$/.test(previous) && /^:/.test(next));
}

// Pre-orders print "Mã đơn đặt trước:" where every other label has "Mã đơn hàng:".
export const ORDER_ID_RE = /Mã đơn (?:hàng|đặt trước):\s*(\S+)/;
const TRACKING_RE = /Mã vận đơn:\s*(\S+)/;
// An order id as Shopee writes it: a 6-digit date and 8 letters or digits ("261014K819A9UP").
export const BARE_ORDER_ID_RE = /^\d{6}[A-Z0-9]{8}$/;
const ORDER_SN_RE = /OrderSN:\s*(\S+)/;
const ITEM_BLOCK_RE = /Nội dung hàng\s*\(Tổng SL sản phẩm:\s*(\d+)\)/;
const ITEM_START_RE = /^(\d+)\.\s+(.*)$/;
const ITEM_END_RE = /,?\s*SL:\s*(\d+)\s*$/;

// The order a label names. Most labels caption it ("Mã đơn hàng: …"). The label of a
// parcel the seller brings to a drop-off point ("ĐIỂM NHẬN HÀNG") prints the id bare, on
// the line under the tracking code, with no caption; and a label with an order-info table
// names it again in that table ("OrderSN: …"). Null when the text names none.
export function findOrderId(labelText: string): string | null {
  const captioned = ORDER_ID_RE.exec(labelText)?.[1];
  if (captioned) return captioned;

  const lines = labelText.split("\n");
  const tracking = lines.findIndex((line) => TRACKING_RE.test(line));
  if (tracking !== -1) {
    for (const line of lines.slice(tracking, tracking + 3)) {
      const bare = line.split(/\s+/).find((token) => BARE_ORDER_ID_RE.test(token));
      if (bare) return bare;
    }
  }
  return ORDER_SN_RE.exec(labelText)?.[1] ?? null;
}

// `-layout` puts the label's right-hand column (sorting codes, order date…) on
// the same text line, separated by a wide run of spaces — item text never has
// 3+ consecutive spaces, so cut there.
function cutRightColumn(line: string): string {
  return line.replace(/\s+$/, "").replace(/\s{3,}\S.*$/, "").trim();
}

function parseItem(joined: string): WaybillItem | null {
  const match = /^(.*?),?\s*SL:\s*(\d+)\s*$/s.exec(joined);
  if (!match) return null;

  // "[FURNI HOME] " is the shop tag Shopee prepends, identical on every line.
  const body = match[1].replace(/^\[[^\]]*\]\s*/, "").trim();
  // Shopee prints "<name>, <variant>, SL: n"; names contain commas too, so the
  // variant is whatever follows the LAST ", " (variants like "VÍ ĐEN,VINFAST"
  // have an unspaced comma and so stay whole).
  const split = body.lastIndexOf(", ");
  return {
    name: split === -1 ? body : body.slice(0, split).trim(),
    variant: split === -1 ? "" : body.slice(split + 2).trim(),
    quantity: Number(match[2]),
  };
}

function parseItemBlock(pageText: string): { declaredTotalQuantity: number | null; items: WaybillItem[] } {
  const lines = pageText.split("\n");
  const headerIndex = lines.findIndex((line) => ITEM_BLOCK_RE.test(line));
  if (headerIndex === -1) return { declaredTotalQuantity: null, items: [] };

  const declaredTotalQuantity = Number(ITEM_BLOCK_RE.exec(lines[headerIndex])![1]);
  const items: WaybillItem[] = [];
  let current: string[] | null = null;

  for (const line of lines.slice(headerIndex + 1)) {
    const text = cutRightColumn(line);
    if (text === "") {
      // A blank line ends the block — or, mid-item, means the label cut the
      // item short; that partial item has no quantity so it is dropped (the
      // total-quantity check on the page flags it).
      if (current || items.length > 0) break;
      continue;
    }

    if (!current) {
      // Only a line numbered exactly "next item" starts an item, so wrapped
      // text that happens to begin with "2. " can't be mistaken for one.
      const start = ITEM_START_RE.exec(text);
      if (!start || Number(start[1]) !== items.length + 1) break;
      current = [start[2]];
    } else {
      current.push(text);
    }

    const joined = joinWrappedLines(current);
    if (ITEM_END_RE.test(joined)) {
      const item = parseItem(joined);
      if (item) items.push(item);
      current = null;
    }
  }

  return { declaredTotalQuantity, items };
}

// The sender: the first line under "Từ:" (the line also carries the receiver's
// column, cut off the same way item lines are). Viettel Post labels print "Từ" without
// the colon, then "Đến" in the next column. Empty when there is none.
function parseShopName(labelText: string): string {
  const lines = labelText.split("\n");
  const from = lines.findIndex((line) => /^\s*(?:Từ:|Từ(?:\s{2,}Đến|\s*$))/.test(line));
  if (from === -1) return "";
  for (const line of lines.slice(from + 1, from + 4)) {
    const text = cutRightColumn(line);
    if (text !== "") return text;
  }
  return "";
}

// One label's text → the order it names, or null if it names none. `labelText`
// is what `pdftotext -layout` prints for that label alone.
export function parseLabelText(labelText: string, pageIndex: number): WaybillPage | null {
  const orderId = findOrderId(labelText);
  if (!orderId) return null;

  const { declaredTotalQuantity, items } = parseItemBlock(labelText);
  const shopName = parseShopName(labelText);
  return {
    pageIndex,
    shopeeOrderId: orderId,
    trackingCode: TRACKING_RE.exec(labelText)?.[1] ?? null,
    declaredTotalQuantity,
    items,
    ...(shopName ? { shopName } : {}),
  };
}

// One entry per label page that names an order. `text` is the whole document
// as `pdftotext -layout` prints it (pages separated by form feeds).
export function extractWaybillPagesFromText(text: string): WaybillPage[] {
  const pages: WaybillPage[] = [];
  // pdftotext ends every PDF page with a form feed, so the split index IS the
  // page index — pages that name no order are skipped but still counted.
  text.split("\f").forEach((pageText, pageIndex) => {
    const page = parseLabelText(pageText, pageIndex);
    if (page) pages.push(page);
  });
  return pages;
}

// Whitespace and case are stripped: identical items always wrap identically on
// the label, but this keeps the comparison independent of the display-join
// guesses above.
function normalize(value: string): string {
  return value.normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

function itemKey(item: WaybillItem): string {
  return `${normalize(item.name)}|${normalize(item.variant)}|${item.quantity}`;
}

function signature(page: WaybillPage): string {
  return page.items.map(itemKey).sort().join("¦");
}

function readQuantity(page: WaybillPage): number {
  return page.items.reduce((sum, item) => sum + item.quantity, 0);
}

// The label's product box is only so tall: an order with many products prints the first
// few and the label's own "Tổng SL sản phẩm" then exceeds what can be read. Such an
// order can't be told apart from a smaller one by its visible lines alone.
function hidesItems(page: WaybillPage): boolean {
  return page.items.length > 0 && page.declaredTotalQuantity !== null && page.declaredTotalQuantity !== readQuantity(page);
}

function noteFor(page: WaybillPage): string | null {
  if (page.items.length === 0) return "Không đọc được nội dung hàng trên nhãn";
  if (hidesItems(page)) {
    return `Nhãn ẩn bớt sản phẩm (tổng SL ${page.declaredTotalQuantity}, đọc được ${readQuantity(page)})`;
  }
  return null;
}

const collator = new Intl.Collator("vi");

function sortText(page: WaybillPage): string {
  const first = [...page.items].sort((a, b) => itemKey(a).localeCompare(itemKey(b)))[0];
  return `${first.name} ${first.variant}`;
}

// Orders with the same set of (name, variant, quantity) lines form one group.
// Largest groups first — the warehouse packs the big batches in one go — then
// by product name so near-identical singles land close together. Orders whose label
// hides some of their products come after all of those (still grouped with each other,
// by what they show and the total they declare), and pages whose items couldn't be read
// go last in their own group rather than disappearing. Inside a group the original PDF
// order is kept.
export function groupWaybillPages(pages: WaybillPage[]): WaybillGroup[] {
  const ordinary = new Map<string, GroupedPage[]>();
  const hidden = new Map<string, GroupedPage[]>();
  const unreadable: GroupedPage[] = [];

  for (const page of pages) {
    const grouped: GroupedPage = { ...page, note: noteFor(page) };
    if (page.items.length === 0) {
      unreadable.push(grouped);
      continue;
    }
    const target = hidesItems(page) ? hidden : ordinary;
    // What is hidden is unknown, but two labels that show the same lines out of
    // different declared totals are surely different orders.
    const key = target === hidden ? `${signature(page)}¦total ${page.declaredTotalQuantity}` : signature(page);
    target.set(key, [...(target.get(key) ?? []), grouped]);
  }

  const bySize = (a: GroupedPage[], b: GroupedPage[]) =>
    b.length - a.length || collator.compare(sortText(a[0]), sortText(b[0]));

  const groups: WaybillGroup[] = [
    ...[...ordinary.values()].sort(bySize).map((groupPages) => ({ readable: true, hidden: false, pages: groupPages })),
    ...[...hidden.values()].sort(bySize).map((groupPages) => ({ readable: true, hidden: true, pages: groupPages })),
  ];
  if (unreadable.length > 0) groups.push({ readable: false, hidden: false, pages: unreadable });
  return groups;
}

// Whether a page (or one cell of a tiled sheet) is a shipping label at all: it carries
// the tracking code, the order id or the product block. A sheet can hold more than
// the labels it was made for (a cover, the rest of an order-info table), and those are
// not orders to find.
export function looksLikeLabel(text: string): boolean {
  return TRACKING_RE.test(text) || ITEM_BLOCK_RE.test(text) || findOrderId(text) !== null;
}

// How many of these texts are labels — the number of orders the file should hold.
export function countLabels(texts: string[]): number {
  return texts.filter(looksLikeLabel).length;
}

// The red line the user is shown when fewer orders were read than the PDF has labels:
// a label that wasn't read is missing from the Excel and from the sorted PDF's order, and
// must be looked at by hand. Null when nothing is missing.
export function labelMismatchMessage(orderCount: number, labelCount: number | null | undefined): string | null {
  if (labelCount === null || labelCount === undefined || labelCount <= orderCount) return null;
  return `CẢNH BÁO: file PDF có ${labelCount} phiếu nhưng chỉ đọc được ${orderCount} đơn (thiếu ${labelCount - orderCount}). Hãy kiểm tra lại file.`;
}

// Source-PDF page numbers in the exact order the groups list their orders — the
// order of the Excel rows. The re-ordered PDF is built from this, so the two
// can never disagree.
export function orderedPageIndexes(groups: WaybillGroup[]): number[] {
  return groups.flatMap((group) => group.pages.map((page) => page.pageIndex));
}

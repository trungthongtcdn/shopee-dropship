// Product lines of a Shopee AWB (phiếu gửi hàng) and the grouping of identical
// orders — see docs/superpowers/specs/2026-10-07-waybill-excel-design.md.
//
// Pure text in, plain objects out (no PDF / DB / network), so it is unit
// tested against real `pdftotext -layout` output.

export interface WaybillItem {
  name: string;
  variant: string;
  quantity: number;
}

export interface WaybillPage {
  shopeeOrderId: string;
  trackingCode: string | null;
  // "Tổng SL sản phẩm: N" printed on the label; null when the page has no
  // item block at all.
  declaredTotalQuantity: number | null;
  items: WaybillItem[];
}

export interface GroupedPage extends WaybillPage {
  note: string | null;
}

export interface WaybillGroup {
  // false only for the trailing group of pages whose items couldn't be read.
  readable: boolean;
  pages: GroupedPage[];
}

// The label hard-wraps item text by pixel width, in the MIDDLE of words
// ("chấ" / "t lượng cao"), and `pdftotext` loses the space when the wrap
// happened to fall on one. There is no way to tell the two apart from the
// text alone, so this is a best guess for DISPLAY only — grouping compares
// whitespace-stripped text (see itemKey) and never depends on it:
//  - after a comma → a space (the wrap ate it);
//  - next line starts lowercase → same word ("chấ"+"t"): mid-word breaks are
//    far likelier than a break that lands exactly on a space;
//  - next line starts uppercase → a new word, EXCEPT when the previous word is
//    ALL CAPS ("FREESHI"+"P"), where a cut word is again the likelier story;
//  - digit directly after a digit → same number.
export function joinWrappedLines(lines: string[]): string {
  let result = "";
  for (const line of lines) {
    if (result === "") {
      result = line;
      continue;
    }
    result += needsSpace(result, line) ? ` ${line}` : line;
  }
  return result;
}

function needsSpace(previous: string, next: string): boolean {
  if (previous.endsWith(",")) return true;
  if (/\d$/.test(previous) && /^\d/.test(next)) return false;
  if (!/^[\p{Lu}\d]/u.test(next)) return false;

  const lastWord = previous.split(/\s+/).pop() ?? "";
  if (/^\p{Lu}{3,}$/u.test(lastWord) && /^\p{Lu}/u.test(next)) return false;
  return true;
}

const ORDER_ID_RE = /Mã đơn hàng:\s*(\S+)/;
const TRACKING_RE = /Mã vận đơn:\s*(\S+)/;
const ITEM_BLOCK_RE = /Nội dung hàng\s*\(Tổng SL sản phẩm:\s*(\d+)\)/;
const ITEM_START_RE = /^(\d+)\.\s+(.*)$/;
const ITEM_END_RE = /,?\s*SL:\s*(\d+)\s*$/;

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

// One entry per label page that names an order. `text` is the whole document
// as `pdftotext -layout` prints it (pages separated by form feeds).
export function extractWaybillPagesFromText(text: string): WaybillPage[] {
  const pages: WaybillPage[] = [];
  for (const pageText of text.split("\f")) {
    const orderId = ORDER_ID_RE.exec(pageText)?.[1];
    if (!orderId) continue;

    const { declaredTotalQuantity, items } = parseItemBlock(pageText);
    pages.push({
      shopeeOrderId: orderId,
      trackingCode: TRACKING_RE.exec(pageText)?.[1] ?? null,
      declaredTotalQuantity,
      items,
    });
  }
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

function noteFor(page: WaybillPage): string | null {
  if (page.items.length === 0) return "Không đọc được nội dung hàng trên nhãn";
  const total = page.items.reduce((sum, item) => sum + item.quantity, 0);
  if (page.declaredTotalQuantity !== null && page.declaredTotalQuantity !== total) {
    return `Nhãn ẩn bớt sản phẩm (tổng SL ${page.declaredTotalQuantity}, đọc được ${total})`;
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
// by product name so near-identical singles land close together. Pages whose
// items couldn't be read go last in their own group rather than disappearing.
// Inside a group the original PDF order is kept.
export function groupWaybillPages(pages: WaybillPage[]): WaybillGroup[] {
  const bySignature = new Map<string, GroupedPage[]>();
  const unreadable: GroupedPage[] = [];

  for (const page of pages) {
    const grouped: GroupedPage = { ...page, note: noteFor(page) };
    if (page.items.length === 0) {
      unreadable.push(grouped);
      continue;
    }
    const key = signature(page);
    bySignature.set(key, [...(bySignature.get(key) ?? []), grouped]);
  }

  const readable = [...bySignature.values()].sort(
    (a, b) => b.length - a.length || collator.compare(sortText(a[0]), sortText(b[0]))
  );

  const groups: WaybillGroup[] = readable.map((groupPages) => ({ readable: true, pages: groupPages }));
  if (unreadable.length > 0) groups.push({ readable: false, pages: unreadable });
  return groups;
}

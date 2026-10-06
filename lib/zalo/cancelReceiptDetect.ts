// Shopee order ids in this app are consistently 14 alphanumeric characters
// starting with a digit (verified against every real id seen so far, e.g.
// "260621MB6WJXKM", "26090342NR0MSC", "260908G51VR6NQ" — the leading digit
// run isn't a fixed length, so the pattern is "14 chars, starts with a
// digit", not "N digits then M letters").
const ORDER_ID_RE = /\b\d[A-Z0-9]{13}\b/g;

// Tracking codes always start with the literal "SPXVN" prefix — digit count
// after it varies a little in the wild, so a range instead of a fixed count.
// Shopee also started appending a single trailing letter to some codes (e.g.
// "SPXVN06781167424A") — confirmed against real tracking_code values already
// in the DB. Without the optional [A-Z]? this entire code fails to match at
// all (the digit-run and the trailing letter are both \w, so no \b ever
// lands between them), which silently dropped every cancel-receipt
// confirmation for these orders — the root cause of a real production
// incident where the Zalo bridge stopped updating "Đơn hoàn huỷ" orders.
const TRACKING_CODE_RE = /\bSPXVN\d{8,15}[A-Z]?\b/gi;

// Staff typing a cancel-receipt update in the group may include the order
// id, the tracking code, or both, anywhere in a free-text message (not a
// structured format like the waybill PDF) — pull out every code found,
// deduplicated, uppercased for consistent matching against the DB.
export function extractOrderCodes(content: string): string[] {
  const orderIds = content.match(ORDER_ID_RE) ?? [];
  const trackingCodes = (content.match(TRACKING_CODE_RE) ?? []).map((code) => code.toUpperCase());
  return [...new Set([...orderIds, ...trackingCodes])];
}

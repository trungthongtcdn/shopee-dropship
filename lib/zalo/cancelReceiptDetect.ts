// Shopee order ids in this app are consistently 14 alphanumeric characters
// starting with a digit (verified against every real id seen so far, e.g.
// "260621MB6WJXKM", "26090342NR0MSC", "260908G51VR6NQ" — the leading digit
// run isn't a fixed length, so the pattern is "14 chars, starts with a
// digit", not "N digits then M letters").
const ORDER_ID_RE = /\b\d[A-Z0-9]{13}\b/g;

// Tracking codes always start with the literal "SPXVN" prefix — digit count
// after it varies a little in the wild, so a range instead of a fixed count.
const TRACKING_CODE_RE = /\bSPXVN\d{8,15}\b/gi;

// Staff typing a cancel-receipt update in the group may include the order
// id, the tracking code, or both, anywhere in a free-text message (not a
// structured format like the waybill PDF) — pull out every code found,
// deduplicated, uppercased for consistent matching against the DB.
export function extractOrderCodes(content: string): string[] {
  const orderIds = content.match(ORDER_ID_RE) ?? [];
  const trackingCodes = (content.match(TRACKING_CODE_RE) ?? []).map((code) => code.toUpperCase());
  return [...new Set([...orderIds, ...trackingCodes])];
}

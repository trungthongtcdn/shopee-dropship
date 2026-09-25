// Confirmed by user: staff types "Đã in" followed by anything (e.g. "Đã in
// 50 đơn") as their confirmation reply in the group — only the prefix
// matters, whatever comes after is free text and ignored.
const CONFIRM_PHRASE = "đã in";

const PDF_URL_RE = /\.pdf(?:[?#]|$)/i;

// Real "đơn hàng mới" messages list two pdf links — "AWB (Phiếu gửi hàng)"
// first, then "Package list (Phiếu đóng gói)" — and only the AWB one is the
// waybill extractOrderIdsFromWaybillPdf actually parses order IDs out of.
// Prefer whichever pdf link sits on a line labeled "AWB" over plain
// first-match order, so this survives the two links ever being reordered in
// a future message-template change; fall back to the first pdf link found
// anywhere for simpler messages with no such label (e.g. manual test sends).
export function findPdfUrl(content: string): string | null {
  const allUrls = content.match(/https?:\/\/\S+/g);
  if (!allUrls) return null;
  const pdfUrls = allUrls.filter((url) => PDF_URL_RE.test(url));
  if (pdfUrls.length === 0) return null;

  const awbLine = content.split(/\r?\n/).find((line) => /\bAWB\b/i.test(line) && PDF_URL_RE.test(line));
  const awbUrl = awbLine?.match(/https?:\/\/\S+/g)?.find((url) => PDF_URL_RE.test(url));

  return awbUrl ?? pdfUrls[0];
}

export function isConfirmationMessage(content: string): boolean {
  return content.trim().toLowerCase().includes(CONFIRM_PHRASE);
}

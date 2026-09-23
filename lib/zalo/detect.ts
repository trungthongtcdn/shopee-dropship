// Confirmed by user: staff always types this exact phrase (Vietnamese, no
// diacritic variants expected) as their confirmation reply in the group.
const CONFIRM_PHRASE = "đã đóng";

export function findPdfUrl(content: string): string | null {
  const urls = content.match(/https?:\/\/\S+/g);
  if (!urls) return null;
  return urls.find((url) => /\.pdf(?:[?#]|$)/i.test(url)) ?? null;
}

export function isConfirmationMessage(content: string): boolean {
  return content.trim().toLowerCase().includes(CONFIRM_PHRASE);
}

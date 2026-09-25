export function getByHeader(
  data: Record<string, string | number>,
  ...aliases: string[]
): string | number | undefined {
  const normalized = new Map(
    Object.entries(data).map(([key, value]) => [key.trim().toLowerCase(), value])
  );

  for (const alias of aliases) {
    const value = normalized.get(alias.trim().toLowerCase());
    if (value !== undefined) return value;
  }

  return undefined;
}

export function getString(data: Record<string, string | number>, ...aliases: string[]): string | null {
  const value = getByHeader(data, ...aliases);
  if (value === undefined || value === "") return null;
  return String(value);
}

// Matches a plain "D/M/YYYY" or "D/M/YY" string (e.g. "23/9/26") — the
// format a manually-typed Vietnamese date column can come through as when
// the sheet cell isn't a real Date-typed cell, so Apps Script serializes it
// as text rather than an ISO string. `new Date(value)` cannot reliably
// parse this (JS assumes M/D/Y for short numeric dates), so it's tried as a
// fallback after the native parse fails, not a replacement for it — every
// other date column in this app is a genuine Date-typed Shopee/settlement
// cell that already serializes to ISO and parses on the first attempt.
const DMY_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function parseDmyDate(value: string): Date | null {
  const match = DMY_DATE_RE.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getDate(data: Record<string, string | number>, ...aliases: string[]): Date | null {
  const value = getByHeader(data, ...aliases);
  if (value === undefined || value === "") return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return typeof value === "string" ? parseDmyDate(value) : null;
}

export function getInt(data: Record<string, string | number>, ...aliases: string[]): number | null {
  const value = getByHeader(data, ...aliases);
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : Math.trunc(parsed);
}

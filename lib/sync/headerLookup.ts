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

export function getDate(data: Record<string, string | number>, ...aliases: string[]): Date | null {
  const value = getByHeader(data, ...aliases);
  if (value === undefined || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getInt(data: Record<string, string | number>, ...aliases: string[]): number | null {
  const value = getByHeader(data, ...aliases);
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : Math.trunc(parsed);
}

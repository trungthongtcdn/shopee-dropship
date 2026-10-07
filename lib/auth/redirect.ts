export const DEFAULT_AFTER_LOGIN = "/dashboard/report";

// `?next=` comes from the URL, so it's attacker-controlled: only ever follow a
// same-site absolute path. "//evil.com" and "/\evil.com" are protocol-relative
// in browsers and must not slip through a naive startsWith("/") check.
export function safeNextPath(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  return value;
}

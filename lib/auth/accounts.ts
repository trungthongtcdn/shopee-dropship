// Shared validation for the login + accounts API so the rules (and the
// Vietnamese messages the UI shows verbatim) live in one place.

export const PASSWORD_MIN_LENGTH = 8;
const USERNAME_RE = /^[a-z0-9._-]{3,50}$/;

// Usernames are stored lower-cased, so "Luan" and "luan" are the same account.
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(normalized: string): string | null {
  return USERNAME_RE.test(normalized)
    ? null
    : "Tên đăng nhập 3-50 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang";
}

export function validatePassword(password: string): string | null {
  return password.length >= PASSWORD_MIN_LENGTH ? null : `Mật khẩu tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`;
}

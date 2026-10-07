// Edge-safe on purpose: middleware.ts imports this, and Next's edge runtime has
// Web Crypto but not node:crypto — so nothing Node-only (and no Prisma) here.

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();

// Local dev / tests run without SESSION_SECRET configured. Production must
// never fall back to a known value, so it fails closed instead (undefined →
// every session is rejected and login refuses to issue one).
const DEV_FALLBACK_SECRET = "dev-only-insecure-session-secret";

export function getSessionSecret(): string | undefined {
  const configured = process.env.SESSION_SECRET;
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? undefined : DEV_FALLBACK_SECRET;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

// Token = base64url({uid, exp}) + "." + base64url(HMAC-SHA256(payload part)).
export async function signSession(userId: number, secret: string, now: number = Date.now()): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ uid: userId, exp: now + SESSION_MAX_AGE_SECONDS * 1000 })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySession(
  token: string | undefined,
  secret: string | undefined,
  now: number = Date.now()
): Promise<{ userId: number } | null> {
  if (!token || !secret) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signaturePart] = parts;

  const signature = fromBase64Url(signaturePart);
  if (!signature) return null;

  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, encoder.encode(payload));
  if (!valid) return null;

  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { uid?: unknown; exp?: unknown };
    if (!Number.isInteger(parsed.uid) || typeof parsed.exp !== "number" || parsed.exp <= now) return null;
    return { userId: parsed.uid as number };
  } catch {
    return null;
  }
}

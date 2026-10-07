import { describe, it, expect } from "vitest";
import { signSession, verifySession, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

const SECRET = "test-secret-test-secret-test-secret";

describe("session token", () => {
  it("round-trips the user id", async () => {
    const token = await signSession(42, SECRET);
    expect(await verifySession(token, SECRET)).toEqual({ userId: 42 });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession(42, SECRET);
    expect(await verifySession(token, "another-secret-another-secret-xx")).toBeNull();
  });

  it("rejects a tampered payload (forged user id)", async () => {
    const token = await signSession(42, SECRET);
    const [, signature] = token.split(".");
    const forgedPayload = btoa(JSON.stringify({ uid: 1, exp: Date.now() + 60_000 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(await verifySession(`${forgedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const issuedAt = Date.now() - (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    const token = await signSession(42, SECRET, issuedAt);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it("accepts a token that is still inside its lifetime", async () => {
    const issuedAt = Date.now() - (SESSION_MAX_AGE_SECONDS - 60) * 1000;
    const token = await signSession(42, SECRET, issuedAt);
    expect(await verifySession(token, SECRET)).toEqual({ userId: 42 });
  });

  it("rejects missing / garbage tokens and a missing secret", async () => {
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession("", SECRET)).toBeNull();
    expect(await verifySession("garbage", SECRET)).toBeNull();
    expect(await verifySession("a.b", SECRET)).toBeNull();
    expect(await verifySession(await signSession(1, SECRET), undefined)).toBeNull();
  });
});

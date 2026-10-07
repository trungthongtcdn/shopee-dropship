import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies the password it hashed", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse");
    expect(await verifyPassword("wrong horse", hash)).toBe(false);
  });

  it("salts: hashing the same password twice gives different strings", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("never stores the plain password in the hash", async () => {
    expect(await hashPassword("hunter2hunter2")).not.toContain("hunter2hunter2");
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$$")).toBe(false);
  });
});

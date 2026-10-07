import { describe, it, expect } from "vitest";
import { safeNextPath, DEFAULT_AFTER_LOGIN } from "@/lib/auth/redirect";

describe("safeNextPath", () => {
  it("keeps a same-site path, including its query string", () => {
    expect(safeNextPath("/dashboard/orders?q=abc&page=2")).toBe("/dashboard/orders?q=abc&page=2");
  });

  it("falls back to the default when missing or empty", () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("")).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("rejects absolute and protocol-relative URLs (open redirect)", () => {
    expect(safeNextPath("https://evil.example/phish")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("//evil.example/phish")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_AFTER_LOGIN);
  });

  it("uses the first value when the param is repeated", () => {
    expect(safeNextPath(["/dashboard/report", "https://evil.example"])).toBe("/dashboard/report");
  });
});

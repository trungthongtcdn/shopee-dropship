import { describe, it, expect } from "vitest";
import { formatDateVN, formatDateTimeVN } from "@/lib/format/datetime";

describe("formatDateVN", () => {
  it("returns '-' for null/undefined", () => {
    expect(formatDateVN(null)).toBe("-");
    expect(formatDateVN(undefined)).toBe("-");
  });

  it("shows the VN calendar day, not the UTC one, near the UTC midnight boundary", () => {
    // 2026-10-01 20:00 UTC is already 2026-10-02 03:00 in Asia/Ho_Chi_Minh (UTC+7).
    expect(formatDateVN(new Date("2026-10-01T20:00:00.000Z"))).toBe("2026-10-02");
  });

  it("does not shift a timestamp that's nowhere near the boundary", () => {
    expect(formatDateVN(new Date("2026-10-01T02:00:00.000Z"))).toBe("2026-10-01");
  });
});

describe("formatDateTimeVN", () => {
  it("returns '-' for null/undefined", () => {
    expect(formatDateTimeVN(null)).toBe("-");
    expect(formatDateTimeVN(undefined)).toBe("-");
  });

  it("renders the clock time shifted to Asia/Ho_Chi_Minh (UTC+7), not server-local", () => {
    const formatted = formatDateTimeVN(new Date("2026-10-01T20:00:00.000Z"));
    expect(formatted).toContain("03:00:00");
    expect(formatted).toContain("2/10/2026");
  });
});

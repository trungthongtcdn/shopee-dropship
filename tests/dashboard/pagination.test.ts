import { describe, it, expect } from "vitest";
import { parsePageSize, totalPagesFor, DEFAULT_PAGE_SIZE } from "@/app/dashboard/Pagination";

describe("parsePageSize", () => {
  it("defaults to 20 when absent", () => {
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });
  it("accepts 50 and 100", () => {
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize("100")).toBe(100);
  });
  it("falls back to default for anything else", () => {
    expect(parsePageSize("7")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("totalPagesFor with explicit pageSize", () => {
  it("computes pages for the given size", () => {
    expect(totalPagesFor(45, 20)).toBe(3);
    expect(totalPagesFor(45, 50)).toBe(1);
  });
});

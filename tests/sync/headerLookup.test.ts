import { describe, it, expect } from "vitest";
import { getByHeader, getString, getDate, getInt } from "@/lib/sync/headerLookup";

describe("getByHeader", () => {
  it("matches a header case-insensitively and trims whitespace", () => {
    const data = { "  Mã đơn hàng  ": "260621M7R5PYPN" };
    expect(getByHeader(data, "mã đơn hàng")).toBe("260621M7R5PYPN");
  });

  it("falls through a list of aliases in order", () => {
    const data = { "Tên phân loại": "D100" };
    expect(getByHeader(data, "Tên phân loại hàng", "Tên phân loại")).toBe("D100");
  });

  it("returns undefined when no alias matches", () => {
    const data = { Foo: "bar" };
    expect(getByHeader(data, "Mã đơn hàng")).toBeUndefined();
  });
});

describe("getString", () => {
  it("returns null for missing or empty values", () => {
    expect(getString({}, "Mã đơn hàng")).toBeNull();
    expect(getString({ "Mã đơn hàng": "" }, "Mã đơn hàng")).toBeNull();
  });

  it("coerces a number to a string", () => {
    expect(getString({ "Mã Kiện Hàng": 5989013244824578 }, "Mã Kiện Hàng")).toBe("5989013244824578");
  });
});

describe("getDate", () => {
  it("parses a valid date string", () => {
    const result = getDate({ "Ngày đặt hàng": "2026-06-21" }, "Ngày đặt hàng");
    expect(result?.toISOString().startsWith("2026-06-21")).toBe(true);
  });

  it("returns null for an unparseable value", () => {
    expect(getDate({ "Ngày đặt hàng": "not-a-date" }, "Ngày đặt hàng")).toBeNull();
  });

  it("returns null when missing", () => {
    expect(getDate({}, "Ngày đặt hàng")).toBeNull();
  });
});

describe("getInt", () => {
  it("parses and truncates a numeric value", () => {
    expect(getInt({ "Số lượng sản phẩm 1 đơn": 2.9 }, "Số lượng sản phẩm 1 đơn")).toBe(2);
  });

  it("returns null for a non-numeric value", () => {
    expect(getInt({ "Số lượng sản phẩm 1 đơn": "abc" }, "Số lượng sản phẩm 1 đơn")).toBeNull();
  });
});

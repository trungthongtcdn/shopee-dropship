import { describe, it, expect } from "vitest";
import { findPdfUrl, isConfirmationMessage } from "@/lib/zalo/detect";

describe("findPdfUrl", () => {
  it("finds a pdf link with query params after the extension", () => {
    const content =
      "Danh sách đơn hôm nay: https://cdn.giaiphap.shopee.vn/robot-job/air_waybill_WH049.pdf?Expires=123&Signature=abc=";
    expect(findPdfUrl(content)).toBe(
      "https://cdn.giaiphap.shopee.vn/robot-job/air_waybill_WH049.pdf?Expires=123&Signature=abc="
    );
  });

  it("finds a plain pdf link with no query string", () => {
    expect(findPdfUrl("xem tại https://example.com/file.pdf nhé")).toBe("https://example.com/file.pdf");
  });

  it("returns null when the message has no pdf link", () => {
    expect(findPdfUrl("chào buổi sáng cả nhà")).toBeNull();
  });

  it("returns null when the message links to a non-pdf file", () => {
    expect(findPdfUrl("xem ảnh tại https://example.com/photo.jpg")).toBeNull();
  });

  it("ignores a non-pdf link and finds the pdf one among several", () => {
    const content = "ảnh: https://example.com/a.jpg, file: https://example.com/b.pdf";
    expect(findPdfUrl(content)).toBe("https://example.com/b.pdf");
  });
});

describe("isConfirmationMessage", () => {
  it("matches the exact confirmation phrase", () => {
    expect(isConfirmationMessage("Đã đóng")).toBe(true);
  });

  it("matches case-insensitively with surrounding words", () => {
    expect(isConfirmationMessage("shop ơi đã đóng hàng xong rồi nhé")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(isConfirmationMessage("mai gửi tiếp nhé")).toBe(false);
  });
});

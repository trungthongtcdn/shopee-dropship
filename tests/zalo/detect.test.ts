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

  it("picks the AWB-labeled link over the package-list link in a real 'đơn hàng mới' message", () => {
    const content = `[ĐƠN HÀNG MỚI - WH049_TTRANG - 25/09/2026]

Anh/chị có đơn hàng mới, em đính kèm file Excel để anh/chị kiểm tra tất cả thông tin liên quan.

- AWB (Phiếu gửi hàng): https://cdn.giaiphap.shopee.vn/robot/air_waybill_WH049_TTRANG_25092026.pdf?Expires=1790926611&Signature=GpVhwyN7REQV1irVaQ92UsQC9EU=
- Package list (Phiếu đóng gói): https://cdn.giaiphap.shopee.vn/robot/package_list_WH049_TTRANG_25092026.pdf?Expires=1790926611&Signature=4C0EDsTeBpK4VDnAme4iuHaze4w=

Nếu anh/chị có bất kỳ thắc mắc gì, vui lòng liên hệ bên em hỗ trợ nha!`;

    expect(findPdfUrl(content)).toBe(
      "https://cdn.giaiphap.shopee.vn/robot/air_waybill_WH049_TTRANG_25092026.pdf?Expires=1790926611&Signature=GpVhwyN7REQV1irVaQ92UsQC9EU="
    );
  });

  it("still picks the AWB link when it appears second instead of first", () => {
    const content = `- Package list (Phiếu đóng gói): https://example.com/package_list.pdf
- AWB (Phiếu gửi hàng): https://example.com/air_waybill.pdf`;

    expect(findPdfUrl(content)).toBe("https://example.com/air_waybill.pdf");
  });
});

describe("isConfirmationMessage", () => {
  it("matches the bare prefix", () => {
    expect(isConfirmationMessage("Đã in")).toBe(true);
  });

  it("matches regardless of what follows the prefix", () => {
    expect(isConfirmationMessage("Đã in 50 đơn")).toBe(true);
    expect(isConfirmationMessage("đã in xong rồi nhé shop")).toBe(true);
  });

  it("matches case-insensitively with surrounding words", () => {
    expect(isConfirmationMessage("shop ơi đã in hết rồi nha")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(isConfirmationMessage("mai gửi tiếp nhé")).toBe(false);
  });
});

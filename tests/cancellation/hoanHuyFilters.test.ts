import { describe, it, expect } from "vitest";
import {
  NO_VALUE,
  parseReceiptRefundFilters,
  matchesReceiptFilter,
  matchesRefundStatusFilter,
  refundStatusOptions,
} from "@/lib/cancellation/hoanHuyFilters";

describe("parseReceiptRefundFilters", () => {
  it("defaults to no filter", () => {
    expect(parseReceiptRefundFilters({})).toEqual({ receipt: [], refundStatus: [] });
  });

  it("accepts one or many values per filter", () => {
    expect(parseReceiptRefundFilters({ receipt: "not_needed", refundStatus: ["A", "B"] })).toEqual({
      receipt: ["not_needed"],
      refundStatus: ["A", "B"],
    });
  });

  it("drops receipt values that are not a known status, and blank refund statuses", () => {
    expect(parseReceiptRefundFilters({ receipt: ["bogus", "none", "received_full"], refundStatus: ["  ", " Đã hoàn tiền "] })).toEqual({
      receipt: ["none", "received_full"],
      refundStatus: ["Đã hoàn tiền"],
    });
  });
});

describe("matchesReceiptFilter", () => {
  it("matches everything when nothing is selected", () => {
    expect(matchesReceiptFilter(null, [])).toBe(true);
    expect(matchesReceiptFilter("received_full", [])).toBe(true);
  });

  it("matches the selected statuses, with 'none' standing for blank", () => {
    expect(matchesReceiptFilter("received_full", ["received_full", "not_needed"])).toBe(true);
    expect(matchesReceiptFilter("received_partial", ["received_full"])).toBe(false);
    expect(matchesReceiptFilter(null, [NO_VALUE])).toBe(true);
    expect(matchesReceiptFilter(null, ["received_full"])).toBe(false);
    expect(matchesReceiptFilter("received_full", [NO_VALUE])).toBe(false);
  });
});

describe("matchesRefundStatusFilter", () => {
  it("matches everything when nothing is selected", () => {
    expect(matchesRefundStatusFilter(null, [])).toBe(true);
  });

  it("matches the exact status, with 'none' standing for blank or missing", () => {
    expect(matchesRefundStatusFilter("Đã hoàn tiền cho Người mua", ["Đã hoàn tiền cho Người mua"])).toBe(true);
    expect(matchesRefundStatusFilter("Người mua đang trả hàng", ["Đã hoàn tiền cho Người mua"])).toBe(false);
    expect(matchesRefundStatusFilter(null, [NO_VALUE])).toBe(true);
    expect(matchesRefundStatusFilter("  ", [NO_VALUE])).toBe(true);
    expect(matchesRefundStatusFilter("Đã hoàn tiền cho Người mua", [NO_VALUE])).toBe(false);
  });
});

describe("refundStatusOptions", () => {
  it("lists each distinct status once, sorted, and a blank option only when some row has none", () => {
    expect(refundStatusOptions(["Đã hoàn tiền", "Chờ phản hồi", "Đã hoàn tiền"], [])).toEqual([
      { value: "Chờ phản hồi", label: "Chờ phản hồi" },
      { value: "Đã hoàn tiền", label: "Đã hoàn tiền" },
    ]);
    expect(refundStatusOptions(["A", null, "  "], [])).toEqual([
      { value: "A", label: "A" },
      { value: NO_VALUE, label: "(Trống)" },
    ]);
  });

  it("keeps a selected status in the list even when no loaded row has it", () => {
    expect(refundStatusOptions(["A"], ["B"]).map((o) => o.value)).toEqual(["A", "B"]);
    expect(refundStatusOptions([], [NO_VALUE])).toEqual([{ value: NO_VALUE, label: "(Trống)" }]);
  });
});

import { describe, it, expect } from "vitest";
import {
  parseReportFilters,
  buildOrderWhere,
  isNoiseCancelledOrder,
  matchesPaymentMatchFilter,
  matchesStatusFilter,
  reportFiltersToSearchParams,
  STATUS_OTHER_VALUE,
} from "@/lib/report/filters";

describe("parseReportFilters", () => {
  it("defaults every field to empty when absent", () => {
    const filters = parseReportFilters({});
    expect(filters.q).toBe("");
    expect(filters.paymentMatch).toEqual([]);
    expect(filters.sendStatus).toEqual([]);
    expect(filters.status).toEqual([]);
  });

  it("trims whitespace from the search query", () => {
    const filters = parseReportFilters({ q: "  260621MB6WJXKM  " });
    expect(filters.q).toBe("260621MB6WJXKM");
  });

  it("wraps a single repeated query value into a one-element array", () => {
    const filters = parseReportFilters({ sendStatus: "sent" });
    expect(filters.sendStatus).toEqual(["sent"]);
  });

  it("keeps multiple repeated query values as an array", () => {
    const filters = parseReportFilters({ sendStatus: ["sent", "cancelled"] });
    expect(filters.sendStatus).toEqual(["sent", "cancelled"]);
  });
});

describe("buildOrderWhere", () => {
  it("always scopes to active orders", () => {
    const where = buildOrderWhere(parseReportFilters({}));
    expect(where.isActive).toBe(true);
  });

  it("searches shopeeOrderId or trackingCode case-insensitively", () => {
    const where = buildOrderWhere(parseReportFilters({ q: "spxvn001" }));
    expect(where.OR).toEqual([
      { shopeeOrderId: { contains: "spxvn001", mode: "insensitive" } },
      { trackingCode: { contains: "spxvn001", mode: "insensitive" } },
    ]);
  });

  // status isn't pushed into the DB where clause: the "Khác" bucket means
  // "status longer than N chars", which Prisma has no operator for — it's
  // matched in memory instead, see matchesStatusFilter below.
  it("never sets status on the DB where clause", () => {
    expect(buildOrderWhere(parseReportFilters({ status: ["Hoàn thành", "Đang giao"] })).status).toBeUndefined();
    expect(buildOrderWhere(parseReportFilters({})).status).toBeUndefined();
  });

  it("filters sendStatus by a list of exact values", () => {
    const where = buildOrderWhere(parseReportFilters({ sendStatus: ["sent", "cancelled"] }));
    expect(where.AND).toEqual([{ sendStatus: { in: ["sent", "cancelled"] } }]);
  });

  it("filters sendStatus by null when only 'none' is selected", () => {
    const where = buildOrderWhere(parseReportFilters({ sendStatus: "none" }));
    expect(where.AND).toEqual([{ sendStatus: null }]);
  });

  it("combines null and concrete values with OR when 'none' is selected alongside real values", () => {
    const where = buildOrderWhere(parseReportFilters({ sendStatus: ["sent", "none"] }));
    expect(where.AND).toEqual([{ OR: [{ sendStatus: null }, { sendStatus: { in: ["sent"] } }] }]);
  });

  it("filters cancelReceiptStatus the same way, including the new not_needed value", () => {
    const where = buildOrderWhere(parseReportFilters({ cancelReceiptStatus: ["received_full", "not_needed"] }));
    expect(where.AND).toEqual([{ cancelReceiptStatus: { in: ["received_full", "not_needed"] } }]);
  });

  it("builds a date range for sentAt from sentFrom/sentTo", () => {
    const where = buildOrderWhere(parseReportFilters({ sentFrom: "2026-06-01", sentTo: "2026-06-30" }));
    expect(where.sentAt).toEqual({
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lte: new Date("2026-06-30T23:59:59.999Z"),
    });
  });

  it("builds an open-ended date range when only one side of the range is given", () => {
    const where = buildOrderWhere(parseReportFilters({ cancelFrom: "2026-06-01" }));
    expect(where.cancelReceivedAt).toEqual({ gte: new Date("2026-06-01T00:00:00.000Z") });
  });

  it("omits paidAt entirely when neither paidFrom nor paidTo is set", () => {
    const where = buildOrderWhere(parseReportFilters({}));
    expect(where.paidAt).toBeUndefined();
  });
});

describe("isNoiseCancelledOrder", () => {
  it("hides a cancelled order with a tracking code that staff never touched", () => {
    expect(isNoiseCancelledOrder({ status: "Đã huỷ", trackingCode: "SPXVN00000001", sendStatus: null })).toBe(true);
  });

  it("hides it regardless of which diacritic spelling of huỷ is used", () => {
    expect(isNoiseCancelledOrder({ status: "Đã hủy", trackingCode: "SPXVN00000001", sendStatus: null })).toBe(true);
  });

  it("keeps a cancelled order with no tracking code (nothing was ever shipped)", () => {
    expect(isNoiseCancelledOrder({ status: "Đã huỷ", trackingCode: null, sendStatus: null })).toBe(false);
  });

  it("keeps a cancelled order staff already processed (sendStatus set)", () => {
    expect(isNoiseCancelledOrder({ status: "Đã huỷ", trackingCode: "SPXVN00000001", sendStatus: "cancelled" })).toBe(false);
  });

  it("keeps a non-cancelled order even with a tracking code and no sendStatus", () => {
    expect(isNoiseCancelledOrder({ status: "Đang giao", trackingCode: "SPXVN00000001", sendStatus: null })).toBe(false);
  });
});

describe("matchesPaymentMatchFilter", () => {
  it("matches everything when no filter is set", () => {
    expect(matchesPaymentMatchFilter("matched", [])).toBe(true);
    expect(matchesPaymentMatchFilter(null, [])).toBe(true);
  });

  it("matches only rows with no payment yet when filter is 'none'", () => {
    expect(matchesPaymentMatchFilter(null, ["none"])).toBe(true);
    expect(matchesPaymentMatchFilter("matched", ["none"])).toBe(false);
  });

  it("matches exact payment match state otherwise", () => {
    expect(matchesPaymentMatchFilter("not_matched", ["not_matched"])).toBe(true);
    expect(matchesPaymentMatchFilter("matched", ["not_matched"])).toBe(false);
  });

  it("matches any one of several selected values", () => {
    expect(matchesPaymentMatchFilter("not_matched", ["matched", "not_matched"])).toBe(true);
    expect(matchesPaymentMatchFilter(null, ["matched", "none"])).toBe(true);
    expect(matchesPaymentMatchFilter("matched", ["not_matched", "none"])).toBe(false);
  });
});

describe("matchesStatusFilter", () => {
  it("matches everything when no filter is set", () => {
    expect(matchesStatusFilter("Hoàn thành", [])).toBe(true);
    expect(matchesStatusFilter("bất kỳ chuỗi dài nào cũng được, không quan trọng", [])).toBe(true);
  });

  it("matches an exact short status value", () => {
    expect(matchesStatusFilter("Hoàn thành", ["Hoàn thành"])).toBe(true);
    expect(matchesStatusFilter("Đang giao", ["Hoàn thành"])).toBe(false);
  });

  it("matches any status longer than the threshold when 'Khác' is selected", () => {
    const longStatus =
      "Người mua xác nhận đã nhận được hàng, tuy nhiên Người mua vẫn có thể gửi yêu cầu Trả hàng/Hoàn tiền tới ngày 2026-09-10.";
    expect(matchesStatusFilter(longStatus, [STATUS_OTHER_VALUE])).toBe(true);
    expect(matchesStatusFilter("Hoàn thành", [STATUS_OTHER_VALUE])).toBe(false);
  });

  it("combines a short value and 'Khác' via OR", () => {
    const longStatus = "x".repeat(40);
    expect(matchesStatusFilter("Hoàn thành", ["Hoàn thành", STATUS_OTHER_VALUE])).toBe(true);
    expect(matchesStatusFilter(longStatus, ["Hoàn thành", STATUS_OTHER_VALUE])).toBe(true);
    expect(matchesStatusFilter("Đang giao", ["Hoàn thành", STATUS_OTHER_VALUE])).toBe(false);
  });
});

describe("reportFiltersToSearchParams", () => {
  it("omits empty fields and keeps only set ones", () => {
    const params = reportFiltersToSearchParams(parseReportFilters({ q: "abc", sendStatus: "sent" }));
    expect(params.toString()).toBe("q=abc&sendStatus=sent");
  });

  it("repeats the key for each selected value in a multi-select field", () => {
    const params = reportFiltersToSearchParams(parseReportFilters({ sendStatus: ["sent", "cancelled"] }));
    expect(params.getAll("sendStatus")).toEqual(["sent", "cancelled"]);
  });

  it("produces an empty string when no filters are set", () => {
    const params = reportFiltersToSearchParams(parseReportFilters({}));
    expect(params.toString()).toBe("");
  });
});

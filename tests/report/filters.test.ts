import { describe, it, expect } from "vitest";
import {
  parseReportFilters,
  buildOrderWhere,
  matchesPaymentMatchFilter,
  reportFiltersToSearchParams,
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

  it("filters status by a list of exact values", () => {
    const where = buildOrderWhere(parseReportFilters({ status: ["Hoàn thành", "Đang giao"] }));
    expect(where.status).toEqual({ in: ["Hoàn thành", "Đang giao"] });
  });

  it("omits status entirely when no value is selected", () => {
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

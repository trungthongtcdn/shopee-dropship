import { describe, it, expect } from "vitest";
import {
  parseReportFilters,
  buildOrderWhere,
  matchesPaymentMatchFilter,
  reportFiltersToSearchParams,
} from "@/lib/report/filters";

describe("parseReportFilters", () => {
  it("defaults every field to an empty string when absent", () => {
    const filters = parseReportFilters({});
    expect(filters.q).toBe("");
    expect(filters.paymentMatch).toBe("");
    expect(filters.sendStatus).toBe("");
  });

  it("trims whitespace from the search query", () => {
    const filters = parseReportFilters({ q: "  260621MB6WJXKM  " });
    expect(filters.q).toBe("260621MB6WJXKM");
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

  it("filters sendStatus by exact value, and by null for 'none'", () => {
    expect(buildOrderWhere(parseReportFilters({ sendStatus: "sent" })).sendStatus).toBe("sent");
    expect(buildOrderWhere(parseReportFilters({ sendStatus: "none" })).sendStatus).toBeNull();
    expect(buildOrderWhere(parseReportFilters({})).sendStatus).toBeUndefined();
  });

  it("filters cancelReceiptStatus by exact value, and by null for 'none'", () => {
    expect(buildOrderWhere(parseReportFilters({ cancelReceiptStatus: "received_full" })).cancelReceiptStatus).toBe(
      "received_full"
    );
    expect(buildOrderWhere(parseReportFilters({ cancelReceiptStatus: "none" })).cancelReceiptStatus).toBeNull();
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
    expect(matchesPaymentMatchFilter("matched", "")).toBe(true);
    expect(matchesPaymentMatchFilter(null, "")).toBe(true);
  });

  it("matches only rows with no payment yet when filter is 'none'", () => {
    expect(matchesPaymentMatchFilter(null, "none")).toBe(true);
    expect(matchesPaymentMatchFilter("matched", "none")).toBe(false);
  });

  it("matches exact payment match state otherwise", () => {
    expect(matchesPaymentMatchFilter("not_matched", "not_matched")).toBe(true);
    expect(matchesPaymentMatchFilter("matched", "not_matched")).toBe(false);
  });
});

describe("reportFiltersToSearchParams", () => {
  it("omits empty fields and keeps only set ones", () => {
    const params = reportFiltersToSearchParams(parseReportFilters({ q: "abc", sendStatus: "sent" }));
    expect(params.toString()).toBe("q=abc&sendStatus=sent");
  });

  it("produces an empty string when no filters are set", () => {
    const params = reportFiltersToSearchParams(parseReportFilters({}));
    expect(params.toString()).toBe("");
  });
});

import type { Prisma } from "@prisma/client";

export const SEND_STATUS_FILTER_OPTIONS = ["sent", "cancelled", "none"] as const;
export const CANCEL_RECEIPT_FILTER_OPTIONS = ["received_full", "not_received", "received_partial", "none"] as const;
export const PAYMENT_MATCH_FILTER_OPTIONS = ["matched", "not_matched", "none"] as const;

export interface ReportFilters {
  q: string;
  paymentMatch: "" | (typeof PAYMENT_MATCH_FILTER_OPTIONS)[number];
  sendStatus: "" | (typeof SEND_STATUS_FILTER_OPTIONS)[number];
  cancelReceiptStatus: "" | (typeof CANCEL_RECEIPT_FILTER_OPTIONS)[number];
  sentFrom: string;
  sentTo: string;
  cancelFrom: string;
  cancelTo: string;
  paidFrom: string;
  paidTo: string;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function str(raw: RawSearchParams, key: string): string {
  const value = raw[key];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseReportFilters(raw: RawSearchParams): ReportFilters {
  return {
    q: str(raw, "q"),
    paymentMatch: str(raw, "paymentMatch") as ReportFilters["paymentMatch"],
    sendStatus: str(raw, "sendStatus") as ReportFilters["sendStatus"],
    cancelReceiptStatus: str(raw, "cancelReceiptStatus") as ReportFilters["cancelReceiptStatus"],
    sentFrom: str(raw, "sentFrom"),
    sentTo: str(raw, "sentTo"),
    cancelFrom: str(raw, "cancelFrom"),
    cancelTo: str(raw, "cancelTo"),
    paidFrom: str(raw, "paidFrom"),
    paidTo: str(raw, "paidTo"),
  };
}

function dateRange(from: string, to: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000Z`);
  if (to) range.lte = new Date(`${to}T23:59:59.999Z`);
  return range;
}

// Only the Order-model fields that live directly on the row can be pushed
// into the DB query. paymentMatch is computed after joining Product +
// PaymentRecord (see buildReportRows) and is filtered separately, in memory,
// after that join — see filterRowsByPaymentMatch below.
export function buildOrderWhere(filters: ReportFilters): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { isActive: true };

  if (filters.q) {
    where.OR = [
      { shopeeOrderId: { contains: filters.q, mode: "insensitive" } },
      { trackingCode: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  if (filters.sendStatus === "none") where.sendStatus = null;
  else if (filters.sendStatus) where.sendStatus = filters.sendStatus;

  if (filters.cancelReceiptStatus === "none") where.cancelReceiptStatus = null;
  else if (filters.cancelReceiptStatus) where.cancelReceiptStatus = filters.cancelReceiptStatus;

  const sentAt = dateRange(filters.sentFrom, filters.sentTo);
  if (sentAt) where.sentAt = sentAt;

  const cancelReceivedAt = dateRange(filters.cancelFrom, filters.cancelTo);
  if (cancelReceivedAt) where.cancelReceivedAt = cancelReceivedAt;

  const paidAt = dateRange(filters.paidFrom, filters.paidTo);
  if (paidAt) where.paidAt = paidAt;

  return where;
}

export function matchesPaymentMatchFilter(
  rowPaymentMatch: "matched" | "not_matched" | null,
  filter: ReportFilters["paymentMatch"]
): boolean {
  if (!filter) return true;
  if (filter === "none") return rowPaymentMatch === null;
  return rowPaymentMatch === filter;
}

export function reportFiltersToSearchParams(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

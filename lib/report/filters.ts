import { Prisma, type OrderSendStatus, type CancelReceiptStatus } from "@prisma/client";

export const SEND_STATUS_FILTER_OPTIONS = ["sent", "cancelled", "none"] as const;
export const CANCEL_RECEIPT_FILTER_OPTIONS = [
  "received_full",
  "not_received",
  "received_partial",
  "not_needed",
  "none",
] as const;
export const PAYMENT_MATCH_FILTER_OPTIONS = ["matched", "not_matched", "none"] as const;

// Order.status is free text from the Shopee sheet, not a fixed enum — real
// categories are all short ("Chờ giao hàng", "Hoàn thành", ~20 chars max).
// Some orders instead carry an auto-generated sentence with a dynamic date
// baked in (the post-delivery return-window notice), a fresh distinct value
// every day — listing each as its own pill blew up the filter toolbar in
// production (1209 orders → dozens of giant pills). Anything over this
// length is grouped into one "Khác" pill (STATUS_OTHER_VALUE) instead of
// being listed individually.
export const STATUS_OPTION_MAX_LENGTH = 30;
export const STATUS_OTHER_VALUE = "__other__";

// All multi-select: each holds zero or more of the values above (or, for
// `status`, zero or more of whatever distinct Order.status strings actually
// exist right now — that field is free text from the Shopee sheet, not a
// fixed enum, so its options are looked up at render time instead of listed
// here). Empty array means "no filter on this field", not "match nothing".
export interface ReportFilters {
  q: string;
  paymentMatch: string[];
  sendStatus: string[];
  cancelReceiptStatus: string[];
  status: string[];
  // "Kết quả giao thực tế" — derived from the Cancellation table (see
  // deriveDeliveryResult), so like paymentMatch/status this is matched in
  // memory, not pushed into the DB query. See matchesDeliveryResultFilter.
  deliveryResult: string[];
  luanCheck: boolean;
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

function strArray(raw: RawSearchParams, key: string): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map((v) => v.trim()).filter(Boolean);
}

export function parseReportFilters(raw: RawSearchParams): ReportFilters {
  return {
    q: str(raw, "q"),
    paymentMatch: strArray(raw, "paymentMatch"),
    sendStatus: strArray(raw, "sendStatus"),
    cancelReceiptStatus: strArray(raw, "cancelReceiptStatus"),
    status: strArray(raw, "status"),
    deliveryResult: strArray(raw, "deliveryResult"),
    luanCheck: str(raw, "luanCheck") === "true",
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

// A multi-select that includes "none" (meaning "field is null") alongside
// real enum values needs an OR — Prisma's `{ in: [...] }` can't express
// "null or one of these" in a single condition.
function selectedOrNull<T extends string>(
  values: string[],
  field: "sendStatus" | "cancelReceiptStatus"
): Prisma.OrderWhereInput | undefined {
  if (values.length === 0) return undefined;
  const concrete = values.filter((v) => v !== "none") as T[];
  const hasNone = values.includes("none");

  if (hasNone && concrete.length > 0) {
    return { OR: [{ [field]: null }, { [field]: { in: concrete } }] };
  }
  if (hasNone) {
    return { [field]: null };
  }
  return { [field]: { in: concrete } };
}

// Only the Order-model fields that live directly on the row can be pushed
// into the DB query. paymentMatch is computed after joining Product +
// PaymentRecord (see buildReportRows) and is filtered separately, in memory,
// after that join — see matchesPaymentMatchFilter below.
//
// returnTrackingMatchedOrderIds: the search box also matches "Mã vận đơn
// trả hàng" (returnTrackingCode), which lives on the Cancellation table, not
// Order — can't be expressed in this Order-only where clause directly.
// loadReportRows.ts resolves that match separately (a Cancellation query)
// and passes the resulting shopeeOrderIds in here to fold into the same OR.
export function buildOrderWhere(
  filters: ReportFilters,
  returnTrackingMatchedOrderIds: string[] = []
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = { isActive: true };
  const and: Prisma.OrderWhereInput[] = [];

  if (filters.q) {
    const orConditions: Prisma.OrderWhereInput[] = [
      { shopeeOrderId: { contains: filters.q, mode: "insensitive" } },
      { trackingCode: { contains: filters.q, mode: "insensitive" } },
    ];
    if (returnTrackingMatchedOrderIds.length > 0) {
      orConditions.push({ shopeeOrderId: { in: returnTrackingMatchedOrderIds } });
    }
    where.OR = orConditions;
  }

  const sendStatusCond = selectedOrNull<OrderSendStatus>(filters.sendStatus, "sendStatus");
  if (sendStatusCond) and.push(sendStatusCond);

  const cancelReceiptCond = selectedOrNull<CancelReceiptStatus>(filters.cancelReceiptStatus, "cancelReceiptStatus");
  if (cancelReceiptCond) and.push(cancelReceiptCond);

  if (filters.luanCheck) {
    and.push({ luanCheck: false });
  }

  const sentAt = dateRange(filters.sentFrom, filters.sentTo);
  if (sentAt) where.sentAt = sentAt;

  const cancelReceivedAt = dateRange(filters.cancelFrom, filters.cancelTo);
  if (cancelReceivedAt) where.cancelReceivedAt = cancelReceivedAt;

  const paidAt = dateRange(filters.paidFrom, filters.paidTo);
  if (paidAt) where.paidAt = paidAt;

  if (and.length > 0) where.AND = and;

  return where;
}

// Like paymentMatch, this can't be a plain DB `{ in: [...] }` because the
// "Khác" bucket isn't a literal status value — it means "status longer than
// STATUS_OPTION_MAX_LENGTH", which Prisma has no operator for. Filtered here
// in memory instead, same place paymentMatch is.
export function matchesStatusFilter(rowStatus: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) =>
    filter === STATUS_OTHER_VALUE ? rowStatus.length > STATUS_OPTION_MAX_LENGTH : rowStatus === filter
  );
}

function isCancelledStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("hủy") || s.includes("huỷ");
}

// Baseline noise rule for the Report page, not a togglable filter — always
// applied. A cancelled order with no trackingCode was never even sent to a
// carrier — nothing was ever shipped, so there's nothing left to reconcile
// or pack. A cancelled order that DOES have a trackingCode still shows
// normally regardless of sendStatus — Shopee already assigned a waybill,
// so staff still need to see it in the LUÂN CẦN worklist.
export function isNoiseCancelledOrder(row: { status: string; trackingCode: string | null }): boolean {
  return isCancelledStatus(row.status) && row.trackingCode === null;
}

export function matchesPaymentMatchFilter(
  rowPaymentMatch: "matched" | "not_matched" | null,
  filters: string[]
): boolean {
  if (filters.length === 0) return true;
  return filters.some((filter) => (filter === "none" ? rowPaymentMatch === null : rowPaymentMatch === filter));
}

export function matchesDeliveryResultFilter(rowDeliveryResult: string, filters: string[]): boolean {
  if (filters.length === 0) return true;
  return filters.includes(rowDeliveryResult);
}

export function reportFiltersToSearchParams(filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  for (const v of filters.paymentMatch) params.append("paymentMatch", v);
  for (const v of filters.sendStatus) params.append("sendStatus", v);
  for (const v of filters.cancelReceiptStatus) params.append("cancelReceiptStatus", v);
  for (const v of filters.status) params.append("status", v);
  for (const v of filters.deliveryResult) params.append("deliveryResult", v);
  if (filters.sentFrom) params.set("sentFrom", filters.sentFrom);
  if (filters.sentTo) params.set("sentTo", filters.sentTo);
  if (filters.cancelFrom) params.set("cancelFrom", filters.cancelFrom);
  if (filters.cancelTo) params.set("cancelTo", filters.cancelTo);
  if (filters.paidFrom) params.set("paidFrom", filters.paidFrom);
  if (filters.paidTo) params.set("paidTo", filters.paidTo);
  return params;
}

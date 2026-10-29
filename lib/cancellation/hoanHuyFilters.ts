import type { CancelReceiptStatus } from "@prisma/client";

// Filter value for "nothing entered / no status" in both multi-selects below.
export const NO_VALUE = "none";

const RECEIPT_VALUES: string[] = ["received_full", "received_partial", "not_received", "not_needed", NO_VALUE];

export interface ReceiptRefundFilters {
  // CancelReceiptStatus values and/or NO_VALUE. Empty = no filter.
  receipt: string[];
  // Raw "Trạng thái Trả hàng/Hoàn tiền" texts and/or NO_VALUE. Empty = no filter.
  refundStatus: string[];
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function strArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
}

// The "loại" filter is parseCancellationFilters' `types`; these two are the
// receipt / return-refund-status ones, parsed apart so that parser (and its
// shop-specific callers) stay as they are.
export function parseReceiptRefundFilters(raw: RawSearchParams): ReceiptRefundFilters {
  return {
    receipt: strArray(raw.receipt).filter((v) => RECEIPT_VALUES.includes(v)),
    refundStatus: strArray(raw.refundStatus),
  };
}

// "Quá hạn": only the rows behind the header's overdue banner (loadOverdueWarnings).
// The banner links here with ?overdue=1.
export function parseOverdueFilter(raw: RawSearchParams): boolean {
  return strArray(raw.overdue)[0] === "1";
}

// `status` is the order-level receipt status (receiptStatusFor): null = blank.
export function matchesReceiptFilter(status: CancelReceiptStatus | null, selected: string[]): boolean {
  return selected.length === 0 || selected.includes(status ?? NO_VALUE);
}

export function matchesRefundStatusFilter(status: string | null, selected: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.includes(status?.trim() || NO_VALUE);
}

// Options come from the loaded rows (the status is free text from the sheet),
// plus any selected value no loaded row has, so a search narrowing the rows
// doesn't silently drop a ticked box.
export function refundStatusOptions(statuses: (string | null)[], selected: string[]): { value: string; label: string }[] {
  const distinct = new Set<string>();
  let hasBlank = false;
  for (const status of statuses) {
    const trimmed = status?.trim();
    if (trimmed) distinct.add(trimmed);
    else hasBlank = true;
  }
  for (const value of selected) {
    if (value !== NO_VALUE) distinct.add(value);
  }

  const options = [...distinct].sort((a, b) => a.localeCompare(b, "vi")).map((value) => ({ value, label: value }));
  if (hasBlank || selected.includes(NO_VALUE)) options.push({ value: NO_VALUE, label: "(Trống)" });
  return options;
}

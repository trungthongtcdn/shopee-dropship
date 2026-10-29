import { createHash } from "node:crypto";
import { getByHeader } from "@/lib/sync/headerLookup";
import type { IncomingRow } from "@/lib/sync/types";

// The cancellation family keeps one row per (order, type), but a sheet can list the
// same order on several rows: sheet 5 once per return request (a buyer who cancels a
// return and opens another leaves both), 4.1 / 4.2 once per product line. Handed to
// the diff as they are, those rows share a key — the second insert fails, and every
// later sync "updates" the one stored row to whichever of them it saw last, so the
// stored data alternates between them.
//
// Rows of one order are merged into a single row instead:
//   - the row lowest in the sheet is the one shown — the newest request, since
//     rows are appended;
//   - its hash covers all the merged rows, so a change in any of them is an update;
//   - every return tracking code is kept, newest first (see returnTrackingCodesOf).

const RETURN_TRACKING_HEADER = "Mã vận đơn trả hàng";

export interface CollapsedRow extends IncomingRow {
  // Set only on a merged row; a single row's codes are just its own.
  returnTrackingCodes?: string[];
}

function orderIdOf(row: IncomingRow): string {
  return String(getByHeader(row.data, "Mã đơn hàng") ?? "").trim();
}

function ownReturnCode(row: IncomingRow): string[] {
  const code = String(getByHeader(row.data, RETURN_TRACKING_HEADER) ?? "").trim();
  return code === "" ? [] : [code];
}

export function returnTrackingCodesOf(row: IncomingRow): string[] {
  return (row as CollapsedRow).returnTrackingCodes ?? ownReturnCode(row);
}

function merge(group: IncomingRow[]): CollapsedRow {
  const newestFirst = [...group].sort((a, b) => b.rowIndex - a.rowIndex);
  const hash = createHash("sha256")
    .update(newestFirst.map((row) => row.hash).join("|"))
    .digest("hex");
  return { ...newestFirst[0], hash, returnTrackingCodes: [...new Set(newestFirst.flatMap(ownReturnCode))] };
}

// Keeps the order in which each order first appears. A row with no order id belongs
// to no order and is passed through to fail on its own.
export function collapseRowsByOrder(rows: IncomingRow[]): CollapsedRow[] {
  const groups = new Map<string, IncomingRow[]>();
  const sequence: (string | IncomingRow)[] = [];

  for (const row of rows) {
    const orderId = orderIdOf(row);
    if (orderId === "") {
      sequence.push(row);
      continue;
    }
    const group = groups.get(orderId);
    if (group) {
      group.push(row);
    } else {
      groups.set(orderId, [row]);
      sequence.push(orderId);
    }
  }

  return sequence.map((item) => {
    if (typeof item !== "string") return item;
    const group = groups.get(item) as IncomingRow[];
    return group.length === 1 ? group[0] : merge(group);
  });
}

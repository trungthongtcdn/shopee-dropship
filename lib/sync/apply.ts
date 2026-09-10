// lib/sync/apply.ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeSyncDiff } from "@/lib/sync/diff";
import type { IncomingRow, SyncTab } from "@/lib/sync/types";

interface RowError {
  identifier: string;
  error: string;
}

// Counts reflect rows that actually completed their write (and their sync_log
// entry) without throwing — not the pre-write diff sizes. A row whose write
// fails lands in `rowErrors` and is excluded from these counts.
export interface ApplyResult {
  inserted: number;
  updated: number;
  softDeleted: number;
  rowErrors: RowError[];
}

interface TabDelegate {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  findFirst: (args: unknown) => Promise<({ id: number } & Record<string, unknown>) | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
}

function toJsonSafe(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}

async function applyTabPayload(
  tab: SyncTab,
  delegate: TabDelegate,
  keyField: string,
  keyOf: (row: IncomingRow) => string,
  mapRow: (row: IncomingRow) => Record<string, unknown>,
  rows: IncomingRow[]
): Promise<ApplyResult> {
  const existingRows = await delegate.findMany({
    where: { isActive: true },
    select: { [keyField]: true, rawRowHash: true },
  });

  const existing = existingRows.map((row) => ({
    key: String(row[keyField]),
    hash: String(row.rawRowHash),
  }));

  const diff = computeSyncDiff(existing, rows, keyOf);
  const rowErrors: RowError[] = [];
  let inserted = 0;
  let updated = 0;
  let softDeleted = 0;

  for (const row of diff.inserts) {
    try {
      const created = await delegate.create({ data: mapRow(row) });
      await prisma.syncLog.create({
        data: { sourceTab: tab, sheetRowIndex: row.rowIndex, changeType: "insert", newValue: toJsonSafe(created) },
      });
      inserted += 1;
    } catch (error) {
      rowErrors.push({ identifier: String(row.rowIndex), error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const row of diff.updates) {
    try {
      const before = await delegate.findFirst({ where: { [keyField]: keyOf(row), isActive: true } });
      if (!before) continue;
      const updatedRow = await delegate.update({ where: { id: before.id }, data: mapRow(row) });
      await prisma.syncLog.create({
        data: {
          sourceTab: tab,
          sheetRowIndex: row.rowIndex,
          changeType: "update",
          oldValue: toJsonSafe(before),
          newValue: toJsonSafe(updatedRow),
        },
      });
      updated += 1;
    } catch (error) {
      rowErrors.push({ identifier: String(row.rowIndex), error: error instanceof Error ? error.message : String(error) });
    }
  }

  for (const key of diff.softDeletes) {
    try {
      const before = await delegate.findFirst({ where: { [keyField]: key, isActive: true } });
      if (!before) continue;
      await delegate.update({ where: { id: before.id }, data: { isActive: false, deletedAt: new Date() } });
      await prisma.syncLog.create({
        data: { sourceTab: tab, sheetRowIndex: Number(before.sheetRowIndex), changeType: "delete", oldValue: toJsonSafe(before) },
      });
      softDeleted += 1;
    } catch (error) {
      rowErrors.push({ identifier: key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { inserted, updated, softDeleted, rowErrors };
}

function mapOrderRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(row.data.shopee_order_id),
    sku: String(row.data.sku),
    productName: String(row.data.product_name),
    quantity: Number(row.data.quantity),
    unitPrice: Number(row.data.unit_price),
    totalAmount: Number(row.data.total_amount),
    status: String(row.data.status),
  };
}

function mapCancellationRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(row.data.shopee_order_id),
    reason: String(row.data.reason),
    cancelledAt: new Date(String(row.data.cancelled_at)),
  };
}

function mapProductRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    sku: String(row.data.sku),
    productName: String(row.data.product_name),
    price: Number(row.data.price),
  };
}

const keyOfOrderRow = (row: IncomingRow) => String(row.data.shopee_order_id);
const keyOfCancellationRow = (row: IncomingRow) => String(row.data.shopee_order_id);
const keyOfProductRow = (row: IncomingRow) => String(row.data.sku);

export function applyOrdersPayload(rows: IncomingRow[]) {
  return applyTabPayload("orders", prisma.order as unknown as TabDelegate, "shopeeOrderId", keyOfOrderRow, mapOrderRow, rows);
}

export function applyCancellationsPayload(rows: IncomingRow[]) {
  return applyTabPayload(
    "cancellations",
    prisma.cancellation as unknown as TabDelegate,
    "shopeeOrderId",
    keyOfCancellationRow,
    mapCancellationRow,
    rows
  );
}

export function applyProductsPayload(rows: IncomingRow[]) {
  return applyTabPayload("products", prisma.product as unknown as TabDelegate, "sku", keyOfProductRow, mapProductRow, rows);
}

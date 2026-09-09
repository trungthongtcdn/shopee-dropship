// lib/sync/apply.ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeSyncDiff } from "@/lib/sync/diff";
import type { IncomingRow, SyncTab } from "@/lib/sync/types";

interface TabDelegate {
  findMany: (args: unknown) => Promise<{ sheetRowIndex: number; rawRowHash: string }[]>;
  findFirst: (args: unknown) => Promise<{ id: number } & Record<string, unknown>>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
}

function toJsonSafe(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}

async function applyTabPayload(
  tab: SyncTab,
  delegate: TabDelegate,
  mapRow: (row: IncomingRow) => Record<string, unknown>,
  rows: IncomingRow[]
) {
  const existing = await delegate.findMany({
    where: { isActive: true },
    select: { sheetRowIndex: true, rawRowHash: true },
  });

  const diff = computeSyncDiff(
    existing.map((row) => ({ rowIndex: row.sheetRowIndex, hash: row.rawRowHash })),
    rows
  );

  for (const row of diff.inserts) {
    const created = await delegate.create({ data: mapRow(row) });
    await prisma.syncLog.create({
      data: { sourceTab: tab, sheetRowIndex: row.rowIndex, changeType: "insert", newValue: toJsonSafe(created) },
    });
  }

  for (const row of diff.updates) {
    const before = await delegate.findFirst({ where: { sheetRowIndex: row.rowIndex, isActive: true } });
    const updated = await delegate.update({ where: { id: before.id }, data: mapRow(row) });
    await prisma.syncLog.create({
      data: {
        sourceTab: tab,
        sheetRowIndex: row.rowIndex,
        changeType: "update",
        oldValue: toJsonSafe(before),
        newValue: toJsonSafe(updated),
      },
    });
  }

  for (const rowIndex of diff.softDeletes) {
    const before = await delegate.findFirst({ where: { sheetRowIndex: rowIndex, isActive: true } });
    if (!before) continue;
    await delegate.update({ where: { id: before.id }, data: { isActive: false, deletedAt: new Date() } });
    await prisma.syncLog.create({
      data: { sourceTab: tab, sheetRowIndex: rowIndex, changeType: "delete", oldValue: toJsonSafe(before) },
    });
  }

  return diff;
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

export function applyOrdersPayload(rows: IncomingRow[]) {
  return applyTabPayload("orders", prisma.order as unknown as TabDelegate, mapOrderRow, rows);
}

export function applyCancellationsPayload(rows: IncomingRow[]) {
  return applyTabPayload("cancellations", prisma.cancellation as unknown as TabDelegate, mapCancellationRow, rows);
}

export function applyProductsPayload(rows: IncomingRow[]) {
  return applyTabPayload("products", prisma.product as unknown as TabDelegate, mapProductRow, rows);
}

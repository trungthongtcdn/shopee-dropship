import { Prisma, CancellationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeSyncDiff } from "@/lib/sync/diff";
import { getByHeader, getString, getDate, getInt } from "@/lib/sync/headerLookup";
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
  selectFields: string[],
  keyOfExisting: (row: Record<string, unknown>) => string,
  keyOf: (row: IncomingRow) => string,
  whereOf: (row: IncomingRow) => Record<string, unknown>,
  mapRow: (row: IncomingRow) => Record<string, unknown>,
  rows: IncomingRow[],
  // Scopes which existing rows this sync is even allowed to see. Required for
  // the cancellation family, where three sheet tabs share one table: without
  // this, syncing "delivery_failed" would see "cancelled" rows for the same
  // order as stale leftovers and soft-delete them.
  scopeWhere: Record<string, unknown> = {}
): Promise<ApplyResult> {
  const existingRows = await delegate.findMany({
    where: { isActive: true, ...scopeWhere },
    select: Object.fromEntries([...selectFields, "rawRowHash"].map((field) => [field, true])),
  });

  const existing = existingRows.map((row) => ({
    key: keyOfExisting(row),
    hash: String(row.rawRowHash),
  }));

  // Soft-deletes only carry the diff key (built from existing rows), not the
  // original field values, so keep a lookup back to a where-clause fragment
  // for rows whose key isn't a single unique DB column (e.g. composite keys).
  const whereByExistingKey = new Map<string, Record<string, unknown>>(
    existingRows.map((row) => [keyOfExisting(row), Object.fromEntries(selectFields.map((field) => [field, row[field]]))])
  );

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
      const before = await delegate.findFirst({ where: { ...whereOf(row), isActive: true } });
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
      const where = whereByExistingKey.get(key);
      if (!where) continue;
      const before = await delegate.findFirst({ where: { ...where, isActive: true } });
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

// Header aliases below are exact strings read from the live Shopee sheet
// (tabs "2. Danh sách đơn hàng", "3. Đơn hàng đã giao", "4.2 Giao thất bại",
// "6. Check tồn kho dự kiến"). Capitalization is inconsistent between tabs in
// the source sheet itself (e.g. "Mã Kiện Hàng" vs "Mã kiện hàng"), which is
// why lookups go through getByHeader's case-insensitive matching rather than
// exact keys. "4.1 Đơn hủy" and "5. Trả hàng/hoàn tiền" were not inspected
// directly — they're assumed to share 4.2's column layout (same workbook,
// same template) and reuse the same alias list.

function mapOrderRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(getByHeader(row.data, "Mã đơn hàng") ?? ""),
    packageCode: getString(row.data, "Mã Kiện Hàng"),
    orderDate: getDate(row.data, "Ngày đặt hàng"),
    status: getString(row.data, "Trạng Thái Đơn Hàng") ?? "",
    trackingCode: getString(row.data, "Mã vận đơn"),
    carrier: getString(row.data, "Đơn Vị Vận Chuyển"),
    deliveryMethod: getString(row.data, "Phương thức giao hàng"),
    expectedDeliveryDate: getDate(row.data, "Ngày giao hàng dự kiến"),
    orderQuantity: getInt(row.data, "Số lượng sản phẩm 1 đơn"),
    productName: getString(row.data, "Tên sản phẩm"),
    // Part of this table's unique constraint — normalized to "" rather than
    // left null, since Postgres treats every NULL as distinct in a unique
    // index (two "no variant" lines of the same order would not collide).
    categoryName: getString(row.data, "Tên phân loại hàng") ?? "",
    lineQuantity: getInt(row.data, "Số lượng"),
  };
}

function mapDeliveredOrderRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(getByHeader(row.data, "Mã đơn hàng") ?? ""),
    packageCode: getString(row.data, "Mã Kiện Hàng"),
    orderDate: getDate(row.data, "Ngày đặt hàng"),
    status: getString(row.data, "Trạng Thái Đơn Hàng") ?? "",
    trackingCode: getString(row.data, "Mã vận đơn"),
    carrier: getString(row.data, "Đơn Vị Vận Chuyển"),
    deliveredAt: getDate(row.data, "Thời gian giao hàng"),
    completedAt: getDate(row.data, "Thời gian hoàn thành đơn hàng"),
    returnRefundStatus: getString(row.data, "Trạng thái Trả hàng/Hoàn tiền"),
    productName: getString(row.data, "Tên sản phẩm"),
    warehouseName: getString(row.data, "Tên kho hàng"),
    // Same normalization as Order.categoryName — part of this table's unique
    // constraint, so "" rather than null to avoid Postgres's NULL-is-distinct
    // behavior in unique indexes.
    categoryName: getString(row.data, "Tên phân loại hàng") ?? "",
  };
}

function mapCancellationRow(type: CancellationType) {
  return (row: IncomingRow) => ({
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(getByHeader(row.data, "Mã đơn hàng") ?? ""),
    type,
    packageCode: getString(row.data, "Mã Kiện Hàng"),
    orderDate: getDate(row.data, "Ngày đặt hàng"),
    status: getString(row.data, "Trạng Thái Đơn Hàng"),
    // "Lý do hủy" (4.1), "Nhận xét từ Người mua" (4.2), and "Ghi chú của
    // Người mua khi trả hàng" (5) are different real headers for the same
    // kind of free-text buyer note — merged into one field.
    buyerNote: getString(row.data, "Nhận xét từ Người mua", "Lý do hủy", "Ghi chú của Người mua khi trả hàng"),
    // "Mã vận đơn"/"Đơn Vị Vận Chuyển" (4.1/4.2) are the outbound tracking
    // info; tab 5 names the same concept "Mã vận đơn giao hàng"/"Đơn vị vận
    // chuyển giao hàng" since it also has a separate RETURN shipment below.
    trackingCode: getString(row.data, "Mã vận đơn", "Mã vận đơn giao hàng"),
    carrier: getString(row.data, "Đơn Vị Vận Chuyển", "Đơn vị vận chuyển giao hàng"),
    expectedDeliveryDate: getDate(row.data, "Ngày giao hàng dự kiến"),
    deliveredAt: getDate(row.data, "Thời gian giao hàng"),
    // Real header spells "hủy" (mark on u), not "huỷ" (mark on y) — the two
    // look identical but are different Unicode sequences and do not match.
    cancelledAt: getDate(row.data, "Ngày hủy thành công"),
    productName: getString(row.data, "Tên sản phẩm"),
    warehouseName: getString(row.data, "Tên kho hàng"),
    // Tab 5 names this column "Phân loại hàng" (no "Tên" prefix), unlike
    // every other tab's "Tên phân loại hàng".
    categoryName: getString(row.data, "Tên phân loại hàng", "Phân loại hàng"),
    returnedQuantity: getInt(row.data, "Số lượng sản phẩm được hoàn trả", "Số lượng Hoàn"),
    returnRefundStatus: getString(row.data, "Trạng thái Trả hàng/Hoàn tiền"),
    // Everything below is specific to "5. Trả hàng/hoàn tiền" — its own
    // complaint/refund workflow, absent from 4.1/4.2. Synced now even though
    // no dashboard page reads these fields yet.
    complaintId: getString(row.data, "Mã số khiếu nại"),
    buyerName: getString(row.data, "Người Mua"),
    sku: getString(row.data, "SKU sản phẩm"),
    unitPrice: getInt(row.data, "Đơn Giá"),
    complaintAt: getDate(row.data, "Thời gian khiếu nại"),
    fullOrderReturn: getString(row.data, "Trả hàng/Hoàn tiền toàn bộ Đơn Hàng?"),
    returnMethod: getString(row.data, "Phương án"),
    returnReason: getString(row.data, "Lí do Trả hàng/Hoàn tiền"),
    refundAmount: getInt(row.data, "Tổng số tiền Hoàn trả"),
    refundedAt: getDate(row.data, "Thời gian hoàn tiền"),
    returnCarrier: getString(row.data, "Đơn vị vận chuyển trả hàng"),
    returnTrackingCode: getString(row.data, "Mã vận đơn trả hàng"),
    returnStatus: getString(row.data, "Trạng thái trả hàng"),
    returnCompletedAt: getDate(row.data, "Thời gian hoàn trả hàng thành công"),
    totalValue: getInt(row.data, "Tổng Giá Trị"),
    complaintStatus: getString(row.data, "Trạng thái xử lý khiếu nại"),
  });
}

function mapProductRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    sku: String(getByHeader(row.data, "MII - Mã phân loại") ?? ""),
    parentSku: getString(row.data, "MII - Mã sản phẩm"),
    productName: getString(row.data, "Tên sản phẩm") ?? "",
    categoryName: getString(row.data, "Tên phân loại"),
    importPrice: getInt(row.data, "Giá nhập chưa VAT") ?? 0,
  };
}

// One order id can span multiple sheet rows — one per product/variant line —
// so the diff key (and the DB unique constraint) is the pair, not the order
// id alone. Two lines of the same order with the same category name would
// still collide; there is no more granular stable identifier on this tab.
function orderKey(shopeeOrderId: string, categoryName: string) {
  return JSON.stringify([shopeeOrderId, categoryName]);
}

const keyOfOrderRow = (row: IncomingRow) =>
  orderKey(String(getByHeader(row.data, "Mã đơn hàng") ?? ""), getString(row.data, "Tên phân loại hàng") ?? "");
const keyOfExistingOrderRow = (row: Record<string, unknown>) =>
  orderKey(String(row.shopeeOrderId), String(row.categoryName ?? ""));
const whereOfOrderRow = (row: IncomingRow) => ({
  shopeeOrderId: String(getByHeader(row.data, "Mã đơn hàng") ?? ""),
  categoryName: getString(row.data, "Tên phân loại hàng") ?? "",
});

const keyOfProductRow = (row: IncomingRow) => String(getByHeader(row.data, "MII - Mã phân loại") ?? "");
const keyOfExistingProductRow = (row: Record<string, unknown>) => String(row.sku);
const whereOfProductRow = (row: IncomingRow) => ({ sku: keyOfProductRow(row) });

// Each of the three "cancellation family" sheet tabs mirrors into the same
// table, distinguished by `type` — the diff key and DB uniqueness are scoped
// per type, so the same order id can appear once per type without colliding.
function cancellationKey(shopeeOrderId: string, type: CancellationType) {
  return JSON.stringify([shopeeOrderId, type]);
}

function keyOfCancellationRow(type: CancellationType) {
  return (row: IncomingRow) => cancellationKey(String(getByHeader(row.data, "Mã đơn hàng") ?? ""), type);
}

function keyOfExistingCancellationRow(row: Record<string, unknown>) {
  return cancellationKey(String(row.shopeeOrderId), row.type as CancellationType);
}

function whereOfCancellationRow(type: CancellationType) {
  return (row: IncomingRow) => ({
    shopeeOrderId: String(getByHeader(row.data, "Mã đơn hàng") ?? ""),
    type,
  });
}

export function applyOrdersPayload(rows: IncomingRow[]) {
  return applyTabPayload(
    "orders",
    prisma.order as unknown as TabDelegate,
    ["shopeeOrderId", "categoryName"],
    keyOfExistingOrderRow,
    keyOfOrderRow,
    whereOfOrderRow,
    mapOrderRow,
    rows
  );
}

export function applyDeliveredOrdersPayload(rows: IncomingRow[]) {
  return applyTabPayload(
    "delivered_orders",
    prisma.deliveredOrder as unknown as TabDelegate,
    ["shopeeOrderId", "categoryName"],
    keyOfExistingOrderRow,
    keyOfOrderRow,
    whereOfOrderRow,
    mapDeliveredOrderRow,
    rows
  );
}

function applyCancellationTabPayload(tab: SyncTab, type: CancellationType, rows: IncomingRow[]) {
  return applyTabPayload(
    tab,
    prisma.cancellation as unknown as TabDelegate,
    ["shopeeOrderId", "type"],
    keyOfExistingCancellationRow,
    keyOfCancellationRow(type),
    whereOfCancellationRow(type),
    mapCancellationRow(type),
    rows,
    { type }
  );
}

export function applyCancelledPayload(rows: IncomingRow[]) {
  return applyCancellationTabPayload("cancelled", CancellationType.cancelled, rows);
}

export function applyDeliveryFailedPayload(rows: IncomingRow[]) {
  return applyCancellationTabPayload("delivery_failed", CancellationType.delivery_failed, rows);
}

export function applyReturnedRefundedPayload(rows: IncomingRow[]) {
  return applyCancellationTabPayload("returned_refunded", CancellationType.returned_refunded, rows);
}

export function applyProductsPayload(rows: IncomingRow[]) {
  return applyTabPayload(
    "products",
    prisma.product as unknown as TabDelegate,
    ["sku"],
    keyOfExistingProductRow,
    keyOfProductRow,
    whereOfProductRow,
    mapProductRow,
    rows
  );
}

export interface SkuPricingResult {
  updated: number;
  skipped: number;
  rowErrors: RowError[];
}

// Comes from a *different* workbook ("MII dữ liệu đối soát Luân up" →
// "THÔNG TIN HÀNG HOÁ"), Luân's own SKU→price reference sheet — not Shopee's.
// Deliberately NOT the insert/update/soft-delete diff pattern: this sync only
// ever patches kiot_code/collect_price onto a Product row that already exists
// from the Shopee-side products sync. A SKU with no matching Product is
// skipped, not created — this sheet doesn't carry enough fields (no
// import_price) to originate a Product row on its own.
export async function applySkuPricingPayload(rows: IncomingRow[]): Promise<SkuPricingResult> {
  let updated = 0;
  let skipped = 0;
  const rowErrors: RowError[] = [];

  for (const row of rows) {
    const sku = String(getByHeader(row.data, "MÃ PHÂN LOẠI (SKU)") ?? "");
    if (!sku) {
      skipped += 1;
      continue;
    }

    try {
      const existing = await prisma.product.findUnique({ where: { sku } });
      if (!existing) {
        skipped += 1;
        continue;
      }

      const updatedProduct = await prisma.product.update({
        where: { sku },
        data: {
          kiotCode: getString(row.data, "MÃ KIOT"),
          collectPrice: getInt(row.data, "GIÁ CẦN THU VỀ"),
        },
      });
      await prisma.syncLog.create({
        data: {
          sourceTab: "sku_pricing",
          sheetRowIndex: row.rowIndex,
          changeType: "update",
          oldValue: toJsonSafe(existing),
          newValue: toJsonSafe(updatedProduct),
        },
      });
      updated += 1;
    } catch (error) {
      rowErrors.push({ identifier: String(row.rowIndex), error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { updated, skipped, rowErrors };
}

export interface PaymentResult {
  upserted: number;
  skipped: number;
  rowErrors: RowError[];
}

// Comes from a third, separate Drive file — a weekly Shopee settlement
// report, view-only access. The Apps Script already sums "Giá trị còn lại"
// per order across every weekly tab before sending, so each row here is one
// order's total. Upsert-only (create or update), never soft-deleted — an
// order missing from one sync cycle's payload should not erase its
// previously-synced payment.
export async function applyPaymentPayload(rows: IncomingRow[]): Promise<PaymentResult> {
  let upserted = 0;
  let skipped = 0;
  const rowErrors: RowError[] = [];

  for (const row of rows) {
    const shopeeOrderId = String(getByHeader(row.data, "Mã đơn hàng") ?? "");
    const amount = getInt(row.data, "Giá trị còn lại");
    if (!shopeeOrderId || amount === null) {
      skipped += 1;
      continue;
    }

    try {
      const before = await prisma.paymentRecord.findUnique({ where: { shopeeOrderId } });
      const after = await prisma.paymentRecord.upsert({
        where: { shopeeOrderId },
        create: { shopeeOrderId, amount, rawRowHash: row.hash },
        update: { amount, rawRowHash: row.hash },
      });
      await prisma.syncLog.create({
        data: {
          sourceTab: "payment",
          sheetRowIndex: row.rowIndex,
          changeType: before ? "update" : "insert",
          oldValue: before ? toJsonSafe(before) : undefined,
          newValue: toJsonSafe(after),
        },
      });
      upserted += 1;
    } catch (error) {
      rowErrors.push({ identifier: shopeeOrderId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { upserted, skipped, rowErrors };
}

export interface PaymentBatchResult {
  lineCount: number;
  rowErrors: RowError[];
}

// One payload per weekly tab in the payment settlement file. Unlike
// applyPaymentPayload's cross-week aggregate, this keeps the raw per-line
// rows (Mã sản phẩm, Giá bán, Phí dịch vụ...) so the Reconciliation page can
// browse a given week's orders in detail. Full replace per batch — delete
// every existing line for this weekLabel, then recreate from the payload —
// matching the "payload is the complete current state" convention used
// elsewhere, just scoped to one batch instead of one whole tab.
export async function applyPaymentBatchPayload(weekLabel: string, rows: IncomingRow[]): Promise<PaymentBatchResult> {
  const batch = await prisma.paymentBatch.upsert({
    where: { weekLabel },
    create: { weekLabel },
    update: { syncedAt: new Date() },
  });

  const rowErrors: RowError[] = [];
  const lines: Prisma.PaymentBatchLineCreateManyInput[] = [];

  for (const row of rows) {
    const shopeeOrderId = String(getByHeader(row.data, "Mã đơn hàng") ?? "");
    const netAmount = getInt(row.data, "Giá trị còn lại");
    if (!shopeeOrderId || netAmount === null) {
      rowErrors.push({ identifier: String(row.rowIndex), error: "missing order id or amount" });
      continue;
    }

    lines.push({
      batchId: batch.id,
      shopeeOrderId,
      sku: getString(row.data, "Mã sản phẩm"),
      productName: getString(row.data, "Tên hàng hóa"),
      quantity: getInt(row.data, "Số lượng"),
      sellPrice: getInt(row.data, "Giá bán"),
      serviceFee: getInt(row.data, "Phí dịch vụ"),
      taxDeduction: getInt(row.data, "Khấu trừ thuế"),
      netAmount,
      sheetRowIndex: row.rowIndex,
      rawRowHash: row.hash,
    });
  }

  await prisma.$transaction([
    prisma.paymentBatchLine.deleteMany({ where: { batchId: batch.id } }),
    prisma.paymentBatchLine.createMany({ data: lines }),
  ]);

  return { lineCount: lines.length, rowErrors };
}

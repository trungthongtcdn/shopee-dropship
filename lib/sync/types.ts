export type SyncTab =
  | "orders"
  | "delivered_orders"
  | "cancelled"
  | "delivery_failed"
  | "returned_refunded"
  | "products"
  | "sku_pricing"
  | "payment"
  | "payment_batch"
  | "cancel_receipt";

export interface IncomingRow {
  rowIndex: number;
  hash: string;
  data: Record<string, string | number>;
}

export interface ExistingRow {
  key: string;
  hash: string;
}

export interface SyncDiff {
  inserts: IncomingRow[];
  updates: IncomingRow[];
  softDeletes: string[];
}

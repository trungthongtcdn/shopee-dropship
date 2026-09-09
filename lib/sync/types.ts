export type SyncTab = "orders" | "cancellations" | "products";

export interface IncomingRow {
  rowIndex: number;
  hash: string;
  data: Record<string, string | number>;
}

export interface ExistingRow {
  rowIndex: number;
  hash: string;
}

export interface SyncDiff {
  inserts: IncomingRow[];
  updates: IncomingRow[];
  softDeletes: number[];
}

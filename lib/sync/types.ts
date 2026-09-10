export type SyncTab = "orders" | "cancellations" | "products";

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

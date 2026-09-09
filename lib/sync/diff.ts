import type { ExistingRow, IncomingRow, SyncDiff } from "@/lib/sync/types";

export function computeSyncDiff(existing: ExistingRow[], incoming: IncomingRow[]): SyncDiff {
  const existingByRowIndex = new Map(existing.map((row) => [row.rowIndex, row.hash]));
  const incomingRowIndexes = new Set(incoming.map((row) => row.rowIndex));

  const inserts: IncomingRow[] = [];
  const updates: IncomingRow[] = [];

  for (const row of incoming) {
    const existingHash = existingByRowIndex.get(row.rowIndex);
    if (existingHash === undefined) {
      inserts.push(row);
    } else if (existingHash !== row.hash) {
      updates.push(row);
    }
  }

  const softDeletes = existing
    .filter((row) => !incomingRowIndexes.has(row.rowIndex))
    .map((row) => row.rowIndex);

  return { inserts, updates, softDeletes };
}

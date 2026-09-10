import type { ExistingRow, IncomingRow, SyncDiff } from "@/lib/sync/types";

export function computeSyncDiff(
  existing: ExistingRow[],
  incoming: IncomingRow[],
  keyOf: (row: IncomingRow) => string
): SyncDiff {
  const existingByKey = new Map(existing.map((row) => [row.key, row.hash]));
  const incomingKeys = new Set(incoming.map((row) => keyOf(row)));

  const inserts: IncomingRow[] = [];
  const updates: IncomingRow[] = [];

  for (const row of incoming) {
    const key = keyOf(row);
    const existingHash = existingByKey.get(key);
    if (existingHash === undefined) {
      inserts.push(row);
    } else if (existingHash !== row.hash) {
      updates.push(row);
    }
  }

  const softDeletes = existing
    .filter((row) => !incomingKeys.has(row.key))
    .map((row) => row.key);

  return { inserts, updates, softDeletes };
}

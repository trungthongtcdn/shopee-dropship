import { MatchStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";

export const dynamic = "force-dynamic";

// Derived from the Prisma enum so the UI cannot drift out of sync with the
// database's match_status values.
const VALID_MATCH_STATUSES = Object.values(MatchStatus);

function isValidMatchStatus(value: string | undefined): value is MatchStatus {
  return VALID_MATCH_STATUSES.includes(value as MatchStatus);
}

function formatAmount(value: number | null) {
  return value === null ? "-" : value.toLocaleString("vi-VN");
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: { status?: string; batchId?: string };
}) {
  const batches = await prisma.reconciliationBatch.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 20,
  });

  const requestedBatchId = Number(searchParams.batchId);
  const selectedBatch =
    (Number.isInteger(requestedBatchId) ? batches.find((batch) => batch.id === requestedBatchId) : undefined) ??
    batches[0];

  const statusFilter = isValidMatchStatus(searchParams.status) ? searchParams.status : undefined;

  // Fetch the whole batch once: the table needs the filtered subset, while the
  // summary counts and the discrepancy total must describe the entire batch
  // regardless of the active filter. The total is a sum of absolute
  // differences, which Prisma cannot aggregate without raw SQL anyway.
  const batchResults = selectedBatch
    ? await prisma.reconciliationResult.findMany({
        where: { batchId: selectedBatch.id },
        orderBy: { id: "asc" },
      })
    : [];

  const countsByStatus = VALID_MATCH_STATUSES.map((status) => ({
    status,
    count: batchResults.filter((result) => result.matchStatus === status).length,
  })).filter((entry) => entry.count > 0);

  // Rows with a missing side (missing_in_sheet / missing_in_excel / parse_error)
  // have no comparable pair, so they are skipped rather than treated as zero.
  const discrepancyTotal = batchResults.reduce((total, result) => {
    if (result.sheetAmount === null || result.excelAmount === null) return total;
    return total + Math.abs(result.sheetAmount - result.excelAmount);
  }, 0);

  const results = statusFilter
    ? batchResults.filter((result) => result.matchStatus === statusFilter)
    : batchResults;

  return (
    <main>
      <h1>Reconciliation</h1>
      <UploadForm />

      <h2>Batches</h2>
      {batches.length === 0 ? (
        <p>No batches uploaded yet.</p>
      ) : (
        <ul>
          {batches.map((batch) => (
            <li key={batch.id}>
              <a href={`?batchId=${batch.id}`}>
                {batch.fileName} — {batch.uploadedAt.toISOString()} ({batch.status})
              </a>
              {batch.id === selectedBatch?.id ? " ← viewing" : null}
            </li>
          ))}
        </ul>
      )}

      {selectedBatch ? (
        <>
          <h2>
            Batch {selectedBatch.id}: {selectedBatch.fileName}
          </h2>

          <p>
            <strong>Filter:</strong>{" "}
            <a href={`?batchId=${selectedBatch.id}`}>{statusFilter ? "all" : "all (active)"}</a>
            {VALID_MATCH_STATUSES.map((status) => (
              <span key={status}>
                {" | "}
                <a href={`?batchId=${selectedBatch.id}&status=${status}`}>
                  {status}
                  {statusFilter === status ? " (active)" : ""}
                </a>
              </span>
            ))}
          </p>

          <p>
            <strong>Summary:</strong> {batchResults.length} results
            {countsByStatus.length > 0
              ? ` — ${countsByStatus.map((entry) => `${entry.status}: ${entry.count}`).join(", ")}`
              : ""}
            {" — "}
            <strong>total discrepancy:</strong> {discrepancyTotal.toLocaleString("vi-VN")}
          </p>

          <table>
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Status</th>
                <th>Sheet amount</th>
                <th>Excel amount</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result) => (
                <tr key={result.id}>
                  <td>{result.shopeeOrderId ?? "-"}</td>
                  <td>{result.matchStatus}</td>
                  <td>{formatAmount(result.sheetAmount)}</td>
                  <td>{formatAmount(result.excelAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 ? <p>No results for this filter.</p> : null}
        </>
      ) : null}
    </main>
  );
}

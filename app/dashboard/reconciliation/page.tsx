import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";

const VALID_MATCH_STATUSES = [
  "matched",
  "missing_in_sheet",
  "missing_in_excel",
  "amount_mismatch",
  "status_mismatch",
  "parse_error",
] as const;

function isValidMatchStatus(value: string | undefined): value is (typeof VALID_MATCH_STATUSES)[number] {
  return VALID_MATCH_STATUSES.includes(value as never);
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const batches = await prisma.reconciliationBatch.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 20,
  });

  const latestBatch = batches[0];
  const statusFilter = isValidMatchStatus(searchParams.status) ? searchParams.status : undefined;

  const results = latestBatch
    ? await prisma.reconciliationResult.findMany({
        where: {
          batchId: latestBatch.id,
          ...(statusFilter ? { matchStatus: statusFilter } : {}),
        },
      })
    : [];

  return (
    <main>
      <h1>Reconciliation</h1>
      <UploadForm />
      <h2>Latest batch: {latestBatch?.fileName ?? "none"}</h2>
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
              <td>{result.shopeeOrderId}</td>
              <td>{result.matchStatus}</td>
              <td>{result.sheetAmount ?? "-"}</td>
              <td>{result.excelAmount ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

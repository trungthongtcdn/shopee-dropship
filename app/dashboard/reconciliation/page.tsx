import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";

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
  const results = latestBatch
    ? await prisma.reconciliationResult.findMany({
        where: {
          batchId: latestBatch.id,
          ...(searchParams.status ? { matchStatus: searchParams.status as never } : {}),
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

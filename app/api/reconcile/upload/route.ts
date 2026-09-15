import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseReconciliationExcel } from "@/lib/reconcile/parseExcel";
import { matchReconciliation } from "@/lib/reconcile/matcher";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // A corrupt or non-Excel upload makes the parser throw. That is a client
  // error, not a server error, and it must be rejected before any batch row
  // exists so a failed upload leaves no half-created batch behind.
  let parsed;
  try {
    parsed = parseReconciliationExcel(buffer);
  } catch {
    return NextResponse.json({ error: "could not parse file" }, { status: 400 });
  }

  if (parsed.missingColumns.length > 0) {
    return NextResponse.json(
      { error: "missing required columns", missingColumns: parsed.missingColumns },
      { status: 400 }
    );
  }

  const batch = await prisma.reconciliationBatch.create({
    data: { fileName: file.name, status: "processing" },
  });

  const orders = await prisma.order.findMany({
    // isActive is required by the matcher: only active orders can be reported
    // as missing_in_excel.
    select: { shopeeOrderId: true, status: true, isActive: true },
  });

  const results = matchReconciliation(parsed.rows, orders);

  await prisma.reconciliationResult.createMany({
    data: results.map((result) => ({
      batchId: batch.id,
      shopeeOrderId: result.shopeeOrderId,
      matchStatus: result.matchStatus,
      sheetAmount: result.sheetAmount,
      excelAmount: result.excelAmount,
      diffDetail: (result.diffDetail ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });

  if (parsed.rowErrors.length > 0) {
    await prisma.reconciliationResult.createMany({
      data: parsed.rowErrors.map((rowError) => ({
        batchId: batch.id,
        shopeeOrderId: null,
        matchStatus: "parse_error",
        diffDetail: { rowNumber: rowError.rowNumber, issue: rowError.issue } as Prisma.InputJsonValue,
      })),
    });
  }

  await prisma.reconciliationBatch.update({ where: { id: batch.id }, data: { status: "done" } });

  return NextResponse.json({ batchId: batch.id, resultCount: results.length });
}

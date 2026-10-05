import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";
import { CANCEL_RECEIPT_CONFIRM_PURPOSE } from "@/lib/zalo/cancelReceiptPoller";
import { OVERDUE_WARNING_PURPOSE } from "@/lib/zalo/overdueWarningPoller";

const watchSchema = z.object({
  purpose: z.enum([WAYBILL_CONFIRM_PURPOSE, CANCEL_RECEIPT_CONFIRM_PURPOSE, OVERDUE_WARNING_PURPOSE]),
  threadId: z.string().min(1),
  threadType: z.enum(["user", "group"]),
  threadName: z.string().min(1),
});

export async function GET(request: NextRequest) {
  const purpose = request.nextUrl.searchParams.get("purpose") ?? WAYBILL_CONFIRM_PURPOSE;
  const config = await prisma.zaloWatchConfig.findUnique({ where: { purpose } });
  return NextResponse.json({ config });
}

// Selecting a (new) thread always resets the poll cursor and any pending
// unconfirmed PDF link — switching what's being watched shouldn't carry
// state over from a previous thread. Each purpose (waybill_confirm /
// cancel_receipt_confirm) is its own independent row, picked separately.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = watchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { purpose, ...data } = parsed.data;
  const config = await prisma.zaloWatchConfig.upsert({
    where: { purpose },
    create: { purpose, ...data },
    update: { ...data, lastProcessedMsgId: null, pendingPdfUrl: null, pendingPdfMsgId: null },
  });

  return NextResponse.json({ config });
}

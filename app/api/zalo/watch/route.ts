import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const watchSchema = z.object({
  threadId: z.string().min(1),
  threadType: z.enum(["user", "group"]),
  threadName: z.string().min(1),
});

export async function GET() {
  const config = await prisma.zaloWatchConfig.findUnique({ where: { id: 1 } });
  return NextResponse.json({ config });
}

// Selecting a (new) thread always resets the poll cursor and any pending
// unconfirmed PDF link — switching what's being watched shouldn't carry
// state over from a previous thread.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = watchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const config = await prisma.zaloWatchConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...parsed.data },
    update: { ...parsed.data, lastProcessedMsgId: null, pendingPdfUrl: null, pendingPdfMsgId: null },
  });

  return NextResponse.json({ config });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

// Only the operational fields Luân edits by hand — every other Order column
// is owned by the sync webhook and must never be reachable through this route.
const updateOrderSchema = z.object({
  sentAt: z.string().datetime().nullable().optional(),
  sendStatus: z.enum(["sent", "cancelled"]).nullable().optional(),
  paidAt: z.string().datetime().nullable().optional(),
  cancelReceivedAt: z.string().datetime().nullable().optional(),
  defectRate: z.number().min(0).max(1).nullable().optional(),
  cancelReceiptStatus: z.enum(["received_full", "not_received", "received_partial"]).nullable().optional(),
  cancelComplaintNote: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  luanCheck: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid order id" }, { status: 400 });
  }

  const body = await request.json();
  const parsed = updateOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { sentAt, paidAt, cancelReceivedAt, ...rest } = parsed.data;

  try {
    const updated = await prisma.order.update({
      where: { id },
      data: {
        ...rest,
        ...(sentAt !== undefined ? { sentAt: sentAt ? new Date(sentAt) : null } : {}),
        ...(paidAt !== undefined ? { paidAt: paidAt ? new Date(paidAt) : null } : {}),
        ...(cancelReceivedAt !== undefined ? { cancelReceivedAt: cancelReceivedAt ? new Date(cancelReceivedAt) : null } : {}),
      },
    });
    return NextResponse.json({ order: updated });
  } catch {
    return NextResponse.json({ error: "order not found" }, { status: 404 });
  }
}

import { prisma } from "@/lib/db";
import { CancelReceiptStatus, type CancellationType } from "@prisma/client";
import { z } from "zod";

const MAX_NOTE_LENGTH = 2000;

// A note as typed: trimmed, and "" is "nothing" (null), which is how a typed note is taken back.
const noteField = z
  .string()
  .max(MAX_NOTE_LENGTH)
  .transform((text) => text.trim() || null)
  .nullable();

const editSchema = z
  .object({
    receiptStatus: z.nativeEnum(CancelReceiptStatus).nullable(),
    supplierNote: noteField,
    complaintNote: noteField,
  })
  .partial()
  .refine((edit) => Object.keys(edit).length > 0, { message: "nothing to change" });

export type CancellationEdit = z.infer<typeof editSchema>;

// The body of the edit request. Throws a ZodError for anything but the three fields below.
export function parseCancellationEdit(raw: unknown): CancellationEdit {
  return editSchema.parse(raw);
}

// "Thời gian hoàn trả hàng / ngày huỷ thành công": a return/refund row (sheet 5) shows when the
// return came back, the other rows (sheet 5.2 for Furni, 5.1 for Top) when Shopee cancelled.
export function timeColumnOf(row: { type: CancellationType; returnCompletedAt: Date | null; cancelledAt: Date | null }): Date | null {
  return row.type === "returned_refunded" ? row.returnCompletedAt : row.cancelledAt;
}

// "NCC ghi chú": what the team typed on the page, else what the sheet says.
export function supplierNoteOf(row: { supplierNote: string | null; supplierNoteEdit: string | null }): string {
  return row.supplierNoteEdit ?? row.supplierNote ?? "";
}

const RECEIVED: CancelReceiptStatus[] = ["received_full", "received_partial"];

// Applies an edit made on the Đơn hoàn huỷ page to the row `id`. The receipt status and the
// complaint note belong to the order, which has one Order row per product line, so they go to
// every line of it (the page reads the status back the same way, see receiptStatus.ts). False
// when there is no such row, or it was retired by a sync.
export async function editCancellation(id: number, edit: CancellationEdit): Promise<boolean> {
  const row = await prisma.cancellation.findFirst({ where: { id, isActive: true }, select: { shopeeOrderId: true } });
  if (!row) return false;

  const lines = { shopeeOrderId: row.shopeeOrderId, isActive: true };
  await prisma.$transaction(async (tx) => {
    if (edit.receiptStatus !== undefined) {
      await tx.order.updateMany({
        where: lines,
        data: {
          cancelReceiptStatus: edit.receiptStatus,
          cancelReceivedAt: edit.receiptStatus && RECEIVED.includes(edit.receiptStatus) ? new Date() : null,
        },
      });
    }
    if (edit.complaintNote !== undefined) {
      await tx.order.updateMany({ where: lines, data: { cancelComplaintNote: edit.complaintNote } });
    }
    if (edit.supplierNote !== undefined) {
      await tx.cancellation.update({ where: { id }, data: { supplierNoteEdit: edit.supplierNote } });
    }
  });
  return true;
}

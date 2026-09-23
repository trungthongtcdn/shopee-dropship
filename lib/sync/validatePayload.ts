import { z } from "zod";

export const incomingRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  hash: z.string().min(1),
  data: z.record(z.union([z.string(), z.number()])),
});

export const syncPayloadSchema = z.object({
  tab: z.enum([
    "orders",
    "delivered_orders",
    "cancelled",
    "delivery_failed",
    "returned_refunded",
    "products",
    "sku_pricing",
    "payment",
    "payment_batch",
    "cancel_receipt",
  ]),
  // Only present (and required) when tab is "payment_batch" — the payment
  // settlement file has one tab per week, so unlike every other source this
  // one has no fixed name; the caller must say which week this payload is.
  batchLabel: z.string().min(1).optional(),
  rows: z.array(z.unknown()),
});

export function parseIncomingRows(rawRows: unknown[]) {
  const validRows: z.infer<typeof incomingRowSchema>[] = [];
  const errors: { index: number; issue: string }[] = [];

  rawRows.forEach((raw, index) => {
    const result = incomingRowSchema.safeParse(raw);
    if (result.success) {
      validRows.push(result.data);
    } else {
      errors.push({ index, issue: result.error.issues[0]?.message ?? "invalid row" });
    }
  });

  return { validRows, errors };
}

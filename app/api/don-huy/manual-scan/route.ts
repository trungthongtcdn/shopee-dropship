import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CancelReceiptStatus } from "@prisma/client";
import { applyCancelReceiptCodes } from "@/lib/zalo/cancelReceiptPoller";
import { extractOrderCodes } from "@/lib/zalo/cancelReceiptDetect";

// Fallback/primary entry point for staff physically scanning returned
// packages with a phone camera (see BarcodeScanForm.tsx) — same effect as
// a Zalo group message naming the code, just logged under a distinct
// thread id so it's distinguishable in zalo_cancel_receipt_logs.
const MANUAL_SCAN_THREAD_ID = "manual-scan";

const scanSchema = z.object({
  codes: z.array(z.string().min(1)).min(1),
  confirmedAt: z.string().datetime(),
  cancelReceiptStatus: z.nativeEnum(CancelReceiptStatus),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = scanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  // Re-run every scanned value through the same extraction/validation used
  // for free-text Zalo messages — never trust the client, and this also
  // normalizes casing and drops accidental duplicates in one pass.
  const codes = [...new Set(parsed.data.codes.flatMap((code) => extractOrderCodes(code)))];
  if (codes.length === 0) {
    return NextResponse.json({ error: "không có mã hợp lệ nào trong danh sách" }, { status: 422 });
  }

  const confirmedAt = new Date(parsed.data.confirmedAt);

  const { matchedCount } = await applyCancelReceiptCodes({
    codes,
    messageContent: codes.join(", "),
    confirmedByName: "Quét mã thủ công",
    confirmedAt,
    threadId: MANUAL_SCAN_THREAD_ID,
    cancelReceiptStatus: parsed.data.cancelReceiptStatus,
  });

  return NextResponse.json({ codes, matchedCount });
}

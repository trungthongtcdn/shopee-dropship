import { prisma } from "@/lib/db";
import { sendGroupMessage } from "./bridge";
import { loadOverdueWarnings } from "@/lib/cancellation/overdueWarnings";

export const OVERDUE_WARNING_PURPOSE = "overdue_warning";

const TYPE_LABELS = {
  returned_refunded: "THHT",
  delivery_failed: "Giao thất bại",
} as const;

export interface OverdueWarningPollCycleResult {
  newlyWarned: number;
}

// One combined Zalo message per cycle for every row that just crossed the
// threshold and hasn't been warned about yet (see loadOverdueWarnings) —
// per Luân's call: warn once per row, not once per day. Rows are marked
// overdueWarnedAt only after a successful send, and only skipped from the
// query (not sent, not marked) when no group is configured yet, so nothing
// is silently lost before the group gets set up.
export async function runOverdueWarningPollCycle(): Promise<OverdueWarningPollCycleResult | null> {
  const config = await prisma.zaloWatchConfig.findUnique({ where: { purpose: OVERDUE_WARNING_PURPOSE } });
  if (!config) return null;

  const warnings = await loadOverdueWarnings();
  const toWarn = warnings.filter((w) => !w.alreadyWarned);
  if (toWarn.length === 0) return { newlyWarned: 0 };

  const lines = toWarn.map((w) => `- ${w.shopeeOrderId} (${TYPE_LABELS[w.type]}, ${w.daysOverdue} ngày)`);
  const message = `⚠️ ${toWarn.length} đơn vượt ngưỡng cảnh báo (chưa cập nhật trạng thái nhận huỷ/khiếu nại):\n${lines.join("\n")}`;

  await sendGroupMessage(config.threadId, message);

  await prisma.cancellation.updateMany({
    where: { id: { in: toWarn.map((w) => w.cancellationId) } },
    data: { overdueWarnedAt: new Date() },
  });

  return { newlyWarned: toWarn.length };
}

import { prisma } from "@/lib/db";
import { MANUAL_SCAN_THREAD_ID, orderMatchWhere } from "@/lib/zalo/cancelReceiptPoller";

// A "đã nhận đơn huỷ" message (Zalo group or manual scan) is applied to the
// orders that exist when it arrives. When the order sheet had not synced yet it
// matched nothing: the log row says matchedCount 0 and the date it named never
// reached an order. Replaying those logs applies them to what exists now.
//
// Only orders with no receipt date AND no receipt status are touched, so nothing
// a person (or the ĐƠN HUỶ sheet) has set since is overwritten. Logs are taken
// newest first, which makes an order reported twice end on its latest date, the
// same as the live flow where each message overwrites the last.

export interface ReplayParams {
  // Exclusive upper bound on a log's confirmedAt — see lastInstantOfDayVN.
  until: Date;
  // false = dry run: report what would change, write nothing.
  apply: boolean;
}

export interface ReplayResult {
  logsChecked: number;
  // Distinct shopeeOrderIds that got (or, on a dry run, would get) a receipt.
  mappedOrders: string[];
  // The subset of mappedOrders that came from a manual barcode scan. The scan form
  // lets staff pick a status and a % hỏng but the log keeps neither, so these are
  // mapped as received_full with no defect rate and are worth a second look.
  fromManualScan: string[];
  // Codes of messages that still match no order at all.
  stillUnmatched: string[];
}

// "2026-10-27" -> the first instant of the next day in Vietnam (UTC+7), to be used
// as an exclusive bound so that all of 27/10 is in and 28/10 00:00 is out.
export function lastInstantOfDayVN(dateText: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) throw new Error(`Not a date (expected YYYY-MM-DD): ${dateText}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Not a real date: ${dateText}`);
  }
  const VN_OFFSET_HOURS = 7;
  return new Date(Date.UTC(year, month - 1, day + 1) - VN_OFFSET_HOURS * 60 * 60 * 1000);
}

export async function replayCancelReceipts(params: ReplayParams): Promise<ReplayResult> {
  const logs = await prisma.zaloCancelReceiptLog.findMany({
    where: { confirmedAt: { lt: params.until } },
    orderBy: [{ confirmedAt: "desc" }, { id: "desc" }],
  });

  const claimed = new Set<string>();
  const fromManualScan = new Set<string>();
  const stillUnmatched: string[] = [];

  for (const log of logs) {
    const codes = Array.isArray(log.codes) ? log.codes.filter((code): code is string => typeof code === "string") : [];
    if (codes.length === 0) continue;

    const matches = await orderMatchWhere(codes);
    const total = await prisma.order.count({ where: matches });
    if (total === 0) {
      stillUnmatched.push(...codes);
      continue;
    }

    const pending = {
      AND: [matches, { cancelReceivedAt: null, cancelReceiptStatus: null, shopeeOrderId: { notIn: [...claimed] } }],
    };
    const orders = await prisma.order.findMany({ where: pending, select: { shopeeOrderId: true }, distinct: ["shopeeOrderId"] });
    for (const { shopeeOrderId } of orders) {
      claimed.add(shopeeOrderId);
      if (log.threadId === MANUAL_SCAN_THREAD_ID) fromManualScan.add(shopeeOrderId);
    }

    if (!params.apply) continue;
    if (orders.length > 0) {
      await prisma.order.updateMany({ where: pending, data: { cancelReceiptStatus: "received_full", cancelReceivedAt: log.confirmedAt } });
    }
    if (total !== log.matchedCount) {
      await prisma.zaloCancelReceiptLog.update({ where: { id: log.id }, data: { matchedCount: total } });
    }
  }

  return {
    logsChecked: logs.length,
    mappedOrders: [...claimed],
    fromManualScan: [...fromManualScan],
    stillUnmatched: [...new Set(stillUnmatched)],
  };
}

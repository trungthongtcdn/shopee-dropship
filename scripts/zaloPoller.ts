// Standalone process (run via `tsx`, not through Next.js) — see the
// docker-compose.prod.yml `zalo-poller` service. Kept out of the Next.js
// app process on purpose: an in-process instrumentation.ts hook was tried
// first, but Next.js also compiles instrumentation.ts for the Edge runtime
// (because middleware.ts runs on Edge), and this poller's Node-only
// dependencies (child_process/fs, for pdftotext) fail that build.
import { runPollCycle } from "../lib/zalo/poller";
import { runCancelReceiptPollCycle } from "../lib/zalo/cancelReceiptPoller";
import { runOverdueWarningPollCycle } from "../lib/zalo/overdueWarningPoller";
import { runShopCycles } from "../lib/zalo/shopCycles";
import { listShops } from "../lib/shops/registry";

const POLL_INTERVAL_MS = 20_000;
// The overdue check is about day-scale thresholds, not seconds — running it
// on the same 20s cadence as message polling would just hammer the DB for
// no benefit. Throttled to once an hour per shop in the same long-running
// process instead of standing up a separate cron job.
const OVERDUE_CHECK_INTERVAL_MS = 60 * 60_000;
const lastOverdueCheckAt = new Map<string, number>();

function overdueDue(slug: string): boolean {
  const now = Date.now();
  if (now - (lastOverdueCheckAt.get(slug) ?? 0) < OVERDUE_CHECK_INTERVAL_MS) return false;
  lastOverdueCheckAt.set(slug, now);
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("[zalo-poller] started");
  for (;;) {
    try {
      // Read again every pass, so a shop added while the poller runs is picked up
      // without restarting it.
      const shops = await listShops();
      await runShopCycles(
        shops,
        { waybill: runPollCycle, cancelReceipt: runCancelReceiptPollCycle, overdue: runOverdueWarningPollCycle },
        overdueDue
      );
    } catch (error) {
      console.error("[zalo-poller] could not run a pass:", error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main();

// Standalone process (run via `tsx`, not through Next.js) — see the
// docker-compose.prod.yml `zalo-poller` service. Kept out of the Next.js
// app process on purpose: an in-process instrumentation.ts hook was tried
// first, but Next.js also compiles instrumentation.ts for the Edge runtime
// (because middleware.ts runs on Edge), and this poller's Node-only
// dependencies (child_process/fs, for pdftotext) fail that build.
import { runPollCycle } from "../lib/zalo/poller";
import { runCancelReceiptPollCycle } from "../lib/zalo/cancelReceiptPoller";

const POLL_INTERVAL_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("[zalo-poller] started");
  for (;;) {
    try {
      const result = await runPollCycle();
      if (result && (result.processed > 0 || result.confirmed > 0)) {
        console.log(`[zalo-poller] waybill: processed ${result.processed} message(s), ${result.confirmed} confirmation(s)`);
      }
    } catch (error) {
      console.error("[zalo-poller] waybill cycle failed:", error);
    }

    try {
      const result = await runCancelReceiptPollCycle();
      if (result && (result.processed > 0 || result.matched > 0)) {
        console.log(`[zalo-poller] cancel-receipt: processed ${result.processed} message(s), ${result.matched} order(s) matched`);
      }
    } catch (error) {
      console.error("[zalo-poller] cancel-receipt cycle failed:", error);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main();

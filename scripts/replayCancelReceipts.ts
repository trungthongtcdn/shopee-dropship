// Re-applies "đã nhận đơn huỷ" confirmations (Zalo group messages and manual scans)
// that matched no order when they were made, because the order sheet had not synced
// yet. Run it against the shop whose orders have synced since.
//
//   npx tsx scripts/replayCancelReceipts.ts --shop shop_2 --until 2026-10-27          # dry run
//   npx tsx scripts/replayCancelReceipts.ts --shop shop_2 --until 2026-10-27 --apply  # writes
//
// --until is the last day to include, in Vietnam time. Without --apply nothing is written.
import { replayCancelReceipts, lastInstantOfDayVN } from "../lib/zalo/replayCancelReceipts";
import { runWithShop } from "../lib/shops/context";
import { isShopSlug } from "../lib/shops/slug";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const shop = option("shop");
  const untilText = option("until");
  const apply = process.argv.includes("--apply");

  if (!shop || !isShopSlug(shop) || !untilText) {
    console.error("Usage: tsx scripts/replayCancelReceipts.ts --shop shop_2 --until YYYY-MM-DD [--apply]");
    process.exit(1);
  }

  const until = lastInstantOfDayVN(untilText);
  const result = await runWithShop(shop, () => replayCancelReceipts({ until, apply }));

  console.log(`${apply ? "APPLIED" : "DRY RUN (nothing written)"} for ${shop}, messages up to the end of ${untilText}`);
  console.log(`messages checked:          ${result.logsChecked}`);
  console.log(`orders mapped:             ${result.mappedOrders.length}`);
  if (result.mappedOrders.length > 0) console.log(`  ${result.mappedOrders.join(", ")}`);
  console.log(`  of which from manual scan (status / % hỏng were not logged, check them): ${result.fromManualScan.length}`);
  if (result.fromManualScan.length > 0) console.log(`  ${result.fromManualScan.join(", ")}`);
  console.log(`codes still matching no order: ${result.stillUnmatched.length}`);
  if (result.stillUnmatched.length > 0) console.log(`  ${result.stillUnmatched.join(", ")}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .then(() => process.exit(0));

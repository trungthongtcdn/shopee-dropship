// Adds a shop.   npx tsx scripts/addShop.ts --name "Tên shop" [--sku-sheet https://…]
// Prints the shop's Apps Script secret — once; only its hash is stored.
import { addShop } from "../lib/shops/provision";
import { sharedPrisma } from "../lib/db";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const name = option("name");
  if (!name) {
    console.error('Cần --name "Tên shop"');
    process.exitCode = 1;
    return;
  }
  const { shop, secret } = await addShop({ name, skuSheetUrl: option("sku-sheet") });
  console.log(`Đã thêm shop "${shop.name}" (${shop.slug}).`);
  console.log("");
  console.log("Dán vào Script Properties của Apps Script của shop này:");
  console.log(`  SYNC_SECRET = ${secret}`);
  console.log("  (SYNC_WEBHOOK_URL giống shop đầu)");
  console.log("");
  console.log("Mã này chỉ hiện một lần. Mất thì phải đặt lại.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sharedPrisma.$disconnect());

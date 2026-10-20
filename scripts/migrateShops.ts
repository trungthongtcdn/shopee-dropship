// Brings every shop other than the first up to the latest migration.
// Run after `prisma migrate deploy`, which covers the first shop.
import { migrateAllShops } from "../lib/shops/provision";
import { sharedPrisma } from "../lib/db";

migrateAllShops()
  .then((done) => console.log(done.length ? `Đã migrate: ${done.join(", ")}` : "Không có shop nào khác cần migrate."))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sharedPrisma.$disconnect());

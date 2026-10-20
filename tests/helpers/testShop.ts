import { forgetClient, sharedPrisma } from "@/lib/db";
import { migrateShopSchema } from "@/lib/shops/provision";

// A throwaway second shop for isolation tests: a fresh schema with every migration
// applied, plus its row in the shop list. Takes a few seconds, so tests that need
// one share it through beforeAll/afterAll.
export async function createTestShop(slug = "shop_9"): Promise<void> {
  await dropTestShop(slug);
  await migrateShopSchema(slug);
  await sharedPrisma.shop.create({ data: { slug, name: `Test ${slug}` } });
}

export async function dropTestShop(slug = "shop_9"): Promise<void> {
  await sharedPrisma.shop.deleteMany({ where: { slug } });
  await forgetClient(slug);
  await sharedPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${slug}" CASCADE`);
}

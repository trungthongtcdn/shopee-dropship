import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sharedPrisma } from "@/lib/db";
import { isShopSlug, PRIMARY_SLUG, shopDatabaseUrl } from "./slug";

const run = promisify(execFile);

// Creates the shop's schema if it is missing and brings it up to the latest
// migration. Safe to repeat: already-applied migrations are skipped. The first shop
// lives in `public`, which the normal `prisma migrate deploy` already covers.
export async function migrateShopSchema(slug: string): Promise<void> {
  if (!isShopSlug(slug)) throw new Error(`Invalid shop slug: ${slug}`);
  if (slug === PRIMARY_SLUG) return;
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DATABASE_URL is not set");

  await sharedPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${slug}"`);
  await run("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: shopDatabaseUrl(baseUrl, slug) },
    maxBuffer: 10 * 1024 * 1024,
  });
}

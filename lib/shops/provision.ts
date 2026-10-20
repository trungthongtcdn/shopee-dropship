import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sharedPrisma } from "@/lib/db";
import { generateSecret, hashSecret, listShops, normalizeShopName, type ShopInfo } from "./registry";
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

function checkSheetUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Link sheet SKU không hợp lệ");
  }
  if (url.protocol !== "https:") throw new Error("Link sheet SKU phải bắt đầu bằng https://");
  return url.toString();
}

// Adds a shop: its own schema with every migration applied, then its row in the shop list
// with a fresh Apps Script secret. The secret is returned once and only its hash is kept.
// The schema is built before the row is written, so a run that dies half-way leaves no
// shop behind and the next run picks the same slug up again.
export async function addShop(input: {
  name: string;
  skuSheetUrl?: string | null;
}): Promise<{ shop: ShopInfo; secret: string }> {
  const normalized = normalizeShopName(input.name);
  if (!normalized.ok) throw new Error(normalized.error);
  const skuSheetUrl = checkSheetUrl(input.skuSheetUrl);

  const shops = await listShops();
  if (shops.some((shop) => shop.name.toLowerCase() === normalized.name.toLowerCase())) {
    throw new Error("Đã có shop tên này");
  }
  const number = Math.max(0, ...shops.map((shop) => Number(shop.slug.slice("shop_".length)))) + 1;
  const slug = `shop_${number}`;
  if (!isShopSlug(slug)) throw new Error("Đã hết số shop (tối đa 999)");

  await migrateShopSchema(slug);

  const secret = generateSecret();
  const shop = await sharedPrisma.shop.create({
    data: { slug, name: normalized.name, secretHash: hashSecret(secret), skuSheetUrl },
    select: { id: true, slug: true, name: true, skuSheetUrl: true },
  });
  return { shop, secret };
}

// Brings every shop's schema up to the latest migration (run after each deploy that adds one).
export async function migrateAllShops(): Promise<string[]> {
  const done: string[] = [];
  for (const shop of await listShops()) {
    if (shop.slug === PRIMARY_SLUG) continue;
    await migrateShopSchema(shop.slug);
    done.push(shop.slug);
  }
  return done;
}

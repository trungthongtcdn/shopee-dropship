# Deploying on a self-hosted VPS

Alternative to Vercel: run everything (app + Postgres + HTTPS) via Docker Compose on a plain VPS.

## 1. Buy a VPS

Any provider works — cheapest tier is enough (1 vCPU / 1-2GB RAM). Pick **Ubuntu 22.04**.
Suggestions that take Vietnamese cards easily: Vultr (~$6/mo), DigitalOcean (~$6/mo), Hetzner (~€4.5/mo, needs a bit more verification).

## 2. Buy a domain and point it at the VPS

Any registrar (Porkbun, Namecheap, or a local one). After buying:
- Add a DNS **A record**: `@` (or a subdomain like `shopee`) → the VPS's public IP.
- Wait for DNS to propagate (`dig +short <domain>` should return the VPS IP).

HTTPS is not optional — Apps Script's `UrlFetchApp` needs `https://`, and Caddy (below) gets the certificate automatically, but only once the domain actually resolves to this server.

## 3. SSH into the VPS, install Docker

```bash
ssh root@<vps-ip>
curl -fsSL https://get.docker.com | sh
```

## 4. Clone the repo and configure secrets

```bash
apt-get install -y git
git clone https://github.com/trungthongtcdn/shopee-dropship.git
cd shopee-dropship
cat > .env.prod <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SYNC_WEBHOOK_SECRET=$(openssl rand -hex 24)
DASHBOARD_USER=luan
DASHBOARD_PASSWORD=$(openssl rand -hex 12)
SESSION_SECRET=$(openssl rand -hex 32)
DOMAIN=your-domain.com
EOF
cat .env.prod
```
Save the values it prints — you'll need `SYNC_WEBHOOK_SECRET` again for the Apps Script side, and `DASHBOARD_USER`/`DASHBOARD_PASSWORD` for the **first** login to the dashboard (the login page at `/login` creates the first account from that pair while no account exists yet; after that, accounts are managed at `/dashboard/accounts` and these two variables are ignored).

`SESSION_SECRET` signs the login cookies and is **required** — with it unset in production nobody can log in. Rotating it (and redeploying) logs every session out at once; that is the emergency way to revoke a deleted account's still-valid cookie for API calls (page loads re-check that the account exists, API routes other than `/api/accounts` only verify the signature).

## 5. Start everything

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

First boot: Caddy requests a Let's Encrypt certificate for `$DOMAIN` automatically (needs port 80/443 reachable and DNS already pointing here).

## 6. Run the database migration

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

## 7. Verify

```bash
curl -I https://your-domain.com
```
Should return a `200` (or a Next.js response, not a connection error / cert warning).

## 8. Point the Apps Script at it

In `google-apps-script/README.md`'s Script Properties step, set:
- `SYNC_WEBHOOK_URL` = `https://your-domain.com/api/sync/webhook`
- `SYNC_SECRET` = the `SYNC_WEBHOOK_SECRET` value from step 4

## 9. Zalo watch feature (optional)

Add to `.env.prod` (then redeploy — see below):
```
ZALO_BRIDGE_URL=http://172.18.0.1:8788
ZALO_BRIDGE_SECRET=<WEBHOOK_SECRET from the bridge's own .env>
```
Use the bridge's public HTTPS URL instead if the internal one isn't reachable from this app's container. Group setup lives on two separate pages now, each with its own group picker popup ("Đổi nhóm"):
- **`/dashboard/dong-don`** — waybill-PDF-link + "Đã in..." reply flow (see lib/zalo/poller.ts).
- **`/dashboard/don-huy`** — any message naming an order id and/or tracking code marks that order's cancel-receipt as received, dated to the message's own timestamp (see lib/zalo/cancelReceiptPoller.ts). Also has a manual barcode-scan entry (camera or typed) for physically-received returns, independent of Zalo.

## Redeploying after a code change

Back up the database first — a deploy can add migrations, and every shop's data is in it:

```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U postgres shopee_reconciliation | gzip > backup-$(date +%F-%H%M).sql.gz
```

Then:

```bash
cd shopee-dropship
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app zalo-poller
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec app npx tsx scripts/migrateShops.ts
```

`prisma migrate deploy` migrates the first shop (the original data, in Postgres' `public` schema); `scripts/migrateShops.ts` brings every other shop's schema up to date. Run both after every deploy, even when you think there is no new migration — the second is a no-op then.

## Several shops

The site serves several shops. Each has its own data (orders, cancellations, payments, SKU list, Zalo groups, waybill files), kept in a Postgres schema of its own: the first shop (`shop_1`) is the data that existed before shops, still in `public`; later shops are `shop_2`, `shop_3`… Accounts are shared — everyone who can log in can open every shop. Pick the shop in the header; the browser remembers it.

The first shop's name is "Shop 1" until someone renames it at `/dashboard/accounts` → "Tên shop" (that is the only thing about a shop editable on the web).

### Adding a shop

```bash
docker compose -f docker-compose.prod.yml exec app npx tsx scripts/addShop.ts --name "Tên shop" [--sku-sheet https://docs.google.com/spreadsheets/d/…/export?format=csv&gid=0]
```

This creates the schema (all migrations applied), adds the shop to the list and prints its **Apps Script secret once** — only a hash is stored, so a lost secret can't be read back; to replace it, set the shop's `secret_hash` in the `shops` table to the sha256 (hex) of a new secret and put that secret in the Apps Script. `--sku-sheet` is the shop's own SKU list; without it the default sheet (`SKU_SHEET_URL`) is used. The Zalo poller notices the new shop on its next pass, no restart needed.

Then, for the new shop's two Google workbooks, install the Apps Scripts as in `google-apps-script/README.md`, with:

- `SYNC_WEBHOOK_URL` — the same address as the first shop;
- `SYNC_SECRET` — the secret the command printed (not `SYNC_WEBHOOK_SECRET`).

The server tells the shops apart by that secret. The first shop keeps using `SYNC_WEBHOOK_SECRET`, so its Apps Scripts need no change.

Finally pick the new shop in the header and choose its Zalo groups on `/dashboard/dong-don`, `/dashboard/don-huy` and `/dashboard/hoan-huy` — each shop has its own, on the one shared Zalo bridge.

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
DOMAIN=your-domain.com
EOF
cat .env.prod
```
Save the values it prints — you'll need `SYNC_WEBHOOK_SECRET` again for the Apps Script side, and `DASHBOARD_USER`/`DASHBOARD_PASSWORD` to log into the dashboard itself (the browser will prompt for them on first visit).

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

## Redeploying after a code change

```bash
cd shopee-dropship
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build app
docker compose -f docker-compose.prod.yml exec app npx prisma migrate deploy
```

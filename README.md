# Shopee Dropship Reconciliation

## Local development

1. `npm install`
2. `cp .env.example .env`, fill in `DATABASE_URL` and `SYNC_WEBHOOK_SECRET`
3. `docker compose up -d postgres`
4. `npx prisma migrate dev`
5. `npm run dev`

## Several shops

One site serves several shops, each with its own data (see `docs/superpowers/specs/2026-10-20-multi-shop-design.md`): shop `shop_1` is the data in Postgres' `public` schema, every later shop has a schema of its own. Pick the shop in the header. `prisma` from `lib/db.ts` always means "the current shop's database" (the shop comes from the `shop` cookie, or from `runWithShop` in scripts and the webhook); accounts and the list of shops are shared and go through `sharedPrisma`. API routes that write go through `withShop` (`lib/shops/guard.ts`) so a stale browser tab can't write into another shop. Add a shop with `npm run shop:add -- --name "Tên shop"`; after adding a migration run `npm run shops:migrate` too. Details in [DEPLOY_VPS.md](DEPLOY_VPS.md).

## Deploying

### Option A: Vercel

1. Push this repo to a Git remote, connect it to a Vercel project.
2. In Vercel project settings, set env vars: `DATABASE_URL` (from Neon or Supabase), `SYNC_WEBHOOK_SECRET`, `SESSION_SECRET` (signs the login cookie), `DASHBOARD_USER`, `DASHBOARD_PASSWORD` (first-login bootstrap only — the login page creates the first account from them; afterwards accounts are managed at `/dashboard/accounts`).
3. Run `npx prisma migrate deploy` against the production `DATABASE_URL` before or right after the first deploy.
4. Deploy the Apps Script per `google-apps-script/README.md`, pointing `SYNC_WEBHOOK_URL` at `https://<your-vercel-domain>/api/sync/webhook` and `SYNC_SECRET` matching `SYNC_WEBHOOK_SECRET`.

Note: the Zalo watch feature (`/dashboard/dong-don`, `/dashboard/don-huy`) does not work on Vercel — it needs a long-running process for its background poller (`instrumentation.ts`) and the `pdftotext` system binary, neither of which Vercel's serverless functions support. VPS only.

### Option B: self-hosted VPS (Docker Compose + Caddy)

See [DEPLOY_VPS.md](DEPLOY_VPS.md) — app + Postgres + automatic HTTPS, no Vercel/Neon needed.

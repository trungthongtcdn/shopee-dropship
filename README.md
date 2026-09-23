# Shopee Dropship Reconciliation

## Local development

1. `npm install`
2. `cp .env.example .env`, fill in `DATABASE_URL` and `SYNC_WEBHOOK_SECRET`
3. `docker compose up -d postgres`
4. `npx prisma migrate dev`
5. `npm run dev`

## Deploying

### Option A: Vercel

1. Push this repo to a Git remote, connect it to a Vercel project.
2. In Vercel project settings, set env vars: `DATABASE_URL` (from Neon or Supabase), `SYNC_WEBHOOK_SECRET`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD` (gates the dashboard with HTTP Basic Auth — the browser prompts for them).
3. Run `npx prisma migrate deploy` against the production `DATABASE_URL` before or right after the first deploy.
4. Deploy the Apps Script per `google-apps-script/README.md`, pointing `SYNC_WEBHOOK_URL` at `https://<your-vercel-domain>/api/sync/webhook` and `SYNC_SECRET` matching `SYNC_WEBHOOK_SECRET`.

Note: the Zalo watch feature (`/dashboard/zalo`) does not work on Vercel — it needs a long-running process for its background poller (`instrumentation.ts`) and the `pdftotext` system binary, neither of which Vercel's serverless functions support. VPS only.

### Option B: self-hosted VPS (Docker Compose + Caddy)

See [DEPLOY_VPS.md](DEPLOY_VPS.md) — app + Postgres + automatic HTTPS, no Vercel/Neon needed.

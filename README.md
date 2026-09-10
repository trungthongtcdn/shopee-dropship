# Shopee Dropship Reconciliation

## Local development

1. `npm install`
2. `cp .env.example .env`, fill in `DATABASE_URL` and `SYNC_WEBHOOK_SECRET`
3. `docker compose up -d postgres`
4. `npx prisma migrate dev`
5. `npm run dev`

## Deploying

1. Push this repo to a Git remote, connect it to a Vercel project.
2. In Vercel project settings, set env vars: `DATABASE_URL` (from Neon or Supabase), `SYNC_WEBHOOK_SECRET`.
3. Run `npx prisma migrate deploy` against the production `DATABASE_URL` before or right after the first deploy.
4. Deploy the Apps Script per `google-apps-script/README.md`, pointing `SYNC_WEBHOOK_URL` at `https://<your-vercel-domain>/api/sync/webhook` and `SYNC_SECRET` matching `SYNC_WEBHOOK_SECRET`.

# Apps Script deployment

1. Open the Shopee-owned Google Sheet, then Extensions > Apps Script.
2. Paste the contents of `Sync.gs` into the script editor.
3. Project Settings > Script Properties, add:
   - `SYNC_WEBHOOK_URL` = `https://<your-vercel-domain>/api/sync/webhook`
   - `SYNC_SECRET` = same value as `SYNC_WEBHOOK_SECRET` in the app's `.env`
4. Run `manualTestSync` once from the editor toolbar, grant permissions when prompted, check the execution log (View > Logs).
5. Run `syncAllTabs` once manually, confirm rows appear in the app's database.
6. Run `createTimeTrigger` once to install the 10-minute polling trigger.

## Payload size and scale limits

Each sync cycle sends **one request per tab containing that tab's complete
current state**. This is load-bearing, not an optimisation: the webhook treats
"a row that is active in the database but absent from the payload" as deleted,
so a partial payload would soft-delete everything it omitted. The payload must
never be split into chunks.

That puts a ceiling on how large a tab can get:

- `UrlFetchApp` allows a 50MB POST payload.
- A time-driven trigger has a 6-minute execution ceiling.

In practice this comfortably covers sheets up to several thousand rows per tab.
If a tab ever needs to exceed that, the sync design has to be revisited — a
chunked upload needs a different backend protocol (for example, a sync session
that the backend only finalises, and only computes deletions from, once every
chunk of a tab has arrived). Chunking must not simply be reinstated on top of
the current protocol.

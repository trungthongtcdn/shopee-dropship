# Apps Script deployment

1. Open the Shopee-owned Google Sheet, then Extensions > Apps Script.
2. Paste the contents of `Sync.gs` into the script editor.
3. Project Settings > Script Properties, add:
   - `SYNC_WEBHOOK_URL` = `https://<your-vercel-domain>/api/sync/webhook`
   - `SYNC_SECRET` = same value as `SYNC_WEBHOOK_SECRET` in the app's `.env`
4. Run `manualTestSync` once from the editor toolbar, grant permissions when prompted, check the execution log (View > Logs).
5. Run `syncAllTabs` once manually, confirm rows appear in the app's database.
6. Run `createTimeTrigger` once to install the 10-minute polling trigger.

## Real sheet layout

`TABS` in `Sync.gs` points at the real tab names in the live workbook
(`[MII_Furniture]_WH049_TTRANG`): `2. Danh sách đơn hàng`, `3. Đơn hàng đã
giao`, `4.1 Đơn hủy`, `4.2 Giao thất bại`, `5. Trả hàng/hoàn tiền`, `6. Check
tồn kho dự kiến`. Every one of these tabs carries a row-1 banner ("MII điền" /
"NCC điền" / "KAM điền" — who is responsible for filling in each column)
above the real header row, so `HEADER_ROW` in `Sync.gs` is `2`, not `1`, and
data starts at row 3.

Column headers for `4.1 Đơn hủy` and `5. Trả hàng/hoàn tiền` were not
inspected directly — the field mapping in `lib/sync/apply.ts` assumes they
share `4.2 Giao thất bại`'s column layout (same workbook, same template).
Verify this once real data syncs from those two tabs, and adjust the header
aliases in `apply.ts` if they differ.

The order sheet itself carries no per-order price or SKU (it only tracks
shipping status) — `orders`/`delivered_orders` have no amount field, and
reconciliation against the uploaded Excel settlement file compares order
existence and status only, not amounts.

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

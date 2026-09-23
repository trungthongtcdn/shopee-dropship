# Apps Script deployment

1. Open the Shopee-owned Google Sheet, then Extensions > Apps Script.
2. Paste the contents of `Sync.gs` into the script editor.
3. Project Settings > Script Properties, add:
   - `SYNC_WEBHOOK_URL` = `https://<your-vercel-domain>/api/sync/webhook`
   - `SYNC_SECRET` = same value as `SYNC_WEBHOOK_SECRET` in the app's `.env`
4. Run `manualTestSync` once from the editor toolbar, grant permissions when prompted, check the execution log (View > Logs).
5. Run `syncAllTabs` once manually, confirm rows appear in the app's database.
6. Run `createTimeTrigger` once to install the 10-minute polling trigger.

## Second script: SKU pricing (a different workbook)

`PricingSync.gs` is a **separate** container-bound script for a **different**
Google Sheet — "MII dữ liệu đối soát Luân up" (Luân's own SKU→price reference
file, not Shopee's). It only syncs one tab, "THÔNG TIN HÀNG HOÁ", to the
`sku_pricing` backend tab, which patches `kiot_code`/`collect_price` onto
`Product` rows that already exist from the main Shopee sync — it never
creates or deletes Product rows on its own.

Deploy it the same way as `Sync.gs`, but bound to the *other* spreadsheet:

1. Open "MII dữ liệu đối soát Luân up", then Extensions > Apps Script.
2. Paste the contents of `PricingSync.gs`.
3. Script Properties: same `SYNC_WEBHOOK_URL` and `SYNC_SECRET` as `Sync.gs` (same backend, same secret).
4. Run `manualTestPricingSync` once, check the log.
5. Run `syncPricing` once, confirm `products.kiot_code`/`collect_price` populate for existing SKUs.
6. Run `createPricingTimeTrigger` once (polls every 30 minutes — this data changes far less often than order status).

This sheet's tab uses a normal row-1 header (no "MII điền" banner row like
the Shopee workbook), so `PricingSync.gs` reads headers from row 1, data from
row 2 — do not copy `Sync.gs`'s `HEADER_ROW = 2` convention onto it.

## Fourth script: cancel/return receipt tracking (same workbook as pricing)

`CancelReceiptSync.gs` is a **new file added to the same Apps Script
project** as `PricingSync.gs` — same workbook ("MII dữ liệu đối soát Luân
up"), same container binding, no extra Editor access needed. It reads the
"ĐƠN HUỶ" tab: Luân's manual log of returned/cancelled goods actually
arriving back at her warehouse (a different date than
`cancellations.cancelled_at`, which is when Shopee's own system processed
the cancellation).

Column A ("Ngày nhận đơn huỷ") is pre-filled with a running calendar of
dates as a template, so a row only counts once column B ("Mã vận đơn") is
filled in by hand — rows with an empty tracking code are skipped. The
backend (`cancel_receipt` tab, `applyCancelReceiptPayload`) matches `Order`
rows by `trackingCode`, not `shopeeOrderId` — a package can cover multiple
product lines of the same order, and all of them get the same values.

**% hỏng convention (unverified):** treated as a whole-number percent (5 =
5%, divided by 100 before storing), matching the manual "% hỏng" input on
the report page — the "ĐƠN HUỶ" tab had no filled-in rows yet when this was
built, so double check the first real row lands correctly and adjust
`applyCancelReceiptPayload` if the sheet actually stores it differently
(e.g. already a 0–1 fraction, or a `"5%"` formatted string).

Deploy:

1. Open "MII dữ liệu đối soát Luân up" → Extensions → Apps Script (same
   project `PricingSync.gs`/`PaymentSync.gs` are already in).
2. Add a new script file, paste `CancelReceiptSync.gs`'s contents.
3. `SYNC_WEBHOOK_URL`/`SYNC_SECRET` already set — reused as-is.
4. Run `manualTestCancelReceiptSync`, check the log.
5. Run `syncCancelReceipt` — real push. Confirm on `/dashboard/report`:
   "Ngày nhận đơn huỷ" / "% hỏng" (via order detail) / cancel-receipt status
   populate for orders whose tracking code has a filled-in row.
6. Run `createCancelReceiptTimeTrigger` once (polls every 30 minutes).

## Third script: weekly payment settlement (a third workbook, view-only)

`PaymentSync.gs` is added as a **second file in the same Apps Script project**
as `PricingSync.gs` (bound to "MII dữ liệu đối soát Luân up") — it is not its
own bound script, because the actual source file, Shopee's weekly settlement
report ("[MII-Furniture]- PAYMENT-..."), is only Viewer-accessible. Reading a
spreadsheet by URL via `SpreadsheetApp.openByUrl` only needs Viewer access;
binding a script to it (like the other two sources) would need Editor.

That file has **one tab per week** (tab name is the date range, e.g.
"07/09/2026-13/09/2026"), each row is one product line within an order (not
one row per order), and the header row is row 8 (data from row 9) — a few
company/report-title rows sit above it. `PaymentSync.gs` sums "Giá trị còn
lại" (net amount after service fee + tax deduction) per **(Mã đơn hàng, Mã
sản phẩm) pair** — not per order alone — across every tab in the file, and
sends one aggregated row per (order, sku) to the backend under the `payment`
tab, which upserts (never deletes) `PaymentRecord` rows keyed the same way.
A multi-line order gets one `PaymentRecord` per line/SKU; summing every line
into one order-level total would make the Report page compare a single
line's "Giá cần thu về" against the whole order's payment.

Deploy:

1. Open "MII dữ liệu đối soát Luân up" → Extensions → Apps Script (same
   project `PricingSync.gs` is already in).
2. Add a new script file, paste `PaymentSync.gs`'s contents.
3. Script Properties: add `PAYMENT_SHEET_URL` = the full URL of the
   "[MII-Furniture]- PAYMENT-..." spreadsheet (copy from its address bar).
   `SYNC_WEBHOOK_URL`/`SYNC_SECRET` are already set from the `PricingSync.gs`
   deploy — reused as-is.
4. Run `manualTestPaymentSync` once, check the log for the aggregated order
   count and a sample of rows.
5. Run `syncPayment` once, confirm `payment_records` rows appear (the Report
   page's "Số tiền thanh toán" column should populate).
6. Run `createPaymentTimeTrigger` once (polls every 30 minutes).

### Per-week batch detail (Reconciliation page)

The same file also feeds a second, independent sync: `syncPaymentBatches`
sends one payload PER WEEKLY TAB (raw per-line rows, not the cross-week
aggregate `syncPayment` sends), landing in `payment_batches` /
`payment_batch_lines`. This is what the Reconciliation page's batch list
browses — one batch per sheet tab, same name, click through to see that
week's raw order lines (Mã sản phẩm, Giá bán, Phí dịch vụ, Khấu trừ thuế,
Giá trị còn lại). It does not affect the Report page's amount column —
that stays on `syncPayment`'s aggregate, untouched.

7. Run `manualTestPaymentBatches` once, check the log for the batch count
   and a sample row.
8. Run `syncPaymentBatches` once, confirm batches appear on the
   Reconciliation page.
9. Run `createPaymentBatchTimeTrigger` once (polls every 30 minutes,
   independent of `createPaymentTimeTrigger`'s trigger).

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

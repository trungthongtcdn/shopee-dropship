# Excel gom nhóm đơn từ PDF phiếu gửi hàng — Design

Warehouse packs faster when identical orders sit next to each other. For every
waybill PDF the app already ingests (Zalo group message, pasted link, uploaded
file) it now also produces an `.xlsx` of the orders grouped by identical content.

## What the PDF contains (verified against a real SPX AWB, 6 pages)

Each page: `Mã vận đơn:`, `Mã đơn hàng:`, then

```
Nội dung hàng (Tổng SL sản phẩm: N)
1. [FURNI HOME] <product name>, <variant>, SL: <qty>
2. ...
```

The item text is hard-wrapped by pixel width **mid-word** ("chấ" / "t lượng"), and
the space at a wrap point is lost in `pdftotext`. So:

- **Grouping key ignores whitespace and case** (identical items wrap identically
  anyway, so the key is exact in practice).
- Display text rejoins wrapped lines with a small heuristic (`joinWrappedLines`);
  it can occasionally glue/split a word — cosmetic only, never affects grouping.
- Label can hide items ("Một số sản phẩm có thể bị ẩn"): when the parsed `SL` sum
  differs from `Tổng SL sản phẩm`, the row gets a note instead of being trusted.
- Pages with no readable item block still appear (last group, with a note) —
  no order is ever dropped from the sheet.

## Grouping / ordering

Two orders are "identical" when their sorted item list — (name, variant, qty)
per item — is equal. Groups are ordered by size (largest first), then by first
item name; the unreadable group goes last. Inside a group the PDF order is kept.

## Excel

One sheet, header on row 1 (filter-friendly): `Nhóm | Số đơn | STT | Mã đơn hàng |
Mã vận đơn | Sản phẩm | Phân loại | SL | Ghi chú`. One row per product line
(multi-item orders repeat order/tracking code). Alternating fill per group,
frozen header, autofilter. Built with `exceljs` (SheetJS CE can't style cells).

## Flows

- **Zalo:** after the confirmation is applied, build the xlsx and send it to the
  same thread via a new bridge endpoint `POST /send-file`. Failure to build/send
  is logged and never blocks the confirmation or the cursor.
- **Manual (link/upload):** build the xlsx; for an *uploaded* PDF also keep the
  PDF bytes (a link PDF stays reachable by its URL). Stored in `waybill_files`
  (Postgres `bytea`) keyed by the confirmation log row.
- **UI (`/dashboard/dong-don`, column "Xem file"):** `Xem PDF` (unchanged for
  links, now also works for uploads) + green `Xem excel` wherever a file exists.
  Rows from before this feature keep just `Xem PDF`.
- `GET /api/waybills/[logId]/pdf|xlsx` serve the stored files behind the session
  auth (added to the middleware matcher).

## Bridge (outside this repo)

`/opt/zalo-bridge-thanhluan` gets `POST /send-file {thread_id, thread_type,
filename, file_base64, message?}` (zca-js `attachments: [{data, filename,
metadata:{totalSize}}]`) and a larger JSON body limit. Backed up first; service
restarted once; existing endpoints untouched.

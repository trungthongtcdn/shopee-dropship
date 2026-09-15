# Shopee Dropship Order Sync & Reconciliation — Design

Date: 2026-09-09
Status: Approved (design), pending implementation plan

## Context

Người bán vận hành mô hình dropship, Shopee đóng vai trò người mua. Shopee duy trì 1 Google Sheet gồm 3 tab: đơn hàng, đơn huỷ, sản phẩm/giá. Người bán có quyền Editor trên file này.

Mục tiêu: xây web app + DB riêng, tự động mirror dữ liệu từ Sheet Shopee vào hệ thống, và hỗ trợ đối soát ("reconciliation") giữa dữ liệu mirror này với file Excel đối soát mà Shopee gửi định kỳ (offline, upload tay).

Ngoài scope: các nhu cầu tracking khác chưa xác định (user sẽ bổ sung task riêng sau — không thiết kế trước theo YAGNI).

## Quyết định kiến trúc đã chốt

- **Target**: Web app + Postgres DB riêng (không chỉ clone Sheet).
- **Quyền truy cập Sheet**: Editor — cho phép container-bound Apps Script gắn trực tiếp vào file Shopee.
- **Cơ chế đối soát**: so khớp dữ liệu mirror (từ Sheet) với file Excel đối soát Shopee gửi định kỳ, upload tay qua UI — không phải so với 1 module ghi nhận nội bộ khác.
- **Cơ chế đồng bộ**: time-driven polling trigger (5-15 phút), không dùng onEdit/onChange — vì Sheet nhiều khả năng được Shopee ghi qua script/API riêng, không phải chỉnh tay qua UI, nên trigger onEdit/onChange không đảm bảo bắt được thay đổi.
- **Tech stack**: Next.js (App Router + API routes) + Postgres (Supabase/Neon), deploy Vercel.
- **Xoá dòng khỏi Sheet**: soft-delete (giữ lịch sử, không xoá cứng).

## 1. Kiến trúc tổng thể

```
Google Sheet (Shopee)                    Next.js app (Vercel)
┌─────────────────┐                      ┌──────────────────────────┐
│ Tab: Orders      │   time trigger      │ /api/sync/webhook  ← Apps │
│ Tab: Cancellations│   5-15 phút         │   Script gọi vào (POST,   │
│ Tab: Products     │──── quét/hash ─────▶│   auth bằng secret token) │
└─────────────────┘   gửi payload         │                            │
                                          │ Postgres (Supabase/Neon)  │
                                          │  - orders                 │
                                          │  - cancellations          │
                                          │  - products               │
                                          │  - sync_log (audit trail) │
                                          └──────────────────────────┘
                                                     ▲
                                          Excel đối soát Shopee gửi
                                          → upload tay qua UI
                                          → /api/reconcile/upload
                                          → parse, so khớp orders
                                          → reconciliation_result
```

Apps Script bound vào file Shopee (do có quyền Edit), chạy time-driven trigger, mỗi lần quét toàn bộ 3 tab, tính hash từng dòng, gửi toàn bộ payload lên webhook (stateless phía Apps Script — backend giữ state và tự diff, tránh lệch trạng thái 2 nơi).

Backend nhận webhook, so hash với DB, insert/update/soft-delete tương ứng, ghi `sync_log` mỗi lần thay đổi (audit trail: ai/khi nào/dòng nào/giá trị cũ-mới).

File Excel đối soát: upload tay qua UI, backend parse, so khớp theo `shopee_order_id` với bảng `orders` đã mirror, ra bảng kết quả lệch.

## 2. Data model (Postgres)

**orders** — mirror tab đơn hàng
- `id` (PK, serial)
- `shopee_order_id` (text, unique) — khoá match với file đối soát
- `sku`, `product_name`, `quantity`, `unit_price`, `total_amount`
- `status` (text)
- `raw_row_hash` (text)
- `sheet_row_index` (int)
- `is_active` (bool, default true), `deleted_at` (timestamp, null)
- `first_synced_at`, `last_synced_at` (timestamp)

**cancellations** — mirror tab đơn huỷ
- `id` (PK)
- `shopee_order_id`
- `reason`, `cancelled_at`
- `raw_row_hash`, `sheet_row_index`
- `is_active`, `deleted_at`
- `first_synced_at`, `last_synced_at`

**products** — mirror tab sản phẩm/giá
- `id` (PK)
- `sku` (unique)
- `product_name`, `price`
- `raw_row_hash`, `sheet_row_index`
- `is_active`, `deleted_at`
- `first_synced_at`, `last_synced_at`

**sync_log** — audit trail mỗi lần thay đổi
- `id` (PK)
- `source_tab` (enum: orders/cancellations/products)
- `sheet_row_index`
- `change_type` (insert/update/delete)
- `old_value`, `new_value` (jsonb)
- `synced_at`

**reconciliation_batches** — mỗi lần upload file Excel
- `id` (PK)
- `file_name`, `uploaded_at`
- `period_label` (text, optional)
- `status` (processing/done/error)

**reconciliation_results** — kết quả so khớp từng đơn trong 1 batch
- `id` (PK)
- `batch_id` (FK → reconciliation_batches)
- `shopee_order_id`
- `match_status` (enum: matched/missing_in_sheet/missing_in_excel/amount_mismatch/status_mismatch/parse_error)
- `sheet_amount`, `excel_amount`
- `diff_detail` (jsonb)

`raw_row_hash`: SHA-256 trên toàn nội dung dòng. Backend giữ hash mới nhất làm nguồn sự thật; Apps Script không tự lưu state.

## 3. Sync / mapping logic

**Apps Script:**
- Time-driven trigger, chạy mỗi 10 phút.
- Đọc 3 tab, dùng `getLastRow()`/`getLastColumn()` tránh đọc dư.
- Tính hash từng dòng, gom payload `[{row_index, hash, data}]` theo tab.
- POST lên `/api/sync/webhook`, header `X-Sync-Secret` (token tĩnh, Script Properties ↔ env backend).
- Payload lớn → chia batch theo tab, nhiều request nhỏ.
- Retry tối đa 3 lần nếu fail (network/5xx), backoff vài giây; fail hết → log lỗi vào Script Properties, chờ trigger kế tiếp.

**Backend (`/api/sync/webhook`):**
- Sai secret → 401.
- Với mỗi dòng: hash mới khác DB → insert (row_index chưa có) hoặc update (khác hash), ghi `sync_log`. Hash giống → skip, không log.
- Dòng có trong DB nhưng mất khỏi payload → soft-delete: `is_active = false`, `deleted_at = now()`, ghi `sync_log` (delete). Giữ nguyên data để trace lịch sử đối soát.
- Payload thiếu field/sai format ở 1 vài dòng → skip dòng lỗi, xử lý tiếp phần còn lại, trả response kèm danh sách dòng lỗi (không fail cả request).
- DB lỗi → 500, Apps Script tự retry lượt sau.

## 4. Reconciliation logic (upload Excel)

**Upload flow:**
- User upload file qua UI → `/api/reconcile/upload`.
- Backend parse (`xlsx`/`exceljs`), tạo `reconciliation_batches` (status `processing`).
- Sai định dạng/thiếu cột bắt buộc → reject ngay, trả lỗi rõ cột thiếu, không tạo batch.
- Parser map cột theo tên header (không cứng theo vị trí cột) — cấu trúc cột thật của file Shopee gửi chưa có mẫu, cần xác nhận khi có file thật.

**Match logic (theo `shopee_order_id`):**
- Tìm trong `orders` (gồm cả `is_active = false`, vì đơn có thể đã bị Shopee xoá khỏi Sheet nhưng vẫn có trong file đối soát).
- Không tìm thấy → `missing_in_sheet`.
- Tìm thấy, khớp amount/status → `matched`.
- Tìm thấy, lệch amount hoặc status → `amount_mismatch`/`status_mismatch`, ghi `diff_detail`.
- Order active trong DB nhưng không có trong file batch đó → `missing_in_excel`.
- 1 dòng Excel parse lỗi giữa chừng → skip, ghi `parse_error`, không fail cả file.
- Ghi hết vào `reconciliation_results`, cập nhật batch status `done`.

**UI**: bảng kết quả theo batch, filter theo `match_status`, tổng hợp số tiền lệch.

## 5. Error handling

- Webhook: sai secret → 401; payload lỗi từng phần → skip dòng lỗi, xử lý tiếp; DB lỗi → 500 + Apps Script tự retry.
- Apps Script: retry 3 lần khi POST fail; payload quá lớn → chia batch nhỏ theo tab.
- Upload Excel: thiếu cột bắt buộc → reject trước khi tạo batch; lỗi parse từng dòng → skip + ghi nhận, không fail cả file.
- Không xây hệ thống alert riêng ở bản đầu (YAGNI) — `sync_log` + `reconciliation_batches.status` đủ để user tự kiểm tra qua dashboard.

## 6. Testing approach

- Apps Script: hàm `manualTestSync()` chạy tay trong editor trước khi bật trigger thật; test trên sheet giả lập (copy sheet Shopee) trước khi gắn vào file gốc.
- Backend unit test: logic diff hash + mapping (insert/update/soft-delete đúng); reconciliation matcher (cover đủ 5 case match_status).
- Backend integration test: webhook endpoint — secret đúng/sai, payload hợp lệ/lỗi → check response + DB state.
- Không làm e2e tự động full flow ở bản đầu (YAGNI) — test tay qua dashboard đủ cho scope hiện tại.

## Ngoài scope (deferred)

- Các yêu cầu tracking khác user sẽ bổ sung sau — chưa thiết kế, chờ task riêng.
- Cấu trúc cột chính xác của file Excel đối soát Shopee gửi — chưa có mẫu thật, parser thiết kế linh hoạt (map theo header) để dễ chỉnh khi có mẫu.

## Addendum (2026-09-15): calibration against real sheet

Đọc trực tiếp file Shopee thật (`[MII_Furniture]_WH049_TTRANG`), một số giả định ban đầu sai, đã chỉnh lại:

- **6 tab thật** thay 3 tab giả định: `2. Danh sách đơn hàng` (orders), `3. Đơn hàng đã giao` (delivered_orders — bảng mới), `4.1 Đơn hủy` + `4.2 Giao thất bại` + `5. Trả hàng/hoàn tiền` (gộp chung bảng `cancellations`, phân biệt bằng cột `type`), `6. Check tồn kho dự kiến` (products).
- **Header nằm dòng 2**, không phải dòng 1 (dòng 1 là banner "MII điền"/"NCC điền"/"KAM điền").
- **Tab đơn hàng không có giá/SKU** — chỉ theo dõi giao vận. Đối soát vì vậy chỉ so theo tồn tại đơn + trạng thái (bỏ `amount_mismatch` khỏi `MatchStatus`), không so số tiền Sheet vs Excel.
- **Khoá đối soát** = cột "Mã đơn hàng" (không phải "Mã vận đơn" hay "Mã Kiện Hàng" — 3 mã khác nhau trong sheet thật).
- **Products** lấy từ tab tồn kho: SKU = "MII - Mã phân loại", tên = "Tên sản phẩm", giá = "Giá nhập chưa VAT" (giá nhập, không phải giá bán).
- Mapping dùng alias/case-insensitive lookup (`lib/sync/headerLookup.ts`) thay vì key cứng, vì header viết hoa/thường không nhất quán giữa các tab trong cùng file.
- **Chưa xác nhận trực tiếp** cột của tab `4.1 Đơn hủy` và `5. Trả hàng/hoàn tiền` — giả định giống `4.2 Giao thất bại` (cùng file, cùng template). Cần verify khi có dữ liệu thật từ 2 tab này.

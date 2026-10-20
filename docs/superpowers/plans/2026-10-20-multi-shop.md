# Nhiều shop trên app dropship — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Một ô chọn shop ở header; mỗi shop có dữ liệu, mã bí mật Apps Script, nhóm Zalo, link SKU riêng, chạy y nghiệp vụ cũ.

**Architecture:** Mỗi shop một Postgres schema (`shop_1` = schema `public` hiện tại, `shop_2`… là schema mới). `prisma` trong `lib/db.ts` thành Proxy chọn PrismaClient theo shop hiện tại (AsyncLocalStorage → cookie `shop` → mặc định chỉ ở dev/test). Bảng dùng chung (`users`, `shops`) đi qua `sharedPrisma`. Route ghi đi qua `withShop` (kiểm tra shop của tab). Poller và webhook chạy từng shop bằng `runWithShop`.

**Tech Stack:** Next.js 14 App Router, Prisma 5.18 (`datasourceUrl`), Postgres 16, vitest (Postgres thật, chạy tuần tự), tsx.

**Spec:** `docs/superpowers/specs/2026-10-20-multi-shop-design.md`

## Global Constraints

- Giữ stack: Next.js 14, Prisma, Postgres, Docker Compose trên VPS 110.172.29.21, repo `trungthongtcdn/shopee-dropship`.
- Production không có shop mặc định ngầm: thiếu thông tin shop thì báo lỗi. Dev/test mặc định về `shop_1`.
- 628 test hiện có vẫn qua. Không đổi hợp đồng `lib/waybill/*`. Không đưa Prisma vào Edge `middleware.ts`.
- Cookie chọn shop sống 1 năm. Chữ giao diện bằng tiếng Việt.
- Tên shop: không trống, tối đa 40 ký tự, không trùng shop khác (không phân biệt hoa thường). Mặc định "Shop 1", "Shop 2"…
- Mã bí mật webhook lưu dạng băm sha256, chỉ in ra một lần; so sánh chống dò thời gian.
- Làm trên nhánh `feat/multi-shop`. Không push, không deploy cho tới khi chủ app nói "deploy"; trước deploy `pg_dump` backup.

## Review Focus

1. Cookie `shop` giả hoặc trỏ shop đã xoá: route API trả 409 (không phải 500), layout đặt lại về shop đầu. (Task 3, 5)
2. Hai shop cùng có đơn `id = 1`: sửa đơn khi ở shop B không bao giờ chạm đơn của shop A. (Task 3)
3. Header `X-Sync-Secret` rỗng/thiếu khi shop đầu không đặt env: không khớp shop nào. (Task 4)
4. Một shop lỗi (bridge, DB) không chặn shop còn lại trong vòng quét Zalo. (Task 4)
5. Tên shop: trống, toàn khoảng trắng, 41 ký tự, trùng khác hoa thường, có `<script>`: bị từ chối hoặc hiển thị an toàn. (Task 2, 5)

---

### Task 1: Nền móng — nhận diện shop, kết nối theo shop, bảng `shops`

**Files:**
- Create: `lib/shops/slug.ts`, `lib/shops/context.ts`
- Modify: `lib/db.ts`, `prisma/schema.prisma` (model `Shop`)
- Create: `prisma/migrations/20261020000000_shops/migration.sql`
- Modify (đổi `prisma.user` → `sharedPrisma.user`): `lib/auth/currentUser.ts`, `app/api/auth/login/route.ts`, `app/api/accounts/route.ts`, `app/api/accounts/[id]/route.ts`, `app/api/accounts/me/waybill-format/route.ts`, `app/dashboard/accounts/page.tsx`, `app/dashboard/dong-don/page.tsx` và các test dùng `prisma.user` (`tests/api/accounts.test.ts`, `auth.test.ts`, `account-waybill-format.test.ts`, `middleware`/`waybills` nếu có)
- Test: `tests/shops/slug.test.ts`, `tests/shops/context.test.ts`

**Interfaces:**
- Produces (`lib/shops/slug.ts`): `PRIMARY_SLUG = "shop_1"`, `SHOP_COOKIE = "shop"`, `SHOP_HEADER = "x-shop"`, `isShopSlug(value: unknown): value is string` (khớp `^shop_[1-9][0-9]{0,2}$`), `schemaFor(slug: string): string` (`shop_1` → `"public"`, còn lại giữ nguyên), `shopDatabaseUrl(baseUrl: string, slug: string): string` (`shop_1` trả nguyên `baseUrl`; shop khác đặt `?schema=<slug>`, giữ các tham số khác).
- Produces (`lib/shops/context.ts`): `runWithShop<T>(slug: string, fn: () => T): T`; `currentShopSlug(): string` — thứ tự: giá trị trong `runWithShop` → cookie `shop` hợp lệ (trong phạm vi request của Next; cookie thiếu/sai định dạng → `PRIMARY_SLUG`) → ngoài request: `PRIMARY_SLUG` khi `NODE_ENV !== "production"`, còn lại ném `Error("No shop in scope")`.
- Produces (`lib/db.ts`): `type ShopClient = Omit<PrismaClient, "user" | "shop">`; `clientFor(slug: string): PrismaClient` (cache theo slug trên `globalThis`, ném lỗi nếu slug sai định dạng); `sharedPrisma: PrismaClient` (= `clientFor(PRIMARY_SLUG)`); `prisma: ShopClient` (Proxy: mỗi truy cập thuộc tính lấy `clientFor(currentShopSlug())`, hàm được bind vào client).
- Produces (Prisma): `model Shop { id Int @id @default(autoincrement()); slug String @unique; name String; secretHash String? @unique @map("secret_hash"); skuSheetUrl String? @map("sku_sheet_url"); createdAt DateTime @default(now()) @map("created_at"); @@map("shops") }`. Migration tạo bảng và chèn dòng `('shop_1', 'Shop 1')`.

- [ ] **Step 1: Viết test thất bại** `tests/shops/slug.test.ts`: `isShopSlug("shop_2")` true; `"shop_0"`, `"shop_1000"`, `"public"`, `"shop_2; DROP"`, `undefined` false. `schemaFor("shop_1") === "public"`, `schemaFor("shop_2") === "shop_2"`. `shopDatabaseUrl("postgresql://u:p@h:5432/db", "shop_2")` có `schema=shop_2`; với `shop_1` bằng URL gốc; URL gốc có `?connection_limit=5` giữ nguyên tham số đó.
- [ ] **Step 2: Viết test thất bại** `tests/shops/context.test.ts`: ngoài `runWithShop` ở `NODE_ENV=test` trả `shop_1`; trong `runWithShop("shop_2", async () => { await sleep; return currentShopSlug() })` trả `shop_2` kể cả sau `await`; `vi.stubEnv("NODE_ENV","production")` ngoài request ném `No shop in scope`; trong `runWithShop` ở production vẫn chạy được.
- [ ] **Step 3: Chạy hai file test, thấy FAIL** (`npx vitest run tests/shops`).
- [ ] **Step 4: Cài đặt `slug.ts` và `context.ts`** như Interfaces. `context.ts` dùng `AsyncLocalStorage` và `cookies()` từ `next/headers` bọc `try/catch` (ném ngoài request scope).
- [ ] **Step 5: Thêm model `Shop` + migration**, chạy `npx prisma migrate dev --name shops` (hoặc viết tay SQL rồi `npx prisma migrate deploy`) trên DB local, `npx prisma generate`.
- [ ] **Step 6: Viết lại `lib/db.ts`** theo Interfaces (`datasourceUrl` cho shop khác `shop_1`; giữ cache `globalThis` ở dev). Đổi mọi `prisma.user` sang `sharedPrisma.user` (danh sách Files). Chạy `npx tsc --noEmit` — không còn lỗi `user`/`shop` trên `ShopClient`.
- [ ] **Step 7: Chạy toàn bộ test** (`npx vitest run`) — cùng số test qua như trước (628) cộng test mới.
- [ ] **Step 8: Commit** `feat: nền móng nhiều shop (slug, ngữ cảnh shop, prisma theo shop, bảng shops)`.

---

### Task 2: Sổ shop — danh sách, đổi tên, mã bí mật

**Files:**
- Create: `lib/shops/registry.ts`
- Test: `tests/shops/registry.test.ts`

**Interfaces:**
- Consumes: `sharedPrisma` (Task 1).
- Produces: `interface ShopInfo { id: number; slug: string; name: string; skuSheetUrl: string | null }`; `listShops(): Promise<ShopInfo[]>` (theo `id` tăng); `getShop(slug: string): Promise<ShopInfo | null>`; `normalizeShopName(raw: unknown): { ok: true; name: string } | { ok: false; error: string }` (cắt khoảng trắng đầu/cuối, gộp khoảng trắng liên tiếp; lỗi tiếng Việt cho trống / quá 40 ký tự); `renameShop(id: number, raw: unknown): Promise<{ ok: true; shop: ShopInfo } | { ok: false; status: 400 | 404 | 409; error: string }>` (409 khi trùng tên shop khác không phân biệt hoa thường); `hashSecret(secret: string): string` (sha256 hex); `generateSecret(): string` (48 ký tự hex); `shopForSecret(secret: string | null): Promise<ShopInfo | null>` (secret rỗng/null → `null`; khớp `SYNC_WEBHOOK_SECRET` khi env có giá trị → shop `PRIMARY_SLUG`; còn lại tìm theo `secretHash`).

- [ ] **Step 1: Viết test thất bại** `tests/shops/registry.test.ts` (dùng dòng `shop_1` có sẵn; test tự tạo/xoá thêm dòng `shop_8` trong `beforeEach/afterEach`): `listShops()` có `shop_1` tên "Shop 1" đầu tiên; `renameShop` đổi tên rồi `getShop` trả tên mới (trả lại tên cũ cuối test); tên `"   "`, 41 ký tự → `400`; tên của shop khác viết khác hoa thường → `409`; id không tồn tại → `404`; tên `"<script>x</script>"` được lưu nguyên văn (React escape khi hiển thị); `shopForSecret(null)`, `shopForSecret("")` → `null` kể cả khi env `SYNC_WEBHOOK_SECRET` không đặt; `shopForSecret(env)` → `shop_1`; shop có `secretHash = hashSecret("abc")` → `shopForSecret("abc")` trả shop đó; `"abd"` → `null`.
- [ ] **Step 2: Chạy test, thấy FAIL.**
- [ ] **Step 3: Cài đặt `registry.ts`** như Interfaces. So sánh secret env bằng `timingSafeEqual` trên hai digest sha256 (độ dài bằng nhau).
- [ ] **Step 4: Chạy test, thấy PASS.**
- [ ] **Step 5: Commit** `feat: sổ shop (danh sách, đổi tên, mã bí mật)`.

---

### Task 3: Chống ghi nhầm shop — `withShop`, route ghi/tải, API chọn/đổi tên shop

**Files:**
- Create: `lib/shops/guard.ts`, `lib/shops/shopFetch.ts`, `lib/shops/ShopMarker.tsx`
- Create: `app/api/shops/select/route.ts`, `app/api/shops/reset/route.ts`, `app/api/shops/[id]/route.ts`
- Modify: `middleware.ts` (matcher thêm `"/api/shops/:path*"`); bọc bằng `withShop` các route: `app/api/orders/[id]/route.ts` (PATCH), `app/api/reconcile/upload/route.ts` (POST), `app/api/zalo/manual-confirm/route.ts` (POST), `app/api/zalo/watch/route.ts` (GET `none`, POST `header`), `app/api/don-huy/manual-scan/route.ts` (POST), `app/api/waybills/[logId]/[kind]/route.ts` (GET `query`), `app/api/report/export/route.ts` (GET `query`)
- Create: `tests/helpers/testShop.ts`; Test: `tests/shops/guard.test.ts`, `tests/shops/isolation.test.ts`

**Interfaces:**
- Consumes: `getShop`, `renameShop`, `listShops` (Task 2); `runWithShop`, constants (Task 1).
- Produces: `withShop<C>(handler: (request: NextRequest, context: C, shop: ShopInfo) => Promise<Response> | Response, options?: { check?: "header" | "query" | "none" }): (request: NextRequest, context: C) => Promise<Response>`. Shop của request = cookie `shop` hợp lệ, không có cookie → `PRIMARY_SLUG`. Shop không có trong sổ → `409 { error, code: "shop_unknown" }`. `check: "header"`: so `X-Shop` với shop của request; khác → `409 { code: "shop_mismatch", error: "Tab này đang ở shop khác với shop đang chọn. Hãy tải lại trang rồi làm lại." }`; thiếu header → bỏ qua ở dev/test, `409 shop_missing` ở production. `check: "query"`: giống nhưng đọc `?shop=`. Chạy `handler` trong `runWithShop(slug, …)`.
- Produces (client): `shopFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>` thêm header `x-shop` lấy từ phần tử `[data-shop-slug]`; `<ShopMarker slug={string} />` render `<span hidden data-shop-slug={slug} />`.
- Produces (API): `POST /api/shops/select` body `{ slug }` → đặt cookie `shop` (httpOnly, sameSite lax, secure ở production, path `/`, maxAge 1 năm), `404` nếu slug không có trong sổ, `401` nếu chưa đăng nhập. `GET /api/shops/reset` xoá cookie rồi chuyển về `/dashboard`. `PATCH /api/shops/[id]` body `{ name }` → `renameShop`, trả `{ shop }` hoặc `{ error }` kèm status.
- Produces (test helper): `tests/helpers/testShop.ts` → `createTestShop(slug = "shop_9"): Promise<void>` (tạo schema + chạy `prisma migrate deploy` bằng `shopDatabaseUrl`, chèn dòng `shops`), `dropTestShop(slug): Promise<void>` (`DROP SCHEMA … CASCADE` + xoá dòng).

- [ ] **Step 1: Viết test thất bại** `tests/shops/guard.test.ts` (không cần schema thứ hai; handler giả trả `currentShopSlug()`): không cookie → `shop_1`; cookie `shop=shop_77` (không có trong sổ) → 409 `shop_unknown`; cookie `shop=%27%3B--` (sai định dạng) → chạy với `shop_1`; `check:"header"` với `X-Shop: shop_2` khi shop request là `shop_1` → 409 `shop_mismatch`; khớp → 200; thiếu header ở `NODE_ENV=production` → 409 `shop_missing`; `check:"query"` khác tương tự.
- [ ] **Step 2: Viết test thất bại** `tests/shops/isolation.test.ts` (`beforeAll: createTestShop("shop_9")`, `afterAll: dropTestShop` và `$disconnect`, timeout dài): tạo `order` có `id` cùng số ở `shop_1` và `shop_9` (qua `runWithShop`); `PATCH /api/orders/[id]` với cookie `shop=shop_9` chỉ sửa `note` của đơn ở `shop_9`, đơn `shop_1` nguyên vẹn; PATCH với cookie `shop_1` mà `X-Shop: shop_9` → 409 và không đổi gì; `GET /api/waybills/<logId>/xlsx?shop=shop_9` không trả file của `shop_1` có cùng `logId`; `listShops()` không đổi sau test.
- [ ] **Step 3: Chạy hai file, thấy FAIL.**
- [ ] **Step 4: Cài đặt `guard.ts`, `shopFetch.ts`, `ShopMarker.tsx`, `testShop.ts`, ba route `app/api/shops/*`; thêm matcher; bọc các route liệt kê (giữ nguyên chữ ký `(request, { params })`).** Route `shops/select` và `shops/[id]` dùng `getUserFromRequest` để chặn khi tài khoản đã bị xoá.
- [ ] **Step 5: Chạy `npx vitest run tests/shops tests/api` — PASS.** (Các test route cũ vẫn qua nhờ mặc định `shop_1` ở môi trường test.)
- [ ] **Step 6: Commit** `feat: chặn ghi nhầm shop (withShop), API chọn và đổi tên shop`.

---

### Task 4: Webhook, bộ đọc Zalo, danh sách SKU theo shop

**Files:**
- Modify: `app/api/sync/webhook/route.ts`, `scripts/zaloPoller.ts`, `lib/skus.ts`
- Test: `tests/api/sync-webhook.test.ts` (thêm ca), `tests/shops/webhookIsolation.test.ts`, `tests/shops/pollerLoop.test.ts`

**Interfaces:**
- Consumes: `shopForSecret`, `listShops` (Task 2); `runWithShop`, `clientFor`, `ShopClient` (Task 1).
- Produces: webhook dùng `shopForSecret(request.headers.get("x-sync-secret"))`; `null` → `401 { error: "unauthorized" }`; phần xử lý còn lại chạy trong `runWithShop(shop.slug, …)`. `lib/skus.ts`: `PrismaSkuStore` nhận `constructor(client: ShopClient = prisma)`; `skuCatalog(): Promise<SkuCatalog>` (cache theo `${slug}|${url}`, url = `shop.skuSheetUrl ?? process.env.SKU_SHEET_URL ?? SKU_SHEET_URL`, store dùng `clientFor(slug)`). `scripts/zaloPoller.ts` xuất `runShopCycles(shops: ShopInfo[], deps): Promise<void>` để test được: với mỗi shop chạy lần lượt `runPollCycle`, `runCancelReceiptPollCycle` và (nếu đến hạn theo từng shop) `runOverdueWarningPollCycle` trong `runWithShop`, mỗi bước bọc `try/catch` ghi log có tên shop; `main()` đọc lại `listShops()` mỗi vòng.

- [ ] **Step 1: Viết test thất bại**: (a) `tests/api/sync-webhook.test.ts` thêm: header thiếu/rỗng → 401 khi env không đặt; (b) `tests/shops/webhookIsolation.test.ts` (dùng `createTestShop("shop_9")` + `shops.secretHash = hashSecret("s9")`): gửi lô `orders` với `X-Sync-Secret: s9` → dòng nằm ở `shop_9`, `shop_1` không có; với secret env → nằm ở `shop_1`; secret lạ → 401; (c) `tests/shops/pollerLoop.test.ts`: `runShopCycles` với hai shop giả, cycle shop đầu ném lỗi → cycle shop sau vẫn được gọi, và mỗi cycle thấy đúng `currentShopSlug()` của nó.
- [ ] **Step 2: Chạy, thấy FAIL.**
- [ ] **Step 3: Cài đặt** webhook, `runShopCycles` + `main()`, `lib/skus.ts` như Interfaces. `main()` chỉ chạy khi file là điểm vào (`if (process.argv[1] === fileURLToPath(import.meta.url))` hoặc tách `runShopCycles` sang `lib/zalo/shopCycles.ts` rồi `scripts/zaloPoller.ts` import — chọn cách tách để tránh `main()` chạy khi test import).
- [ ] **Step 4: Chạy `npx vitest run tests/api tests/shops tests/waybill` — PASS.** Chạy thử `npx tsx scripts/zaloPoller.ts` ~25 giây trên DB local, thấy dòng `started` và không có lỗi import `next/headers`; dừng bằng Ctrl-C.
- [ ] **Step 5: Commit** `feat: webhook, bộ đọc Zalo và danh sách SKU chạy theo từng shop`.

---

### Task 5: Giao diện — ô chọn shop, tên shop, gửi `X-Shop`

**Files:**
- Modify: `app/dashboard/layout.tsx`, `app/dashboard/AppHeader.tsx`, `app/globals.css`, `app/dashboard/accounts/page.tsx`, `app/dashboard/report/page.tsx` (`exportHref` thêm `shop`), `app/dashboard/dong-don/page.tsx` (link tải thêm `?shop=`)
- Create: `app/dashboard/accounts/ShopNames.tsx`
- Modify (đổi `fetch` ghi sang `shopFetch`): `app/dashboard/reconciliation/UploadForm.tsx`, `app/dashboard/dong-don/ManualConfirmForm.tsx` (chỉ `/api/zalo/manual-confirm`), `app/dashboard/ZaloWatchForm.tsx` (chỉ `/api/zalo/watch`), `app/dashboard/don-huy/BarcodeScanForm.tsx`, `app/dashboard/report/RowEditor.tsx` (cả hai chỗ)
- Test: `tests/dashboard/` (thêm test thuần cho hàm dựng link nếu tách), xác minh bằng trình duyệt

**Interfaces:**
- Consumes: `listShops`, `currentShopSlug`, `ShopMarker`, `shopFetch` (Task 1–3), API `select`/`reset`/`[id]` (Task 3).
- Produces: `AppHeader` nhận thêm `shops: { slug: string; name: string }[]` và `currentSlug: string`. Layout: lấy `listShops()` + `currentShopSlug()`; slug không có trong sổ → `redirect("/api/shops/reset")`; render `<ShopMarker slug>` cạnh `AppHeader`. Ô chọn shop (kiểu `details.user-menu` có sẵn) đặt ngay sau tên thương hiệu: nút hiện tên shop hiện tại (cắt `…` quá ~160px), mục cho từng shop (đánh dấu shop hiện tại), mục cuối "Đặt tên shop…" trỏ `/dashboard/accounts`. Chọn shop khác → `POST /api/shops/select` rồi `window.location.href = pathname` (bỏ query). `ShopNames`: mỗi shop một ô nhập (tối đa 40) + nút "Lưu", gọi `PATCH /api/shops/[id]` bằng `fetch` thường, hiện lỗi từ server, `router.refresh()` khi xong; đặt trong mục "Tên shop" trên trang Tài khoản.

- [ ] **Step 1: Viết `ShopNames` và các sửa đổi giao diện** như Interfaces; thêm CSS cho ô chọn shop trong `globals.css` theo kiểu `.user-menu` hiện có.
- [ ] **Step 2: `npx tsc --noEmit` và `npx next build`** — sạch.
- [ ] **Step 3: Xác minh bằng trình duyệt** (DB local riêng `shopee_multishop_check`: `createdb`, `DATABASE_URL` trỏ vào đó, `prisma migrate deploy`, `npx tsx scripts/addShop.ts --name "Shop thử"` từ Task 6 nếu đã xong; nếu chưa, chèn tay bằng test helper): đăng nhập, đổi shop trong ô chọn, thấy trang tải lại ở cùng mục với dữ liệu khác; đổi tên shop thấy đổi ngay ở header; mở hai tab hai shop, ghi từ tab cũ thấy thông báo "Tab này đang ở shop khác…". Chụp màn hình header ở rộng 1280 và 1000.
- [ ] **Step 4: Commit** `feat: ô chọn shop ở header, đặt tên shop, gửi X-Shop từ trang`.

---

### Task 6: Lệnh thêm/migrate shop, tài liệu, kiểm tra cuối

**Files:**
- Create: `lib/shops/provision.ts`, `scripts/addShop.ts`, `scripts/migrateShops.ts`
- Modify: `package.json` (scripts `shop:add`, `shops:migrate`), `DEPLOY_VPS.md`, `google-apps-script/README.md`, `README.md`
- Test: `tests/shops/provision.test.ts`

**Interfaces:**
- Consumes: `shopDatabaseUrl`, `sharedPrisma`, registry (Task 1–2).
- Produces: `migrateShopSchema(slug: string): Promise<void>` (validate slug; `CREATE SCHEMA IF NOT EXISTS`; chạy `npx prisma migrate deploy` với `DATABASE_URL = shopDatabaseUrl(…)`; `shop_1` bỏ qua vì đã chạy bằng bước migrate thường); `addShop(input: { name: string; skuSheetUrl?: string | null }): Promise<{ shop: ShopInfo; secret: string }>` (slug kế tiếp = `shop_<số lớn nhất + 1>`; tên trống/quá dài/trùng → ném lỗi, không tạo gì; `migrateShopSchema` xong mới ghi dòng sổ với `secretHash`; chạy lại sau khi migrate dở dùng lại slug, không tạo dòng thừa); `scripts/addShop.ts --name "<tên>" [--sku-sheet <url>]` in tên, slug, mã bí mật và dặn dán vào `SYNC_SECRET`; `scripts/migrateShops.ts` chạy `migrateShopSchema` cho mọi shop trừ `shop_1`.

- [ ] **Step 1: Viết test thất bại** `tests/shops/provision.test.ts` (schema/shop `shop_9`, dọn sau test): `addShop` hai lần cùng tên → lần hai ném lỗi, sổ chỉ có một dòng; shop mới có bảng `orders` rỗng; secret trả về → `shopForSecret(secret)` ra đúng shop; `migrateShopSchema("shop_9")` chạy lại không lỗi; slug sai định dạng (`"public"`, `"shop_2; DROP"`) bị từ chối.
- [ ] **Step 2: Chạy, thấy FAIL.** **Step 3: Cài đặt** như Interfaces. **Step 4: Chạy, thấy PASS.**
- [ ] **Step 5: Cập nhật tài liệu**: `DEPLOY_VPS.md` — bước migrate thành `prisma migrate deploy` rồi `npx tsx scripts/migrateShops.ts`, mục "Thêm shop mới" (lệnh `shop:add` trong container `app`, dán mã vào Apps Script), mục backup `pg_dump` trước deploy; `google-apps-script/README.md` — mỗi shop một `SYNC_SECRET`; `README.md` — một đoạn về nhiều shop.
- [ ] **Step 6: Kiểm tra cuối**: `npx tsc --noEmit`; `npx vitest run` (tất cả qua); `npx next build`; trên DB `shopee_multishop_check` chạy lại kịch bản Task 5 Step 3 và kịch bản webhook (đẩy một dòng bằng mã shop 2, shop 1 không thấy).
- [ ] **Step 7: Commit** `feat: lệnh thêm và migrate shop, tài liệu nhiều shop`.

# Redesign UI theo canvas "Dropship Shopee – Redesign" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay toàn bộ UI của app (8 màn hình + layout chung) theo thiết kế mới trong canvas "Dropship Shopee – Redesign", giữ nguyên 100% logic nghiệp vụ, API routes, và Prisma schema — chỉ đổi phần trình bày (JSX/CSS), trừ 2 mẩu logic mới nhỏ mà bản thân thiết kế đòi hỏi (filter "chưa Luân check", trường `defectRate` trong manual-scan).

**Architecture:** Giữ nguyên kiến trúc Next.js App Router hiện tại (server component fetch data → client component chỉ cho phần tương tác). Đổi design token trong `globals.css` (giữ nguyên tên biến CSS, đổi giá trị) để toàn bộ class `.btn`, `.badge`, `.card`, v.v. tự động đổi màu mà không phải sửa từng component. Dựng 1 lớp hạ tầng dùng chung trước (Phase 0: token, font, header mới, sticky thead, pageSize, 2 mẩu logic mới), rồi sửa từng màn hình một (Phase 1–7), mỗi màn hình dùng lại đúng data-fetching/API hiện có.

**Tech Stack:** Next.js 14 App Router, React Server/Client Components, Prisma 5, Vitest, CSS thuần (custom properties, không Tailwind).

## Global Constraints

- Không đổi bất kỳ logic nghiệp vụ, Prisma schema, hay API route nào — chỉ UI. Ngoại lệ (2 chỗ, nêu rõ ở Phase 0): filter `luanCheck` mới trên Report, và field `defectRate` thêm vào `/api/don-huy/manual-scan`.
- Dùng lại design token CSS variable sẵn có trong `app/globals.css` — không hard-code màu trong JSX/inline style.
- Dùng lại component sẵn có (`FilterDropdown`, `Pagination`, `ZaloGroupPicker`, badge/card/table classes) khi thiết kế mới không mâu thuẫn — chỉ viết component mới khi thiết kế yêu cầu hành vi chưa có (header auto-hide, popup "Cập nhật đơn", thẻ lọc nhanh, tab).
- Mỗi task/màn hình chạy `npx tsc --noEmit` + `npx vitest run` sạch trước khi commit.
- Làm trên 1 branch mới (`ui-redesign`), PR riêng khi xong — không push thẳng `main` như các task trước trong session này.

---

## A. Quyết định (đã chốt với bạn ngày 2026-10-02)

1. **Bỏ hẳn 2 chip trạng thái** (Google Sheets + Zalo) ở header — không có data đáng tin cậy cho "đang đồng bộ"/"lỗi"/"mất kết nối", và bạn xác nhận bỏ luôn thay vì làm bản rút gọn. Header mới chỉ còn logo + nav 3 nhóm, không chip.
2. **Thẻ lọc nhanh "Chưa Luân check"** — field lọc mới, thêm vào `buildOrderWhere` + test (Phase 0 Task 5).
3. **`defectRate` trong Nhận đơn huỷ** — field mới, thêm vào API (Phase 0 Task 7).
4. **1 PR duy nhất** cho cả redesign, mỗi màn hình 1 commit riêng bên trong.

---

## B. Research — mapping màn hình cũ → thiết kế mới

| # | Thiết kế mới | File hiện tại | Trạng thái |
|---|---|---|---|
| Layout | Header ngang, menu 3 nhóm, auto-hide (không chip trạng thái — xem mục A) | `app/layout.tsx`, `app/globals.css:135-182` | Viết lại hoàn toàn thành client component mới |
| Token | Cam #C2410C, nền #F6F7F9, bo 14px, Be Vietnam Pro | `app/globals.css:1-68` (hiện xanh dương #1e40af, Fira Sans) | Đổi giá trị token, giữ tên biến |
| Mọi bảng | Sticky thead theo header, pageSize chọn được | `app/globals.css:223-242` (đã sticky top:0 sẵn), `app/dashboard/Pagination.tsx` (PAGE_SIZE=100 cố định) | Sửa offset + thêm pageSize param |
| 3. Báo cáo đối soát | 5 thẻ lọc nhanh, gộp cột, popup thay nút Sửa | `app/dashboard/report/page.tsx` (25 cột, nút Sửa), `RowEditor.tsx` (đã đúng field, chỉ đổi trigger mở) | Giữ nguyên `loadReportRows`/`RowEditor` logic, đổi JSX bảng + cách mở popup |
| 4. Đơn hàng | Gộp đơn nhiều SP, ô tìm kiếm | `app/dashboard/orders/page.tsx` (chưa có search, mỗi dòng 1 SP) | Thêm search (theo mẫu Report), gộp nhóm theo `shopeeOrderId` ở tầng JSX |
| 5. Đơn hoàn huỷ | Tab + đếm, gộp cột, dòng mở rộng | `app/dashboard/hoan-huy/page.tsx` (22 cột phẳng, filter dropdown) | Giữ `loadCancellationRows`, đổi filter thành tab, thêm expand row |
| 6. Đóng đơn | Card nhóm Zalo + thủ công cạnh nhau, thanh tỷ lệ | `app/dashboard/dong-don/page.tsx`, `ZaloGroupPicker.tsx` (đã đúng, chỉ cần đặt cạnh nhau), `ManualConfirmForm.tsx` (chưa có tab Dán link/Tải file — đã có cả 2 input cùng lúc) | Layout lại 2 card, thêm tab cho ManualConfirmForm |
| 7. Nhận đơn huỷ | 2 cột, trạng thái dạng nút, % hỏng mới | `app/dashboard/don-huy/page.tsx`, `BarcodeScanForm.tsx` (chưa có field % hỏng) | Layout 2 cột, thêm field defectRate (Phase 0 Task 7 làm phần API trước) |
| 8. Đối soát TT | 2 tab, thẻ đếm bấm để lọc | `app/dashboard/reconciliation/page.tsx` (đã có 2 phần nhưng là 2 section xếp dọc, không phải tab) | Bọc 2 phần hiện có vào tab, filter pill đã có sẵn |

Component dùng lại nguyên vẹn, không đổi logic: `FilterDropdown.tsx`, `Pagination.tsx` (mở rộng, không viết lại), `ZaloGroupPicker.tsx`, `ZaloWatchForm.tsx`, `RowEditor.tsx` (business logic), `UploadForm.tsx`.

---

## Phase 0: Hạ tầng dùng chung

Phải xong Phase 0 trước khi đụng vào bất kỳ màn hình nào — mọi màn hình đều phụ thuộc token mới + header mới + sticky thead offset.

### Task 1: Design tokens mới

**Files:**
- Modify: `app/globals.css:1-68`

**Interfaces:**
- Produces: giữ nguyên tên mọi biến `--color-*`, `--radius-*` hiện có; thêm mới `--color-info` / `--color-info-bg` (chưa có slot cho badge xanh dương), `--color-warning-foreground` (tách khỏi `--color-accent` vì `--color-accent` sắp đổi thành màu cam primary — nếu không tách, badge vàng sẽ bị lên màu cam primary thay vì #8A4B00).

- [ ] **Step 1: Đổi giá trị token (light mode)**

```css
:root {
  --color-primary: #C2410C;
  --color-on-primary: #ffffff;
  --color-secondary: #9A3412; /* hover của primary */
  --color-accent: #C2410C;
  --color-on-accent: #ffffff;
  --color-background: #F6F7F9;
  --color-foreground: #0f172a;
  --color-heading: #1f2937;
  --color-card: #ffffff;
  --color-muted: #F6F7F9;
  --color-muted-foreground: #4B5260;
  --color-border: #E6E8EC;
  --color-destructive: #A8231A;
  --color-on-destructive: #ffffff;
  --color-success: #14692F;
  --color-success-bg: #E8F6EE;
  --color-danger-bg: #FDECEA;
  --color-warning-bg: #FFF4DB;
  --color-warning-foreground: #8A4B00;
  --color-info: #1D4FB8;
  --color-info-bg: #EAF1FF;
  --color-neutral-bg: #F2F3F5;
  --color-ring: #C2410C;

  --radius-lg: 14px;
  /* --radius-sm, --radius-md, --space-*, --shadow-*, --transition giữ nguyên */
}
```

- [ ] **Step 2: Sửa `.badge-warning` dùng token mới thay vì `--color-accent`**

```css
.badge-warning {
  background: var(--color-warning-bg);
  color: var(--color-warning-foreground);
}

.badge-info {
  background: var(--color-info-bg);
  color: var(--color-info);
}
```

- [ ] **Step 3: Đổi dark-mode block tương ứng (giữ nguyên độ tối hiện tại, chỉ đổi hue sang cam cho primary/accent/ring)** — không có trong thiết kế (canvas chỉ có light mode), giữ nguyên logic tối hiện tại, chỉ đổi primary/accent/ring sang cam sáng hơn (`#fb923c`) để đủ tương phản nền tối. Thêm `--color-info`/`--color-info-bg`/`--color-warning-foreground` bản tối tương ứng.

- [ ] **Step 4: Chạy build, xem bằng mắt**

```bash
npm run build
```
Mở `/dashboard/orders`, `/dashboard/report` trong Browser pane, xác nhận nút/badge/card đổi màu cam, nền xám nhạt mới, bo góc 14px — chưa đổi JSX gì nên layout y nguyên, chỉ đổi màu.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css
git commit -m "style: swap design tokens to redesign palette (orange primary, new info/warning tokens)"
```

### Task 2: Đổi font sang Be Vietnam Pro

**Files:**
- Modify: `app/layout.tsx:1-17`

- [ ] **Step 1: Đổi import font**

```tsx
import { Be_Vietnam_Pro, Fira_Code } from "next/font/google";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-sans", // giữ tên biến cũ để globals.css không phải đổi
  display: "swap",
});
```
Giữ nguyên `firaCode` cho `--font-mono` (dùng cho cột số `.num`) — thiết kế không nhắc tới font số riêng.

- [ ] **Step 2: Build, xem chữ đổi font trên trang bất kỳ**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "style: switch body font to Be Vietnam Pro"
```

### Task 3: `AppHeader` — header mới, auto-hide khi cuộn

Không còn chip trạng thái (xem mục A.1) — header chỉ còn logo + nav 3 nhóm + auto-hide.

**Files:**
- Create: `app/dashboard/AppHeader.tsx` ("use client")
- Modify: `app/layout.tsx` (render `<AppHeader>` thay nav cũ — vẫn là server component bình thường, không cần fetch gì thêm)
- Modify: `app/globals.css` (thay toàn bộ block `.app-header`/`.app-header-inner`/`.app-brand`/`.app-nav`/`.nav-link` ở dòng 135-182)

**Interfaces:**
- Produces: `<AppHeader />` (không nhận props), export `NAV_GROUPS` const (3 nhóm link đúng thứ tự spec) nội bộ trong file.

- [ ] **Step 1: Viết `AppHeader.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const NAV_GROUPS: { href: string; label: string }[][] = [
  [
    { href: "/dashboard/report", label: "Báo cáo đối soát" },
    { href: "/dashboard/orders", label: "Đơn hàng" },
    { href: "/dashboard/hoan-huy", label: "Đơn hoàn huỷ" },
  ],
  [
    { href: "/dashboard/dong-don", label: "Đóng đơn" },
    { href: "/dashboard/don-huy", label: "Nhận đơn huỷ" },
  ],
  [{ href: "/dashboard/reconciliation", label: "Đối soát thanh toán" }],
];

export function AppHeader() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      const goingDown = y > lastScrollY.current;
      setHidden(goingDown && y > 60);
      lastScrollY.current = y;
      document.documentElement.style.setProperty("--header-offset", goingDown && y > 60 ? "0px" : "60px");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`app-header${hidden ? " app-header-hidden" : ""}`}>
      <div className="app-header-inner">
        <span className="app-brand">Shopee Dropship</span>
        <nav className="app-nav">
          {NAV_GROUPS.map((group, i) => (
            <span className="app-nav-group" key={i}>
              {group.map((item) => (
                <Link
                  key={item.href}
                  className={`nav-link${pathname === item.href ? " active" : ""}`}
                  href={item.href}
                >
                  {item.label}
                </Link>
              ))}
            </span>
          ))}
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Sửa `app/layout.tsx` — bỏ nav cũ, render `<AppHeader />`**

```tsx
import { Be_Vietnam_Pro, Fira_Code } from "next/font/google";
import "./globals.css";
import { AppHeader } from "./dashboard/AppHeader";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-fira-code",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${firaCode.variable}`}>
      <body>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
```
Layout vẫn không-async như hiện tại — bỏ chip trạng thái nghĩa là không cần fetch DB ở layout nữa.

- [ ] **Step 3: CSS — thay block header cũ (`app/globals.css:135-182`)**

```css
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 60px;
  background: var(--color-card);
  border-bottom: 1px solid var(--color-border);
  box-shadow: var(--shadow-sm);
  transition: transform var(--transition);
}

.app-header-hidden {
  transform: translateY(-100%);
}

.app-header-inner {
  height: 60px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: var(--space-5);
}

.app-brand {
  font-weight: 700;
  color: var(--color-heading);
  font-size: 15px;
  white-space: nowrap;
}

.app-nav {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex: 1;
}

.app-nav-group {
  display: flex;
  gap: var(--space-1);
  padding-right: var(--space-4);
  border-right: 1px solid var(--color-border);
}

.app-nav-group:last-child {
  border-right: none;
}

.nav-link {
  color: var(--color-muted-foreground);
  font-weight: 500;
  font-size: 14px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  transition: background var(--transition), color var(--transition);
  cursor: pointer;
}

.nav-link:hover {
  background: var(--color-muted);
  color: var(--color-primary);
  text-decoration: none;
}

.nav-link.active {
  color: var(--color-primary);
  text-decoration: underline;
  text-decoration-color: var(--color-primary);
  text-underline-offset: 4px;
}

```

- [ ] **Step 4: Bỏ `max-width: 1280px` khỏi `.page` (dòng 186-190), đổi padding**

```css
.page {
  margin: 0 auto;
  padding: 20px 24px;
}
```

- [ ] **Step 5: Build + browser verify**

```bash
npm run build
```
Mở bất kỳ trang dashboard nào, cuộn xuống → header ẩn; cuộn lên → header hiện lại; active link hiện cam + gạch chân đúng trang.

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/AppHeader.tsx app/layout.tsx app/globals.css
git commit -m "feat: new sticky auto-hide header, 3-group nav"
```

### Task 4: Sticky thead bám theo trạng thái header

**Files:**
- Modify: `app/globals.css:223-242` (`.data-table thead th`)

- [ ] **Step 1: Đổi `top: 0` thành biến CSS do `AppHeader` set (Task 3 Step 1 đã set `--header-offset` trên `documentElement`)**

```css
.data-table thead th {
  position: sticky;
  top: var(--header-offset, 60px);
  /* phần còn lại giữ nguyên */
}
```

- [ ] **Step 2: Bỏ `overflow-x: auto` trên `.table-wrap` cho desktop, giữ cho mobile**

```css
.table-wrap {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-card);
  box-shadow: var(--shadow-sm);
  margin-bottom: var(--space-4);
  overflow: clip;
}

@media (max-width: 768px) {
  .table-wrap {
    overflow-x: auto;
  }
}
```

- [ ] **Step 3: Build + browser verify** — cuộn trang có bảng dài, xác nhận header cột dính đúng vị trí kể cả khi app-header ẩn/hiện.

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "style: sticky table header tracks app header's show/hide offset"
```

### Task 5: Filter "Chưa Luân check" (Report)

**Files:**
- Modify: `lib/report/filters.ts` (thêm field `luanCheck: boolean`, parse, `buildOrderWhere`)
- Test: `tests/report/filters.test.ts`

**Interfaces:**
- Produces: `ReportFilters.luanCheck: boolean`; `buildOrderWhere` thêm `AND: [{ luanCheck: false }]` khi `filters.luanCheck === true`.

- [ ] **Step 1: Viết test**

```ts
it("filters to only rows Luân hasn't checked when luanCheck=true", () => {
  const where = buildOrderWhere(parseReportFilters({ luanCheck: "true" }));
  expect(where.AND).toContainEqual({ luanCheck: false });
});

it("doesn't filter by luanCheck when absent", () => {
  const where = buildOrderWhere(parseReportFilters({}));
  expect(where.AND ?? []).not.toContainEqual({ luanCheck: false });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

```bash
npx vitest run tests/report/filters.test.ts
```

- [ ] **Step 3: Thêm field vào `ReportFilters`, `parseReportFilters`, `buildOrderWhere`**

```ts
// Trong interface ReportFilters, thêm:
luanCheck: boolean;

// Trong parseReportFilters, thêm:
luanCheck: str(raw, "luanCheck") === "true",

// Trong buildOrderWhere, nối thêm vào mảng AND hiện có:
if (filters.luanCheck) {
  andClauses.push({ luanCheck: false });
}
```
(Xem code hiện tại quanh `buildOrderWhere` để nối đúng vào mảng `andClauses` đã có sẵn cho `sendStatus`/`cancelReceiptStatus` — không tạo biến `AND` mới đè lên.)

- [ ] **Step 4: Chạy test lại, xác nhận pass + chạy full suite đảm bảo không vỡ gì**

```bash
npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git add lib/report/filters.ts tests/report/filters.test.ts
git commit -m "feat: add luanCheck quick-filter to Report page"
```

### Task 6: `pageSize` chọn được (20/50/100)

**Files:**
- Modify: `app/dashboard/Pagination.tsx`
- Test: `tests/dashboard/pagination.test.ts` (mới)
- Modify (dùng `pageSize` mới thay vì hằng số): `app/dashboard/report/page.tsx`, `app/dashboard/orders/page.tsx`, `app/dashboard/hoan-huy/page.tsx`, `app/dashboard/reconciliation/page.tsx` (2 chỗ: batch + paymentBatch)

**Interfaces:**
- Produces: `DEFAULT_PAGE_SIZE = 20`, `PAGE_SIZE_OPTIONS = [20, 50, 100]`, `parsePageSize(raw: string | undefined): number`, `totalPagesFor(totalCount: number, pageSize: number): number` (đổi signature — thêm tham số bắt buộc), `<Pagination page totalPages buildHref pageSize onPageSizeHref />` (prop mới: `onPageSizeHref: (size: number) => string`).

- [ ] **Step 1: Viết test cho `parsePageSize`**

```ts
import { describe, it, expect } from "vitest";
import { parsePageSize, totalPagesFor, DEFAULT_PAGE_SIZE } from "@/app/dashboard/Pagination";

describe("parsePageSize", () => {
  it("defaults to 20 when absent", () => {
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });
  it("accepts 50 and 100", () => {
    expect(parsePageSize("50")).toBe(50);
    expect(parsePageSize("100")).toBe(100);
  });
  it("falls back to default for anything else", () => {
    expect(parsePageSize("7")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("totalPagesFor with explicit pageSize", () => {
  it("computes pages for the given size", () => {
    expect(totalPagesFor(45, 20)).toBe(3);
    expect(totalPagesFor(45, 50)).toBe(1);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail** (file test mới + signature đổi → lỗi biên dịch)

```bash
npx vitest run tests/dashboard/pagination.test.ts
```

- [ ] **Step 3: Sửa `Pagination.tsx`**

```ts
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export function parsePageSize(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

export function parsePage(raw: string | undefined): number {
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function totalPagesFor(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

export function Pagination({
  page,
  totalPages,
  buildHref,
  pageSize,
  onPageSizeHref,
  totalCount,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
  pageSize: number;
  onPageSizeHref: (size: number) => string;
  totalCount: number;
}) {
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  return (
    <div className="pagination">
      {page > 1 ? <a href={buildHref(page - 1)}>« Trước</a> : <span className="disabled">« Trước</span>}
      <span className="pagination-status">
        {from}–{to} / {totalCount} đơn · Trang {page} / {totalPages}
      </span>
      {page < totalPages ? <a href={buildHref(page + 1)}>Sau »</a> : <span className="disabled">Sau »</span>}
      <select
        className="select"
        value={pageSize}
        onChange={(e) => {
          window.location.href = onPageSizeHref(Number(e.target.value));
        }}
      >
        {PAGE_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}/trang
          </option>
        ))}
      </select>
    </div>
  );
}
```
`Pagination` đổi từ server-renderable thuần sang cần `onChange` (client-only) — thêm `"use client"` ở đầu file.

- [ ] **Step 4: Sửa 4 trang gọi `PAGE_SIZE`/`totalPagesFor` theo signature mới** (ví dụ `report/page.tsx`; lặp lại tương tự cho 3 trang còn lại trong Task 6, KHÔNG phải Phase 1-7 — đây vẫn là hạ tầng dùng chung):

```ts
const pageSize = parsePageSize(Array.isArray(searchParams.pageSize) ? searchParams.pageSize[0] : searchParams.pageSize);
const totalPages = totalPagesFor(allRows.length, pageSize);
const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
// buildHref và onPageSizeHref đều phải giữ pageSize/các filter khác trong query string
```

- [ ] **Step 5: Chạy test lại + full suite + build**

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/Pagination.tsx tests/dashboard/pagination.test.ts app/dashboard/report/page.tsx app/dashboard/orders/page.tsx app/dashboard/hoan-huy/page.tsx app/dashboard/reconciliation/page.tsx
git commit -m "feat: selectable page size (20/50/100) across every paginated table"
```

### Task 7: `defectRate` trong Nhận đơn huỷ thủ công

**Files:**
- Modify: `lib/zalo/cancelReceiptPoller.ts` (`ApplyCancelReceiptCodesParams`, `applyCancelReceiptCodes`)
- Modify: `app/api/don-huy/manual-scan/route.ts` (zod schema + truyền tiếp)
- Test: `tests/zalo/cancelReceiptPoller.test.ts`, `tests/api/don-huy-manual-scan.test.ts`

**Interfaces:**
- Produces: `ApplyCancelReceiptCodesParams.defectRate?: number | null` (0–1, giống `Order.defectRate` hiện có); khi set, `updateMany` ghi thêm `defectRate` cùng `cancelReceiptStatus`/`cancelReceivedAt`.

- [ ] **Step 1: Viết test cho `applyCancelReceiptCodes`**

```ts
it("writes defectRate when given", async () => {
  await prisma.order.create({
    data: { shopeeOrderId: "SP010", categoryName: "D100", status: "Hoàn thành", rawRowHash: "h", sheetRowIndex: 1 },
  });

  await applyCancelReceiptCodes({
    codes: ["SP010"],
    messageContent: "SP010",
    confirmedByName: "Quét mã thủ công",
    confirmedAt: new Date(),
    threadId: "manual-scan",
    cancelReceiptStatus: "received_partial",
    defectRate: 0.05,
  });

  const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP010" } });
  expect(order?.defectRate).toBe(0.05);
});

it("leaves defectRate untouched when not given", async () => {
  await prisma.order.create({
    data: { shopeeOrderId: "SP011", categoryName: "D100", status: "Hoàn thành", rawRowHash: "h", sheetRowIndex: 1, defectRate: 0.2 },
  });

  await applyCancelReceiptCodes({
    codes: ["SP011"],
    messageContent: "SP011",
    confirmedByName: null,
    confirmedAt: new Date(),
    threadId: "group-1",
  });

  const order = await prisma.order.findFirst({ where: { shopeeOrderId: "SP011" } });
  expect(order?.defectRate).toBe(0.2);
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

```bash
npx vitest run tests/zalo/cancelReceiptPoller.test.ts
```

- [ ] **Step 3: Sửa `ApplyCancelReceiptCodesParams` + `applyCancelReceiptCodes`**

```ts
export interface ApplyCancelReceiptCodesParams {
  codes: string[];
  messageContent: string;
  confirmedByName: string | null;
  confirmedAt: Date;
  threadId: string;
  cancelReceiptStatus?: CancelReceiptStatus;
  defectRate?: number | null;
}

// Trong applyCancelReceiptCodes, destructure thêm defectRate, và:
const result = await prisma.order.updateMany({
  where: { /* giữ nguyên */ },
  data: {
    cancelReceiptStatus,
    cancelReceivedAt: confirmedAt,
    ...(defectRate !== undefined ? { defectRate } : {}),
  },
});
```

- [ ] **Step 4: Sửa zod schema + truyền tiếp trong `/api/don-huy/manual-scan/route.ts`**

```ts
const scanSchema = z.object({
  codes: z.array(z.string().min(1)).min(1),
  confirmedAt: z.string().datetime(),
  cancelReceiptStatus: z.nativeEnum(CancelReceiptStatus),
  defectRate: z.number().min(0).max(1).nullable().optional(),
});

// Truyền tiếp vào applyCancelReceiptCodes:
const { matchedCount } = await applyCancelReceiptCodes({
  codes,
  messageContent: codes.join(", "),
  confirmedByName: "Quét mã thủ công",
  confirmedAt,
  threadId: MANUAL_SCAN_THREAD_ID,
  cancelReceiptStatus: parsed.data.cancelReceiptStatus,
  defectRate: parsed.data.defectRate,
});
```

- [ ] **Step 5: Thêm test cho route tương tự, chạy lại toàn bộ + build**

```bash
npx vitest run
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add lib/zalo/cancelReceiptPoller.ts app/api/don-huy/manual-scan/route.ts tests/zalo/cancelReceiptPoller.test.ts tests/api/don-huy-manual-scan.test.ts
git commit -m "feat: accept defectRate in manual cancel-receipt scan/confirm"
```

---

## Phase 1–7: từng màn hình

Sau khi Phase 0 xong và lên `ui-redesign`, mỗi màn hình dưới đây **viết plan bite-sized riêng ngay trước khi làm** (đúng tinh thần "làm từng màn hình một" bạn yêu cầu) — vì đây thuần là sắp xếp lại JSX/CSS theo đúng data đã có sẵn từ `loadReportRows`/`loadCancellationRows`/v.v., không phải logic mới, nên rủi ro chính là UI chứ không phải thuật toán; tôi sẽ đưa bản xem trước (mô tả + browser screenshot) cho từng màn hình để bạn duyệt trước khi qua màn tiếp theo, thay vì viết trước cả nghìn dòng JSX chưa chắc đúng ý. Thứ tự đề xuất, theo đúng mức độ dùng nhiều nhất trước:

1. **Báo cáo đối soát** (`/dashboard/report`) — 5 thẻ lọc nhanh, gộp 12 cột, popup "Cập nhật đơn" thay nút Sửa.
2. **Đơn hàng** (`/dashboard/orders`) — thêm search, gộp dòng nhiều sản phẩm.
3. **Đơn hoàn huỷ** (`/dashboard/hoan-huy`) — tab thay dropdown, gộp cột + dòng mở rộng.
4. **Đóng đơn** (`/dashboard/dong-don`) — 2 card cạnh nhau, tab trong form thủ công, thanh tỷ lệ khớp.
5. **Nhận đơn huỷ** (`/dashboard/don-huy`) — layout 2 cột, trạng thái dạng nút, field % hỏng (API đã xong ở Task 7).
6. **Đối soát thanh toán** (`/dashboard/reconciliation`) — bọc 2 section hiện có vào 2 tab.
7. **Mobile Đơn huỷ** — xem lại artboard `DonHuyMobile.dc.html` khi đến màn 5, áp dụng qua `@media` chung 1 file thay vì trang riêng (Next.js route hiện tại không tách desktop/mobile).

Mỗi màn hình commit riêng, chạy `npx vitest run` + `npx tsc --noEmit` trước khi qua màn tiếp theo.

---

## Git / PR

```bash
git checkout -b ui-redesign
# ... Phase 0 + Phase 1-7, mỗi bước 1 commit như trên ...
git push -u origin ui-redesign
gh pr create --title "Redesign UI theo canvas Dropship Shopee" --body "..."
```
1 PR duy nhất, tạo sau khi xong hết Phase 0 + Phase 1–7.

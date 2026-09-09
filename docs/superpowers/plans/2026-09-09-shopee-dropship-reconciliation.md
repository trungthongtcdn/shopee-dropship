# Shopee Dropship Order Sync & Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Shopee's Google Sheet (orders/cancellations/products) into a Postgres-backed Next.js app via polling Apps Script, and let the user upload Shopee's periodic Excel settlement file to reconcile it against the mirrored data.

**Architecture:** Apps Script bound to Shopee's Sheet polls every 10 minutes, hashes each row, and POSTs the full payload to a Next.js webhook. The webhook diffs against stored hashes (insert/update/soft-delete) and writes an audit log. A separate upload endpoint parses an uploaded Excel file and matches it against mirrored orders by `shopeeOrderId`, producing per-row match results.

**Tech Stack:** Next.js (App Router, TypeScript) + Prisma + Postgres (Neon/Supabase) + Vercel. `xlsx` for Excel parsing, `zod` for payload validation, Vitest for tests.

## Global Constraints

- Soft-delete only for `orders`/`cancellations`/`products` — never hard-delete a mirrored row (spec section: xoá dòng khỏi Sheet).
- Polling interval: every 10 minutes (within the approved 5–15 minute range).
- Sync auth: header `X-Sync-Secret`, static token compared against `SYNC_WEBHOOK_SECRET` env var.
- Row hash: SHA-256 over full row content, computed in Apps Script, compared as opaque strings in the backend (backend never recomputes it).
- Excel column mapping is header-name based (not positional) — real Shopee settlement file structure is unknown until a real file is seen.
- Reconciliation matches by `shopeeOrderId` against **all** orders regardless of `isActive` (a soft-deleted order can still appear in a settlement file).
- No automated UI/e2e tests and no alerting system — explicitly deferred per spec (YAGNI).
- **Open assumption:** actual column headers in Shopee's real Sheet tabs are unverified (user has not yet inspected the live sheet schema). Task 6 assumes English snake_case headers (`shopee_order_id`, `sku`, `product_name`, `quantity`, `unit_price`, `total_amount`, `status` for Orders; `shopee_order_id`, `reason`, `cancelled_at` for Cancellations; `sku`, `product_name`, `price` for Products) and tab names `Orders`/`Cancellations`/`Products`. When the real sheet is inspected, update `TABS` in Task 6 and the `mapOrderRow`/`mapCancellationRow`/`mapProductRow` functions in Task 4 to match actual headers/tab names.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `docker-compose.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a working Next.js dev server, a local Postgres reachable at `DATABASE_URL` for later tasks.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "shopee-reconciliation",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "@prisma/client": "^5.18.0",
    "zod": "^3.23.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "prisma": "^5.18.0",
    "vitest": "^2.0.0",
    "tsx": "^4.16.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

- [ ] **Step 4: Write `app/layout.tsx` and `app/page.tsx`**

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// app/page.tsx
export default function HomePage() {
  return (
    <main>
      <h1>Shopee Dropship Reconciliation</h1>
      <ul>
        <li><a href="/dashboard/orders">Orders</a></li>
        <li><a href="/dashboard/reconciliation">Reconciliation</a></li>
      </ul>
    </main>
  );
}
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 6: Write `.env.example` and `docker-compose.yml`**

```
# .env.example
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/shopee_reconciliation"
SYNC_WEBHOOK_SECRET="change-me"
```

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: shopee_reconciliation
    ports:
      - "5432:5432"
```

- [ ] **Step 7: Update `.gitignore`**

```
.vercel
.env*
node_modules
.next
```

- [ ] **Step 8: Install dependencies and verify dev server boots**

Run:
```bash
npm install
cp .env.example .env
docker compose up -d postgres
npm run dev
```
Expected: server starts on `http://localhost:3000`; `curl -s http://localhost:3000 | grep "Shopee Dropship"` returns a match. Stop the dev server after verifying (Ctrl+C).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json next.config.mjs app vitest.config.ts .env.example docker-compose.yml .gitignore
git commit -m "chore: scaffold Next.js app with local Postgres"
```

---

### Task 2: Database schema & Prisma client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` from `.env` (Task 1).
- Produces: `prisma` client export from `lib/db.ts`, used by every later task that touches the database. Prisma models: `Order`, `Cancellation`, `Product`, `SyncLog`, `ReconciliationBatch`, `ReconciliationResult`.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Order {
  id            Int       @id @default(autoincrement())
  shopeeOrderId String    @unique @map("shopee_order_id")
  sku           String
  productName   String    @map("product_name")
  quantity      Int
  unitPrice     Float     @map("unit_price")
  totalAmount   Float     @map("total_amount")
  status        String
  rawRowHash    String    @map("raw_row_hash")
  sheetRowIndex Int       @map("sheet_row_index")
  isActive      Boolean   @default(true) @map("is_active")
  deletedAt     DateTime? @map("deleted_at")
  firstSyncedAt DateTime  @default(now()) @map("first_synced_at")
  lastSyncedAt  DateTime  @updatedAt @map("last_synced_at")

  @@map("orders")
}

model Cancellation {
  id            Int       @id @default(autoincrement())
  shopeeOrderId String    @map("shopee_order_id")
  reason        String
  cancelledAt   DateTime  @map("cancelled_at")
  rawRowHash    String    @map("raw_row_hash")
  sheetRowIndex Int       @map("sheet_row_index")
  isActive      Boolean   @default(true) @map("is_active")
  deletedAt     DateTime? @map("deleted_at")
  firstSyncedAt DateTime  @default(now()) @map("first_synced_at")
  lastSyncedAt  DateTime  @updatedAt @map("last_synced_at")

  @@map("cancellations")
}

model Product {
  id            Int       @id @default(autoincrement())
  sku           String    @unique
  productName   String    @map("product_name")
  price         Float
  rawRowHash    String    @map("raw_row_hash")
  sheetRowIndex Int       @map("sheet_row_index")
  isActive      Boolean   @default(true) @map("is_active")
  deletedAt     DateTime? @map("deleted_at")
  firstSyncedAt DateTime  @default(now()) @map("first_synced_at")
  lastSyncedAt  DateTime  @updatedAt @map("last_synced_at")

  @@map("products")
}

enum SourceTab {
  orders
  cancellations
  products
}

enum ChangeType {
  insert
  update
  delete
}

model SyncLog {
  id            Int        @id @default(autoincrement())
  sourceTab     SourceTab  @map("source_tab")
  sheetRowIndex Int        @map("sheet_row_index")
  changeType    ChangeType @map("change_type")
  oldValue      Json?      @map("old_value")
  newValue      Json?      @map("new_value")
  syncedAt      DateTime   @default(now()) @map("synced_at")

  @@map("sync_log")
}

enum BatchStatus {
  processing
  done
  error
}

model ReconciliationBatch {
  id          Int                    @id @default(autoincrement())
  fileName    String                 @map("file_name")
  uploadedAt  DateTime               @default(now()) @map("uploaded_at")
  periodLabel String?                @map("period_label")
  status      BatchStatus            @default(processing)
  results     ReconciliationResult[]

  @@map("reconciliation_batches")
}

enum MatchStatus {
  matched
  missing_in_sheet
  missing_in_excel
  amount_mismatch
  status_mismatch
  parse_error
}

model ReconciliationResult {
  id            Int                  @id @default(autoincrement())
  batchId       Int                  @map("batch_id")
  batch         ReconciliationBatch  @relation(fields: [batchId], references: [id])
  shopeeOrderId String?              @map("shopee_order_id")
  matchStatus   MatchStatus          @map("match_status")
  sheetAmount   Float?               @map("sheet_amount")
  excelAmount   Float?               @map("excel_amount")
  diffDetail    Json?                @map("diff_detail")

  @@map("reconciliation_results")
}
```

- [ ] **Step 2: Run migration**

Run:
```bash
npx prisma migrate dev --name init
```
Expected: migration created under `prisma/migrations/`, applied to local Postgres, Prisma Client generated with no errors.

- [ ] **Step 3: Write `lib/db.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 4: Write `tests/schema.test.ts`**

```typescript
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("prisma schema", () => {
  it("connects and reads empty tables", async () => {
    await expect(prisma.order.count()).resolves.toBe(0);
    await expect(prisma.cancellation.count()).resolves.toBe(0);
    await expect(prisma.product.count()).resolves.toBe(0);
    await expect(prisma.syncLog.count()).resolves.toBe(0);
    await expect(prisma.reconciliationBatch.count()).resolves.toBe(0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS (requires `docker compose up -d postgres` running).

- [ ] **Step 6: Commit**

```bash
git add prisma lib/db.ts tests/schema.test.ts
git commit -m "feat: add Prisma schema and database client"
```

---

### Task 3: Sync diff logic (pure function)

**Files:**
- Create: `lib/sync/types.ts`
- Create: `lib/sync/diff.ts`
- Test: `tests/sync/diff.test.ts`

**Interfaces:**
- Produces: `computeSyncDiff(existing: ExistingRow[], incoming: IncomingRow[]): SyncDiff`, and types `IncomingRow`, `ExistingRow`, `SyncDiff`, `SyncTab` — consumed by Task 4 and Task 5.

- [ ] **Step 1: Write `lib/sync/types.ts`**

```typescript
export type SyncTab = "orders" | "cancellations" | "products";

export interface IncomingRow {
  rowIndex: number;
  hash: string;
  data: Record<string, string | number>;
}

export interface ExistingRow {
  rowIndex: number;
  hash: string;
}

export interface SyncDiff {
  inserts: IncomingRow[];
  updates: IncomingRow[];
  softDeletes: number[];
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/sync/diff.test.ts
import { describe, it, expect } from "vitest";
import { computeSyncDiff } from "@/lib/sync/diff";

describe("computeSyncDiff", () => {
  it("marks a row with no existing match as an insert", () => {
    const diff = computeSyncDiff([], [{ rowIndex: 2, hash: "h1", data: {} }]);
    expect(diff.inserts).toEqual([{ rowIndex: 2, hash: "h1", data: {} }]);
    expect(diff.updates).toEqual([]);
    expect(diff.softDeletes).toEqual([]);
  });

  it("marks a row with a changed hash as an update", () => {
    const diff = computeSyncDiff(
      [{ rowIndex: 2, hash: "old" }],
      [{ rowIndex: 2, hash: "new", data: {} }]
    );
    expect(diff.updates).toEqual([{ rowIndex: 2, hash: "new", data: {} }]);
    expect(diff.inserts).toEqual([]);
  });

  it("skips a row with an unchanged hash", () => {
    const diff = computeSyncDiff(
      [{ rowIndex: 2, hash: "same" }],
      [{ rowIndex: 2, hash: "same", data: {} }]
    );
    expect(diff.inserts).toEqual([]);
    expect(diff.updates).toEqual([]);
    expect(diff.softDeletes).toEqual([]);
  });

  it("marks an existing row missing from incoming as a soft delete", () => {
    const diff = computeSyncDiff([{ rowIndex: 2, hash: "h1" }], []);
    expect(diff.softDeletes).toEqual([2]);
  });

  it("handles a mixed batch correctly", () => {
    const diff = computeSyncDiff(
      [
        { rowIndex: 2, hash: "same" },
        { rowIndex: 3, hash: "old" },
        { rowIndex: 4, hash: "gone" },
      ],
      [
        { rowIndex: 2, hash: "same", data: {} },
        { rowIndex: 3, hash: "new", data: {} },
        { rowIndex: 5, hash: "brand-new", data: {} },
      ]
    );
    expect(diff.inserts).toEqual([{ rowIndex: 5, hash: "brand-new", data: {} }]);
    expect(diff.updates).toEqual([{ rowIndex: 3, hash: "new", data: {} }]);
    expect(diff.softDeletes).toEqual([4]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/sync/diff.test.ts`
Expected: FAIL with "Cannot find module '@/lib/sync/diff'" or similar.

- [ ] **Step 4: Write minimal implementation**

```typescript
// lib/sync/diff.ts
import type { ExistingRow, IncomingRow, SyncDiff } from "@/lib/sync/types";

export function computeSyncDiff(existing: ExistingRow[], incoming: IncomingRow[]): SyncDiff {
  const existingByRowIndex = new Map(existing.map((row) => [row.rowIndex, row.hash]));
  const incomingRowIndexes = new Set(incoming.map((row) => row.rowIndex));

  const inserts: IncomingRow[] = [];
  const updates: IncomingRow[] = [];

  for (const row of incoming) {
    const existingHash = existingByRowIndex.get(row.rowIndex);
    if (existingHash === undefined) {
      inserts.push(row);
    } else if (existingHash !== row.hash) {
      updates.push(row);
    }
  }

  const softDeletes = existing
    .filter((row) => !incomingRowIndexes.has(row.rowIndex))
    .map((row) => row.rowIndex);

  return { inserts, updates, softDeletes };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/sync/diff.test.ts`
Expected: PASS (5/5 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/sync/types.ts lib/sync/diff.ts tests/sync/diff.test.ts
git commit -m "feat: add pure sync diff computation"
```

---

### Task 4: Sync apply-to-database logic

**Files:**
- Create: `lib/sync/apply.ts`
- Test: `tests/sync/apply.test.ts`

**Interfaces:**
- Consumes: `computeSyncDiff`, `IncomingRow`, `SyncTab` (Task 3); `prisma` (Task 2).
- Produces: `applyOrdersPayload(rows: IncomingRow[]): Promise<SyncDiff>`, `applyCancellationsPayload(rows: IncomingRow[]): Promise<SyncDiff>`, `applyProductsPayload(rows: IncomingRow[]): Promise<SyncDiff>` — consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/sync/apply.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { applyOrdersPayload } from "@/lib/sync/apply";

describe("applyOrdersPayload", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("inserts a new row and logs an insert", async () => {
    const diff = await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 2,
          unit_price: 10000,
          total_amount: 20000,
          status: "pending",
        },
      },
    ]);

    expect(diff.inserts).toHaveLength(1);
    const order = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(order?.rawRowHash).toBe("hash-1");
    const log = await prisma.syncLog.findFirst({ where: { changeType: "insert" } });
    expect(log?.sheetRowIndex).toBe(2);
  });

  it("updates a changed row, then soft-deletes it when it disappears", async () => {
    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-1",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 2,
          unit_price: 10000,
          total_amount: 20000,
          status: "pending",
        },
      },
    ]);

    await applyOrdersPayload([
      {
        rowIndex: 2,
        hash: "hash-2",
        data: {
          shopee_order_id: "SP001",
          sku: "SKU1",
          product_name: "Product 1",
          quantity: 3,
          unit_price: 10000,
          total_amount: 30000,
          status: "shipped",
        },
      },
    ]);

    const updated = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(updated?.status).toBe("shipped");
    expect(updated?.isActive).toBe(true);

    await applyOrdersPayload([]);

    const softDeleted = await prisma.order.findUnique({ where: { shopeeOrderId: "SP001" } });
    expect(softDeleted?.isActive).toBe(false);
    expect(softDeleted?.deletedAt).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sync/apply.test.ts`
Expected: FAIL with "Cannot find module '@/lib/sync/apply'".

- [ ] **Step 3: Write implementation**

```typescript
// lib/sync/apply.ts
import { prisma } from "@/lib/db";
import { computeSyncDiff } from "@/lib/sync/diff";
import type { IncomingRow, SyncTab } from "@/lib/sync/types";

interface TabDelegate {
  findMany: (args: unknown) => Promise<{ sheetRowIndex: number; rawRowHash: string }[]>;
  findFirst: (args: unknown) => Promise<{ id: number } & Record<string, unknown>>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
}

async function applyTabPayload(
  tab: SyncTab,
  delegate: TabDelegate,
  mapRow: (row: IncomingRow) => Record<string, unknown>,
  rows: IncomingRow[]
) {
  const existing = await delegate.findMany({
    where: { isActive: true },
    select: { sheetRowIndex: true, rawRowHash: true },
  });

  const diff = computeSyncDiff(
    existing.map((row) => ({ rowIndex: row.sheetRowIndex, hash: row.rawRowHash })),
    rows
  );

  for (const row of diff.inserts) {
    const created = await delegate.create({ data: mapRow(row) });
    await prisma.syncLog.create({
      data: { sourceTab: tab, sheetRowIndex: row.rowIndex, changeType: "insert", newValue: created },
    });
  }

  for (const row of diff.updates) {
    const before = await delegate.findFirst({ where: { sheetRowIndex: row.rowIndex, isActive: true } });
    const updated = await delegate.update({ where: { id: before.id }, data: mapRow(row) });
    await prisma.syncLog.create({
      data: { sourceTab: tab, sheetRowIndex: row.rowIndex, changeType: "update", oldValue: before, newValue: updated },
    });
  }

  for (const rowIndex of diff.softDeletes) {
    const before = await delegate.findFirst({ where: { sheetRowIndex: rowIndex, isActive: true } });
    if (!before) continue;
    await delegate.update({ where: { id: before.id }, data: { isActive: false, deletedAt: new Date() } });
    await prisma.syncLog.create({
      data: { sourceTab: tab, sheetRowIndex: rowIndex, changeType: "delete", oldValue: before },
    });
  }

  return diff;
}

function mapOrderRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(row.data.shopee_order_id),
    sku: String(row.data.sku),
    productName: String(row.data.product_name),
    quantity: Number(row.data.quantity),
    unitPrice: Number(row.data.unit_price),
    totalAmount: Number(row.data.total_amount),
    status: String(row.data.status),
  };
}

function mapCancellationRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    shopeeOrderId: String(row.data.shopee_order_id),
    reason: String(row.data.reason),
    cancelledAt: new Date(String(row.data.cancelled_at)),
  };
}

function mapProductRow(row: IncomingRow) {
  return {
    sheetRowIndex: row.rowIndex,
    rawRowHash: row.hash,
    sku: String(row.data.sku),
    productName: String(row.data.product_name),
    price: Number(row.data.price),
  };
}

export function applyOrdersPayload(rows: IncomingRow[]) {
  return applyTabPayload("orders", prisma.order as unknown as TabDelegate, mapOrderRow, rows);
}

export function applyCancellationsPayload(rows: IncomingRow[]) {
  return applyTabPayload("cancellations", prisma.cancellation as unknown as TabDelegate, mapCancellationRow, rows);
}

export function applyProductsPayload(rows: IncomingRow[]) {
  return applyTabPayload("products", prisma.product as unknown as TabDelegate, mapProductRow, rows);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sync/apply.test.ts`
Expected: PASS (requires local Postgres running).

- [ ] **Step 5: Commit**

```bash
git add lib/sync/apply.ts tests/sync/apply.test.ts
git commit -m "feat: apply sync diff to orders/cancellations/products tables"
```

---

### Task 5: Sync webhook API endpoint

**Files:**
- Create: `lib/sync/validatePayload.ts`
- Create: `app/api/sync/webhook/route.ts`
- Test: `tests/api/sync-webhook.test.ts`

**Interfaces:**
- Consumes: `applyOrdersPayload`/`applyCancellationsPayload`/`applyProductsPayload` (Task 4); `SYNC_WEBHOOK_SECRET` env var.
- Produces: `POST /api/sync/webhook` HTTP endpoint — consumed by Apps Script (Task 6).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/sync-webhook.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/sync/webhook/route";
import { prisma } from "@/lib/db";

process.env.SYNC_WEBHOOK_SECRET = "test-secret";

function makeRequest(body: unknown, secret = "test-secret") {
  return new NextRequest("http://localhost/api/sync/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sync/webhook", () => {
  beforeEach(async () => {
    await prisma.syncLog.deleteMany();
    await prisma.order.deleteMany();
  });

  it("rejects a wrong secret", async () => {
    const response = await POST(makeRequest({ tab: "orders", rows: [] }, "wrong"));
    expect(response.status).toBe(401);
  });

  it("applies valid rows and reports invalid rows separately", async () => {
    const response = await POST(
      makeRequest({
        tab: "orders",
        rows: [
          {
            rowIndex: 2,
            hash: "h1",
            data: {
              shopee_order_id: "SP001",
              sku: "SKU1",
              product_name: "P1",
              quantity: 1,
              unit_price: 1000,
              total_amount: 1000,
              status: "pending",
            },
          },
          { rowIndex: 3, hash: "h2" },
        ],
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.inserted).toBe(1);
    expect(json.rowErrors).toHaveLength(1);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/sync-webhook.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/sync/webhook/route'".

- [ ] **Step 3: Write `lib/sync/validatePayload.ts`**

```typescript
import { z } from "zod";

export const incomingRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  hash: z.string().min(1),
  data: z.record(z.union([z.string(), z.number()])),
});

export const syncPayloadSchema = z.object({
  tab: z.enum(["orders", "cancellations", "products"]),
  rows: z.array(z.unknown()),
});

export function parseIncomingRows(rawRows: unknown[]) {
  const validRows: z.infer<typeof incomingRowSchema>[] = [];
  const errors: { index: number; issue: string }[] = [];

  rawRows.forEach((raw, index) => {
    const result = incomingRowSchema.safeParse(raw);
    if (result.success) {
      validRows.push(result.data);
    } else {
      errors.push({ index, issue: result.error.issues[0]?.message ?? "invalid row" });
    }
  });

  return { validRows, errors };
}
```

- [ ] **Step 4: Write `app/api/sync/webhook/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncPayloadSchema, parseIncomingRows } from "@/lib/sync/validatePayload";
import { applyOrdersPayload, applyCancellationsPayload, applyProductsPayload } from "@/lib/sync/apply";

const APPLY_BY_TAB = {
  orders: applyOrdersPayload,
  cancellations: applyCancellationsPayload,
  products: applyProductsPayload,
} as const;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-sync-secret");
  if (secret !== process.env.SYNC_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsedBody = syncPayloadSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const { tab, rows } = parsedBody.data;
  const { validRows, errors } = parseIncomingRows(rows);

  const diff = await APPLY_BY_TAB[tab](validRows);

  return NextResponse.json({
    inserted: diff.inserts.length,
    updated: diff.updates.length,
    softDeleted: diff.softDeletes.length,
    rowErrors: errors,
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/api/sync-webhook.test.ts`
Expected: PASS (2/2 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/sync/validatePayload.ts app/api/sync/webhook/route.ts tests/api/sync-webhook.test.ts
git commit -m "feat: add sync webhook endpoint"
```

---

### Task 6: Google Apps Script sync source

**Files:**
- Create: `google-apps-script/Sync.gs`
- Create: `google-apps-script/README.md`

**Interfaces:**
- Consumes: `POST /api/sync/webhook` (Task 5) — payload shape `{ tab, rows: [{ rowIndex, hash, data }] }`, header `X-Sync-Secret`.
- Produces: none consumed by later tasks (this is the source-side integration; no automated test per spec's testing approach — verified manually).

- [ ] **Step 1: Write `google-apps-script/Sync.gs`**

```javascript
var TABS = [
  { name: "orders", sheetName: "Orders" },
  { name: "cancellations", sheetName: "Cancellations" },
  { name: "products", sheetName: "Products" },
];

var BATCH_SIZE = 200;

function computeRowHash(values) {
  var raw = values.join("|");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest
    .map(function (byte) {
      var v = (byte + 256) % 256;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}

function readTabRows(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2) return [];

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  return values.map(function (rowValues, i) {
    var data = {};
    headers.forEach(function (header, colIndex) {
      data[header] = rowValues[colIndex];
    });
    return { rowIndex: i + 2, hash: computeRowHash(rowValues), data: data };
  });
}

function pushPayload(tab, rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": secret },
    payload: JSON.stringify({ tab: tab, rows: rows }),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  props.setProperty("last_error", "push failed for tab " + tab);
  props.setProperty("last_error_at", new Date().toISOString());
  return null;
}

function syncAllTabs() {
  TABS.forEach(function (tab) {
    var rows = readTabRows(tab.sheetName);
    for (var i = 0; i < rows.length; i += BATCH_SIZE) {
      pushPayload(tab.name, rows.slice(i, i + BATCH_SIZE));
    }
  });
}

function manualTestSync() {
  var rows = readTabRows("Orders");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createTimeTrigger() {
  ScriptApp.newTrigger("syncAllTabs").timeBased().everyMinutes(10).create();
}
```

- [ ] **Step 2: Write `google-apps-script/README.md`**

```markdown
# Apps Script deployment

1. Open the Shopee-owned Google Sheet, then Extensions > Apps Script.
2. Paste the contents of `Sync.gs` into the script editor.
3. Project Settings > Script Properties, add:
   - `SYNC_WEBHOOK_URL` = `https://<your-vercel-domain>/api/sync/webhook`
   - `SYNC_SECRET` = same value as `SYNC_WEBHOOK_SECRET` in the app's `.env`
4. Run `manualTestSync` once from the editor toolbar, grant permissions when prompted, check the execution log (View > Logs).
5. Run `syncAllTabs` once manually, confirm rows appear in the app's database.
6. Run `createTimeTrigger` once to install the 10-minute polling trigger.
```

- [ ] **Step 3: Manual verification**

On a **test copy** of the Shopee sheet (not the production sheet), follow the README steps above end to end. Confirm: `manualTestSync` logs rows with non-empty `hash` values; `syncAllTabs` results in matching rows in the `orders` table (check via `npx prisma studio` or a `SELECT` against the local Postgres); `createTimeTrigger` shows up under Triggers (clock icon) in the Apps Script editor.

- [ ] **Step 4: Commit**

```bash
git add google-apps-script/Sync.gs google-apps-script/README.md
git commit -m "feat: add Apps Script sync source and deployment notes"
```

---

### Task 7: Reconciliation Excel parser

**Files:**
- Create: `lib/reconcile/parseExcel.ts`
- Test: `tests/reconcile/parseExcel.test.ts`

**Interfaces:**
- Produces: `parseReconciliationExcel(buffer: Buffer): ParseResult`, type `ParsedExcelRow { rowNumber, shopeeOrderId, amount, status }` — consumed by Task 9. Also used directly by Task 8's tests.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reconcile/parseExcel.test.ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseReconciliationExcel } from "@/lib/reconcile/parseExcel";

function bufferFromRows(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer" }) as Buffer;
}

describe("parseReconciliationExcel", () => {
  it("parses valid rows", () => {
    const buffer = bufferFromRows([
      { shopee_order_id: "SP001", amount: 20000, status: "completed" },
      { shopee_order_id: "SP002", amount: 15000, status: "completed" },
    ]);

    const result = parseReconciliationExcel(buffer);
    expect(result.missingColumns).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].shopeeOrderId).toBe("SP001");
  });

  it("reports missing required columns", () => {
    const buffer = bufferFromRows([{ foo: "bar" }]);
    const result = parseReconciliationExcel(buffer);
    expect(result.missingColumns).toEqual(
      expect.arrayContaining(["shopeeOrderId", "amount", "status"])
    );
  });

  it("skips rows with invalid amount and reports rowErrors", () => {
    const buffer = bufferFromRows([
      { shopee_order_id: "SP001", amount: "not-a-number", status: "completed" },
    ]);
    const result = parseReconciliationExcel(buffer);
    expect(result.rows).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reconcile/parseExcel.test.ts`
Expected: FAIL with "Cannot find module '@/lib/reconcile/parseExcel'".

- [ ] **Step 3: Write implementation**

```typescript
// lib/reconcile/parseExcel.ts
import * as XLSX from "xlsx";

export interface ParsedExcelRow {
  rowNumber: number;
  shopeeOrderId: string;
  amount: number;
  status: string;
}

export interface ParseResult {
  rows: ParsedExcelRow[];
  missingColumns: string[];
  rowErrors: { rowNumber: number; issue: string }[];
}

const COLUMN_ALIASES: Record<"shopeeOrderId" | "amount" | "status", string[]> = {
  shopeeOrderId: ["shopee_order_id", "order id", "mã đơn hàng", "ma don hang"],
  amount: ["amount", "total_amount", "số tiền", "so tien"],
  status: ["status", "trạng thái", "trang thai"],
};

function normalizeHeader(header: string) {
  return header.trim().toLowerCase();
}

function findColumnKey(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index !== -1) return headers[index];
  }
  return null;
}

export function parseReconciliationExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (records.length === 0) {
    return { rows: [], missingColumns: Object.keys(COLUMN_ALIASES), rowErrors: [] };
  }

  const headers = Object.keys(records[0]);
  const orderIdKey = findColumnKey(headers, COLUMN_ALIASES.shopeeOrderId);
  const amountKey = findColumnKey(headers, COLUMN_ALIASES.amount);
  const statusKey = findColumnKey(headers, COLUMN_ALIASES.status);

  const missingColumns: string[] = [];
  if (!orderIdKey) missingColumns.push("shopeeOrderId");
  if (!amountKey) missingColumns.push("amount");
  if (!statusKey) missingColumns.push("status");

  if (missingColumns.length > 0) {
    return { rows: [], missingColumns, rowErrors: [] };
  }

  const rows: ParsedExcelRow[] = [];
  const rowErrors: { rowNumber: number; issue: string }[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const orderId = String(record[orderIdKey!]).trim();
    const amount = Number(record[amountKey!]);
    const status = String(record[statusKey!]).trim();

    if (!orderId || Number.isNaN(amount)) {
      rowErrors.push({ rowNumber, issue: "missing order id or invalid amount" });
      return;
    }

    rows.push({ rowNumber, shopeeOrderId: orderId, amount, status });
  });

  return { rows, missingColumns: [], rowErrors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reconcile/parseExcel.test.ts`
Expected: PASS (3/3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reconcile/parseExcel.ts tests/reconcile/parseExcel.test.ts
git commit -m "feat: add header-based Excel reconciliation parser"
```

---

### Task 8: Reconciliation matcher (pure function)

**Files:**
- Create: `lib/reconcile/matcher.ts`
- Test: `tests/reconcile/matcher.test.ts`

**Interfaces:**
- Consumes: `ParsedExcelRow` (Task 7).
- Produces: `matchReconciliation(excelRows: ParsedExcelRow[], orders: OrderRecord[]): MatchResult[]`, types `OrderRecord { shopeeOrderId, totalAmount, status }`, `MatchResult { shopeeOrderId, matchStatus, sheetAmount, excelAmount, diffDetail }` — consumed by Task 9.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reconcile/matcher.test.ts
import { describe, it, expect } from "vitest";
import { matchReconciliation } from "@/lib/reconcile/matcher";

describe("matchReconciliation", () => {
  const orders = [
    { shopeeOrderId: "SP001", totalAmount: 20000, status: "completed" },
    { shopeeOrderId: "SP002", totalAmount: 15000, status: "completed" },
    { shopeeOrderId: "SP003", totalAmount: 30000, status: "shipped" },
  ];

  it("marks an exact match as matched", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP001", amount: 20000, status: "completed" }],
      orders
    );
    expect(results.find((r) => r.shopeeOrderId === "SP001")?.matchStatus).toBe("matched");
  });

  it("marks an excel row with unknown order id as missing_in_sheet", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP999", amount: 1000, status: "completed" }],
      orders
    );
    expect(results[0].matchStatus).toBe("missing_in_sheet");
  });

  it("marks amount mismatch", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP002", amount: 99999, status: "completed" }],
      orders
    );
    expect(results.find((r) => r.shopeeOrderId === "SP002")?.matchStatus).toBe("amount_mismatch");
  });

  it("marks status mismatch", () => {
    const results = matchReconciliation(
      [{ rowNumber: 2, shopeeOrderId: "SP003", amount: 30000, status: "completed" }],
      orders
    );
    expect(results.find((r) => r.shopeeOrderId === "SP003")?.matchStatus).toBe("status_mismatch");
  });

  it("marks an order missing from the excel file as missing_in_excel", () => {
    const results = matchReconciliation([], orders);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.matchStatus === "missing_in_excel")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reconcile/matcher.test.ts`
Expected: FAIL with "Cannot find module '@/lib/reconcile/matcher'".

- [ ] **Step 3: Write implementation**

```typescript
// lib/reconcile/matcher.ts
import type { ParsedExcelRow } from "@/lib/reconcile/parseExcel";

export interface OrderRecord {
  shopeeOrderId: string;
  totalAmount: number;
  status: string;
}

export type MatchStatus =
  | "matched"
  | "missing_in_sheet"
  | "missing_in_excel"
  | "amount_mismatch"
  | "status_mismatch";

export interface MatchResult {
  shopeeOrderId: string;
  matchStatus: MatchStatus;
  sheetAmount: number | null;
  excelAmount: number | null;
  diffDetail: Record<string, unknown> | null;
}

export function matchReconciliation(excelRows: ParsedExcelRow[], orders: OrderRecord[]): MatchResult[] {
  const ordersById = new Map(orders.map((order) => [order.shopeeOrderId, order]));
  const matchedOrderIds = new Set<string>();
  const results: MatchResult[] = [];

  for (const excelRow of excelRows) {
    const order = ordersById.get(excelRow.shopeeOrderId);
    if (!order) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "missing_in_sheet",
        sheetAmount: null,
        excelAmount: excelRow.amount,
        diffDetail: null,
      });
      continue;
    }

    matchedOrderIds.add(order.shopeeOrderId);

    if (order.totalAmount !== excelRow.amount) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "amount_mismatch",
        sheetAmount: order.totalAmount,
        excelAmount: excelRow.amount,
        diffDetail: { sheetAmount: order.totalAmount, excelAmount: excelRow.amount },
      });
      continue;
    }

    if (order.status !== excelRow.status) {
      results.push({
        shopeeOrderId: excelRow.shopeeOrderId,
        matchStatus: "status_mismatch",
        sheetAmount: order.totalAmount,
        excelAmount: excelRow.amount,
        diffDetail: { sheetStatus: order.status, excelStatus: excelRow.status },
      });
      continue;
    }

    results.push({
      shopeeOrderId: excelRow.shopeeOrderId,
      matchStatus: "matched",
      sheetAmount: order.totalAmount,
      excelAmount: excelRow.amount,
      diffDetail: null,
    });
  }

  for (const order of orders) {
    if (!matchedOrderIds.has(order.shopeeOrderId)) {
      results.push({
        shopeeOrderId: order.shopeeOrderId,
        matchStatus: "missing_in_excel",
        sheetAmount: order.totalAmount,
        excelAmount: null,
        diffDetail: null,
      });
    }
  }

  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reconcile/matcher.test.ts`
Expected: PASS (5/5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/reconcile/matcher.ts tests/reconcile/matcher.test.ts
git commit -m "feat: add reconciliation matcher"
```

---

### Task 9: Reconciliation upload API endpoint

**Files:**
- Create: `app/api/reconcile/upload/route.ts`
- Test: `tests/api/reconcile-upload.test.ts`

**Interfaces:**
- Consumes: `parseReconciliationExcel` (Task 7), `matchReconciliation` (Task 8), `prisma` (Task 2).
- Produces: `POST /api/reconcile/upload` HTTP endpoint (multipart form, field `file`) — consumed by Task 11's upload form.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/api/reconcile-upload.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { POST } from "@/app/api/reconcile/upload/route";
import { prisma } from "@/lib/db";

function bufferFromRows(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer" }) as Buffer;
}

function makeUploadRequest(buffer: Buffer) {
  const formData = new FormData();
  formData.append("file", new File([buffer], "reconcile.xlsx"));
  return new NextRequest("http://localhost/api/reconcile/upload", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/reconcile/upload", () => {
  beforeEach(async () => {
    await prisma.reconciliationResult.deleteMany();
    await prisma.reconciliationBatch.deleteMany();
    await prisma.order.deleteMany();
    await prisma.order.create({
      data: {
        shopeeOrderId: "SP001",
        sku: "SKU1",
        productName: "P1",
        quantity: 1,
        unitPrice: 20000,
        totalAmount: 20000,
        status: "completed",
        rawRowHash: "h1",
        sheetRowIndex: 2,
      },
    });
  });

  it("creates a batch and matches rows", async () => {
    const buffer = bufferFromRows([{ shopee_order_id: "SP001", amount: 20000, status: "completed" }]);

    const response = await POST(makeUploadRequest(buffer));
    expect(response.status).toBe(200);
    const json = await response.json();

    const results = await prisma.reconciliationResult.findMany({ where: { batchId: json.batchId } });
    expect(results).toHaveLength(1);
    expect(results[0].matchStatus).toBe("matched");

    const batch = await prisma.reconciliationBatch.findUnique({ where: { id: json.batchId } });
    expect(batch?.status).toBe("done");
  });

  it("rejects a file missing required columns", async () => {
    const buffer = bufferFromRows([{ foo: "bar" }]);
    const response = await POST(makeUploadRequest(buffer));
    expect(response.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/reconcile-upload.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/reconcile/upload/route'".

- [ ] **Step 3: Write implementation**

```typescript
// app/api/reconcile/upload/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseReconciliationExcel } from "@/lib/reconcile/parseExcel";
import { matchReconciliation } from "@/lib/reconcile/matcher";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseReconciliationExcel(buffer);

  if (parsed.missingColumns.length > 0) {
    return NextResponse.json(
      { error: "missing required columns", missingColumns: parsed.missingColumns },
      { status: 400 }
    );
  }

  const batch = await prisma.reconciliationBatch.create({
    data: { fileName: file.name, status: "processing" },
  });

  const orders = await prisma.order.findMany({
    select: { shopeeOrderId: true, totalAmount: true, status: true },
  });

  const results = matchReconciliation(parsed.rows, orders);

  await prisma.reconciliationResult.createMany({
    data: results.map((result) => ({
      batchId: batch.id,
      shopeeOrderId: result.shopeeOrderId,
      matchStatus: result.matchStatus,
      sheetAmount: result.sheetAmount,
      excelAmount: result.excelAmount,
      diffDetail: result.diffDetail ?? undefined,
    })),
  });

  if (parsed.rowErrors.length > 0) {
    await prisma.reconciliationResult.createMany({
      data: parsed.rowErrors.map((rowError) => ({
        batchId: batch.id,
        shopeeOrderId: null,
        matchStatus: "parse_error",
        diffDetail: { rowNumber: rowError.rowNumber, issue: rowError.issue },
      })),
    });
  }

  await prisma.reconciliationBatch.update({ where: { id: batch.id }, data: { status: "done" } });

  return NextResponse.json({ batchId: batch.id, resultCount: results.length });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/reconcile-upload.test.ts`
Expected: PASS (2/2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/reconcile/upload/route.ts tests/api/reconcile-upload.test.ts
git commit -m "feat: add reconciliation upload endpoint"
```

---

### Task 10: Dashboard — Orders page

**Files:**
- Create: `app/dashboard/orders/page.tsx`

**Interfaces:**
- Consumes: `prisma.order` (Task 2).

- [ ] **Step 1: Write `app/dashboard/orders/page.tsx`**

```tsx
import { prisma } from "@/lib/db";

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    where: { isActive: true },
    orderBy: { lastSyncedAt: "desc" },
    take: 200,
  });

  return (
    <main>
      <h1>Orders</h1>
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>SKU</th>
            <th>Quantity</th>
            <th>Total</th>
            <th>Status</th>
            <th>Last synced</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>{order.shopeeOrderId}</td>
              <td>{order.sku}</td>
              <td>{order.quantity}</td>
              <td>{order.totalAmount}</td>
              <td>{order.status}</td>
              <td>{order.lastSyncedAt.toISOString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run:
```bash
npm run dev
```
Seed one row for a manual check: `npx prisma studio` (opens at `http://localhost:5555`), add a row to `orders` with `isActive = true`. Open `http://localhost:3000/dashboard/orders`, confirm the row renders in the table.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/orders/page.tsx
git commit -m "feat: add orders dashboard page"
```

---

### Task 11: Dashboard — Reconciliation page + upload form

**Files:**
- Create: `app/dashboard/reconciliation/UploadForm.tsx`
- Create: `app/dashboard/reconciliation/page.tsx`

**Interfaces:**
- Consumes: `POST /api/reconcile/upload` (Task 9), `prisma.reconciliationBatch`/`prisma.reconciliationResult` (Task 2).

- [ ] **Step 1: Write `app/dashboard/reconciliation/UploadForm.tsx`**

```tsx
"use client";

import { useState } from "react";

export function UploadForm() {
  const [status, setStatus] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/reconcile/upload", { method: "POST", body: formData });
    const json = await response.json();
    setStatus(response.ok ? `Batch ${json.batchId} done, ${json.resultCount} results` : json.error);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="file" name="file" accept=".xlsx,.xls" required />
      <button type="submit">Upload</button>
      {status && <p>{status}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Write `app/dashboard/reconciliation/page.tsx`**

```tsx
import { prisma } from "@/lib/db";
import { UploadForm } from "./UploadForm";

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const batches = await prisma.reconciliationBatch.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 20,
  });

  const latestBatch = batches[0];
  const results = latestBatch
    ? await prisma.reconciliationResult.findMany({
        where: {
          batchId: latestBatch.id,
          ...(searchParams.status ? { matchStatus: searchParams.status as never } : {}),
        },
      })
    : [];

  return (
    <main>
      <h1>Reconciliation</h1>
      <UploadForm />
      <h2>Latest batch: {latestBatch?.fileName ?? "none"}</h2>
      <table>
        <thead>
          <tr>
            <th>Order ID</th>
            <th>Status</th>
            <th>Sheet amount</th>
            <th>Excel amount</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={result.id}>
              <td>{result.shopeeOrderId}</td>
              <td>{result.matchStatus}</td>
              <td>{result.sheetAmount ?? "-"}</td>
              <td>{result.excelAmount ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Manual verification**

With `npm run dev` running and at least one order seeded (from Task 10), build a small `.xlsx` file with columns `shopee_order_id`, `amount`, `status` matching that order, open `http://localhost:3000/dashboard/reconciliation`, upload the file, confirm the results table shows a `matched` row.

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/reconciliation
git commit -m "feat: add reconciliation dashboard page with upload form"
```

---

### Task 12: Deployment documentation

**Files:**
- Create: `README.md`
- Modify: `.env.example`

**Interfaces:**
- None (documentation only) — no code produced or consumed.

- [ ] **Step 1: Write `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add local development and deployment instructions"
```


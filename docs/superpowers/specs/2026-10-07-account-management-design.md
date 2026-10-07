# Quản lý tài khoản — Design

Replaces the single shared HTTP Basic Auth credential (`DASHBOARD_USER` /
`DASHBOARD_PASSWORD`, checked in `middleware.ts`) with DB-backed accounts,
session-cookie login, and an account-management screen.

## Decisions (confirmed with user)

- Accounts are **flat** — any logged-in account may add / edit / delete any
  other account. No admin role.
- "Cập nhật mật khẩu" is **part of the Sửa form** (optional new-password field,
  blank = keep current). No separate self-service flow, no old-password check.
- Sessions are **long-lived** (30 days, cookie, survives browser restart).

## Data model

```prisma
model User {
  id           Int      @id @default(autoincrement())
  username     String   @unique          // stored lower-cased
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")
  @@map("users")
}
```

## Auth

- Password hash: Node `crypto.scrypt`, random 16-byte salt, stored as
  `scrypt$<salt hex>$<hash hex>`; verified with `timingSafeEqual`. No new dependency.
- Session cookie `session` = `base64url(JSON{uid,exp}) + "." + base64url(HMAC-SHA256)`,
  signed with new env `SESSION_SECRET`. httpOnly, sameSite=lax, secure in
  production, path `/`, 30 days. Signing/verification uses Web Crypto so the same
  module runs in Next's **edge** middleware and in Node route handlers.
- `middleware.ts` (edge, stateless): valid signature + unexpired → pass; otherwise
  page routes redirect to `/login?next=…`, API routes get `401` JSON. `/login`
  and `/api/auth/*` are not in the matcher. `/api/sync/webhook` keeps its own
  secret header, untouched. Production without `SESSION_SECRET` fails closed.
- DB-validated user check (`getCurrentUser()`): used by `app/dashboard/layout.tsx`
  (redirect to `/login` if the account no longer exists) and by the accounts API.
  Edge middleware cannot reach Prisma, so a deleted account's cookie keeps working
  for non-account API calls until it expires; emergency full revoke = rotate
  `SESSION_SECRET`. (Accepted trade-off, documented in DEPLOY_VPS.md.)
- Login: `POST /api/auth/login` `{username,password}`. **First-login bootstrap:** if
  the `users` table is empty and the credentials equal `DASHBOARD_USER` /
  `DASHBOARD_PASSWORD`, that account is created and logged in — so deploying never
  locks anyone out and needs no seed step. Once any account exists the env vars
  are ignored.
- Logout: `POST /api/auth/logout` clears the cookie; header button then goes to `/login`.

## Accounts API (all require a DB-validated session)

- `POST /api/accounts` `{username,password}` — create; 409 on duplicate username.
- `PATCH /api/accounts/[id]` `{username?,password?}` — blank/omitted password keeps it.
- `DELETE /api/accounts/[id]` — refuses deleting yourself and refuses deleting the
  last remaining account.
- Validation: username `^[a-z0-9._-]{3,50}$` (after trim + lower-case),
  password ≥ 8 characters.

## UI

- `/login` — centered card, no app header.
- `app/dashboard/layout.tsx` (new) owns `AppHeader` + overdue-warning count +
  current-user check; the root layout shrinks to `<html><body>`. Header gains the
  username (links to `/dashboard/accounts`) and an "Đăng xuất" button.
- `/dashboard/accounts` — table (username, created date) + "Thêm tài khoản";
  per-row "Sửa" (modal: username + new password) and "Xoá" (modal confirm).

## Out of scope

Login rate limiting, per-device session lists, password reset by email, roles.

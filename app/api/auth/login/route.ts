import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getSessionSecret, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from "@/lib/auth/session";
import { normalizeUsername } from "@/lib/auth/accounts";

const loginSchema = z.object({ username: z.string(), password: z.string() });

const INVALID_CREDENTIALS = { error: "Sai tên đăng nhập hoặc mật khẩu" };

// Verified against when the username doesn't exist, so "no such user" costs the
// same scrypt run as "wrong password" and response time doesn't leak which
// usernames are real.
let dummyHash: Promise<string> | null = null;
function getDummyHash() {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  return dummyHash;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// First-login bootstrap: the users table starts empty, and the old shared
// DASHBOARD_USER / DASHBOARD_PASSWORD env pair is what everyone already knows —
// so while there are no accounts at all, logging in with exactly that pair
// creates the first account. Deploying therefore never locks anyone out and
// needs no seed step. Once any account exists the env vars are ignored.
async function bootstrapFirstAccount(username: string, password: string) {
  const envUser = process.env.DASHBOARD_USER;
  const envPassword = process.env.DASHBOARD_PASSWORD;
  if (!envUser || !envPassword) return null;
  if (!safeEqual(username, normalizeUsername(envUser)) || !safeEqual(password, envPassword)) return null;
  if ((await prisma.user.count()) > 0) return null;

  try {
    return await prisma.user.create({ data: { username, passwordHash: await hashPassword(password) } });
  } catch (error) {
    // Two first logins racing: the other one won — just use its row.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.user.findUnique({ where: { username } });
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const secret = getSessionSecret();
  if (!secret) {
    return NextResponse.json({ error: "Server chưa cấu hình SESSION_SECRET" }, { status: 500 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" }, { status: 400 });
  }
  const username = normalizeUsername(parsed.data.username);
  const { password } = parsed.data;

  let user = await prisma.user.findUnique({ where: { username } });
  if (user) {
    if (!(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
    }
  } else {
    await verifyPassword(password, await getDummyHash());
    user = await bootstrapFirstAccount(username, password);
    if (!user) return NextResponse.json(INVALID_CREDENTIALS, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await signSession(user.id, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

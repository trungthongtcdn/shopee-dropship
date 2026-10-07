import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export interface CurrentUser {
  id: number;
  username: string;
}

// The edge middleware can only prove the cookie is validly signed and
// unexpired; this is the second half — the account it names must still exist,
// so deleting an account locks it out of everything that calls this.
async function userFromToken(token: string | undefined): Promise<CurrentUser | null> {
  const session = await verifySession(token, getSessionSecret());
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, username: true } });
}

// Server Components / layouts.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return userFromToken(cookies().get(SESSION_COOKIE)?.value);
}

// Route handlers — reads the request's own cookies so it works without
// Next's request-scoped context (and is directly testable).
export async function getUserFromRequest(request: NextRequest): Promise<CurrentUser | null> {
  return userFromToken(request.cookies.get(SESSION_COOKIE)?.value);
}

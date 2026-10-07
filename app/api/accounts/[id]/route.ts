import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth/currentUser";
import { hashPassword } from "@/lib/auth/password";
import { normalizeUsername, validatePassword, validateUsername } from "@/lib/auth/accounts";

// Both optional; an empty/omitted password means "keep the current one".
const updateSchema = z.object({ username: z.string().optional(), password: z.string().optional() });

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getUserFromRequest(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "invalid account id" }, { status: 400 });

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const data: { username?: string; passwordHash?: string } = {};
  if (parsed.data.username !== undefined) {
    const username = normalizeUsername(parsed.data.username);
    const invalid = validateUsername(username);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    data.username = username;
  }
  if (parsed.data.password) {
    const invalid = validatePassword(parsed.data.password);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    data.passwordHash = await hashPassword(parsed.data.password);
  }

  try {
    const account = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, createdAt: true },
    });
    return NextResponse.json({ account });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") return NextResponse.json({ error: "Tên đăng nhập đã tồn tại" }, { status: 409 });
      if (error.code === "P2025") return NextResponse.json({ error: "Không tìm thấy tài khoản" }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const me = await getUserFromRequest(request);
  if (!me) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: "invalid account id" }, { status: 400 });

  if (id === me.id) {
    return NextResponse.json({ error: "Không thể xoá tài khoản đang đăng nhập" }, { status: 400 });
  }
  if ((await prisma.user.count()) <= 1) {
    return NextResponse.json({ error: "Không thể xoá tài khoản cuối cùng" }, { status: 400 });
  }

  try {
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Không tìm thấy tài khoản" }, { status: 404 });
    }
    throw error;
  }
}

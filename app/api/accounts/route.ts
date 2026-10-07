import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth/currentUser";
import { hashPassword } from "@/lib/auth/password";
import { normalizeUsername, validatePassword, validateUsername } from "@/lib/auth/accounts";

const createSchema = z.object({ username: z.string(), password: z.string() });

export async function POST(request: NextRequest) {
  if (!(await getUserFromRequest(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" }, { status: 400 });
  }

  const username = normalizeUsername(parsed.data.username);
  const invalid = validateUsername(username) ?? validatePassword(parsed.data.password);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    const account = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(parsed.data.password) },
      select: { id: true, username: true, createdAt: true },
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Tên đăng nhập đã tồn tại" }, { status: 409 });
    }
    throw error;
  }
}

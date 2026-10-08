import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth/currentUser";
import { parsePerPage } from "@/lib/waybill/compose";

// The signed-in account's choice for how the re-ordered waybill PDF is laid out:
// 2, 4, 6 or 9 labels per A4 sheet, or "same"/null to keep the layout of the PDF
// that was uploaded. It follows the account to every browser it signs in from.
export async function POST(request: NextRequest) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  let perPage;
  try {
    perPage = parsePerPage(body?.perPage);
  } catch {
    return NextResponse.json({ error: "định dạng PDF không hợp lệ (chọn 2, 4, 6 hoặc 9 phiếu mỗi trang)" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: user.id }, data: { waybillPerPage: perPage } });
  return NextResponse.json({ waybillPerPage: perPage });
}

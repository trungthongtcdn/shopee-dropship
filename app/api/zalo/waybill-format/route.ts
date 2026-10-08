import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parsePerPage } from "@/lib/waybill/compose";
import { WAYBILL_CONFIRM_PURPOSE } from "@/lib/zalo/poller";

// How the re-ordered PDF posted to the waybill Zalo group is laid out: 2, 4, 6 or 9
// labels per A4 sheet, or null to keep the layout of the PDF that was sent. Lives on
// the group's watch config, so a group has to be chosen first; picking another group
// later keeps it (see /api/zalo/watch).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  let perPage;
  try {
    perPage = parsePerPage(body?.perPage);
  } catch {
    return NextResponse.json({ error: "định dạng PDF không hợp lệ (chọn 2, 4, 6 hoặc 9 phiếu mỗi trang)" }, { status: 400 });
  }

  const existing = await prisma.zaloWatchConfig.findUnique({ where: { purpose: WAYBILL_CONFIRM_PURPOSE } });
  if (!existing) {
    return NextResponse.json({ error: "hãy chọn nhóm Zalo trước" }, { status: 409 });
  }

  const config = await prisma.zaloWatchConfig.update({
    where: { purpose: WAYBILL_CONFIRM_PURPOSE },
    data: { waybillPerPage: perPage },
  });
  return NextResponse.json({ waybillPerPage: config.waybillPerPage });
}

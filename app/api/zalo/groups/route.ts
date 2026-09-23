import { NextRequest, NextResponse } from "next/server";
import { searchGroups } from "@/lib/zalo/bridge";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;

  try {
    const groups = await searchGroups(query);
    return NextResponse.json({ groups });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

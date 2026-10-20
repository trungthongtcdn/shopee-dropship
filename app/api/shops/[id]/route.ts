import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/currentUser";
import { renameShop } from "@/lib/shops/registry";

// Shops are named by whoever runs the site; this is the only thing about a shop that
// can be changed from the web.
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!(await getUserFromRequest(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid shop id" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const result = await renameShop(id, body?.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ shop: result.shop });
}

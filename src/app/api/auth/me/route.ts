import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuth, unauthorized } from "@/lib/auth";

// GET /api/auth/me -> who is signed in. /session reads the merchant from here
// because the session cookie is httpOnly and invisible to page scripts.
export async function GET(req: NextRequest) {
  const auth = await getAuth(req);
  if (!auth.merchantId && !auth.owner) return unauthorized();

  const merchant = auth.merchantId
    ? await db.merchant.findUnique({ where: { id: auth.merchantId }, select: { id: true, name: true } })
    : null;

  return NextResponse.json({
    owner: auth.owner,
    merchantId: merchant?.id ?? null,
    merchantName: merchant?.name ?? null,
  });
}

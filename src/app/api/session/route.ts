import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forbidden, getAuth, unauthorized } from "@/lib/auth";

// POST /api/session -> "Buka Lapak": open a new session for the signed-in
//                      merchant (taken from the session cookie, not the body).
// GET  /api/session -> recent sessions: the merchant's own, or all for the owner.

export async function POST(req: NextRequest) {
  const auth = await getAuth(req);
  if (!auth.merchantId) return forbidden();

  const session = await db.session.create({
    data: { merchantId: auth.merchantId, status: "OPEN" },
  });

  return NextResponse.json(session, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await getAuth(req);
  if (!auth.owner && !auth.merchantId) return unauthorized();

  const sessions = await db.session.findMany({
    where: auth.owner ? undefined : { merchantId: auth.merchantId! },
    orderBy: { openedAt: "desc" },
    include: { merchant: { select: { id: true, name: true, cartType: true } }, transactions: true }, // never send the PIN hash
    take: 30,
  });

  return NextResponse.json(sessions);
}

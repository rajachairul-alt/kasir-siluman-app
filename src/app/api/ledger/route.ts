import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forbidden, getAuth } from "@/lib/auth";

// GET /api/ledger -> the Owner Dashboard's data source: every closed
// session (RECONCILED or FLAGGED) with its totals, newest first. Owner only.
//
// Query params (all optional):
//   merchantId  filter to a single merchant  e.g. ?merchantId=demo-merchant

export async function GET(req: NextRequest) {
  if (!(await getAuth(req)).owner) return forbidden();
  const { searchParams } = req.nextUrl;
  const merchantId = searchParams.get("merchantId") ?? undefined;

  const [sessions, merchants] = await Promise.all([
    db.session.findMany({
      where: {
        status: { in: ["RECONCILED", "FLAGGED"] },
        ...(merchantId ? { merchantId } : {}),
      },
      orderBy: { closedAt: "desc" },
      include: { merchant: { select: { id: true, name: true, cartType: true } } }, // never send the PIN hash
      take: 60,
    }),
    // Return the full merchant list so the dashboard can build its filter
    // dropdown without a separate round-trip.
    db.merchant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, cartType: true } }),
  ]);

  return NextResponse.json({ sessions, merchants });
}

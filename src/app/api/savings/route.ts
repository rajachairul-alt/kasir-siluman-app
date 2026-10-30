import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuth, unauthorized } from "@/lib/auth";

// GET /api/savings
//
// Returns all SavingsProposals, newest first.
// Used by:
//   /session  — fetch the latest PENDING_SELLER_CONFIRMATION proposal for the
//               demo merchant so the SavingsPanel can display it.
//   /dashboard — fetch all proposals to compute the CONFIRMED total for the
//                summary card.
//
// Query params (all optional):
//   merchantId  — filter to a single merchant (owner only; a signed-in
//                 pedagang always gets just their own proposals)

export async function GET(req: NextRequest) {
  const auth = await getAuth(req);
  if (!auth.owner && !auth.merchantId) return unauthorized();
  const merchantId = auth.owner
    ? req.nextUrl.searchParams.get("merchantId") ?? undefined
    : auth.merchantId!;

  const proposals = await db.savingsProposal.findMany({
    where: merchantId ? { merchantId } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(proposals);
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

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
//   merchantId  — filter to a single merchant
//
// Mirrors the optional-filter pattern of GET /api/ledger.

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const merchantId = searchParams.get("merchantId") ?? undefined;

  const proposals = await db.savingsProposal.findMany({
    where: merchantId ? { merchantId } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(proposals);
}

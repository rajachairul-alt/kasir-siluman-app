import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/internal/item-prices?itemLabel=bakso
//
// Internal-only endpoint for the Radar Tetangga Langflow pipeline
// (BOB_BRIEF.md item #4, Langflow-Pipeline-Specs.md section 2).
//
// Returns the raw list of transaction amounts for a given item label across
// ALL merchants in the lookback window — no merchant identifiers, session
// identifiers, or per-merchant breakdown of any kind. The Langflow pipeline
// (a deterministic Python component, NOT an LLM — see spec) computes the
// average and sample size itself from this list, and is responsible for
// suppressing the result when sampleSize < 2.
//
// This is deliberately the ONLY place in the app that reads Transaction rows
// across merchant boundaries. Keeping the cross-merchant read here, behind a
// shared secret, means no other code path can accidentally leak one
// merchant's price to another.
//
// ── Authentication ───────────────────────────────────────────────────────────
// Shared-secret header check, same pattern as the QRIS webhook
// (src/app/api/webhook/qris/route.ts): `x-radar-internal-secret` must match
// RADAR_INTERNAL_SECRET. This endpoint is never called from the browser —
// only from the Langflow "Radar Tetangga Aggregator" custom component,
// server-to-server.

const LOOKBACK_DAYS = 30;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-radar-internal-secret");
  if (!secret || secret !== process.env.RADAR_INTERNAL_SECRET) {
    return NextResponse.json({ error: "Signature tidak valid" }, { status: 401 });
  }

  const itemLabel = req.nextUrl.searchParams.get("itemLabel");
  if (!itemLabel || !itemLabel.trim()) {
    return NextResponse.json(
      { error: "Query param itemLabel wajib diisi" },
      { status: 400 }
    );
  }

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  // Fetch across ALL merchants — no sessionId/merchantId filter. This is the
  // one query in the app that intentionally crosses merchant boundaries, for
  // the sole purpose of computing an anonymous aggregate.
  const transactions = await db.transaction.findMany({
    where: {
      itemLabel: { not: null },
      timestamp: { gte: since },
    },
    select: { itemLabel: true, amount: true },
  });

  // Case/whitespace-insensitive match done in application code — SQLite via
  // Prisma doesn't support case-insensitive `where` filters, and item labels
  // come from free-form voice extraction so casing can vary ("Bakso" vs
  // "bakso"). Data volume for this hackathon MVP is small enough that
  // in-memory filtering is fine (same approach as /api/promo/context).
  const needle = itemLabel.trim().toLowerCase();
  const amounts = transactions
    .filter((tx) => tx.itemLabel!.trim().toLowerCase() === needle)
    .map((tx) => tx.amount);

  return NextResponse.json({ amounts });
}

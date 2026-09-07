import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { PromoContext } from "@/lib/generativePromo";

// GET /api/promo/context
//
// Builds a PromoContext for the Generative Promo pipeline by aggregating
// Transaction records from the past LOOKBACK_DAYS days.
//
// Query params (provide exactly one):
//   sessionId   — derive the merchant from this session
//   merchantId  — use this merchant directly
//
// Returns a PromoContext JSON ({ merchantName, recentItems }) ready to pass
// to generatePromo() in src/lib/generativePromo.ts.
//
// No new tables are created — this is a pure aggregation over the existing
// Transaction and Session tables.

const LOOKBACK_DAYS = 7;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sessionId = searchParams.get("sessionId");
  const merchantId = searchParams.get("merchantId");

  if (!sessionId && !merchantId) {
    return NextResponse.json(
      { error: "Sertakan sessionId atau merchantId sebagai query param" },
      { status: 400 }
    );
  }

  // ── Resolve merchant ───────────────────────────────────────────────────────
  let resolvedMerchantId: string;
  let merchantName: string;

  if (sessionId) {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      include: { merchant: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
    }
    resolvedMerchantId = session.merchantId;
    merchantName = session.merchant.name;
  } else {
    const merchant = await db.merchant.findUnique({ where: { id: merchantId! } });
    if (!merchant) {
      return NextResponse.json({ error: "Merchant tidak ditemukan" }, { status: 404 });
    }
    resolvedMerchantId = merchant.id;
    merchantName = merchant.name;
  }

  // ── Aggregate recent transactions ──────────────────────────────────────────
  // Look back LOOKBACK_DAYS from now, across all sessions for this merchant.
  // Only transactions with a non-null itemLabel are included — unlabelled
  // QRIS events carry no item context useful for promo generation.
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const transactions = await db.transaction.findMany({
    where: {
      session: { merchantId: resolvedMerchantId },
      itemLabel: { not: null },
      timestamp: { gte: since },
    },
    select: { itemLabel: true },
  });

  // Group by itemLabel and count occurrences in application code.
  // SQLite via Prisma doesn't support groupBy aggregation in all versions,
  // and the data volume here is small enough that in-memory grouping is fine.
  const counts = new Map<string, number>();
  for (const tx of transactions) {
    const label = tx.itemLabel!; // non-null guaranteed by the where clause above
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const recentItems = Array.from(counts.entries())
    .map(([itemLabel, count]) => ({ itemLabel, count }))
    .sort((a, b) => b.count - a.count); // highest frequency first

  const context: PromoContext = { merchantName, recentItems };
  return NextResponse.json(context);
}

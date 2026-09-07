import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { computeMonthlyRevenue, proposeMonthlySavings } from "@/lib/reconciliation";

// POST /api/savings/generate
//
// Generates (or returns the existing) SavingsProposal for a given merchant
// and month. Designed to be called idempotently — safe to call multiple
// times without corrupting a seller's previous confirm/decline decision.
//
// ── Production deployment note ───────────────────────────────────────────────
// In production this endpoint would be triggered by a monthly cron job
// (e.g. Vercel Cron, OS cron calling this URL on the 1st of each month).
// For the hackathon demo it is triggered manually from the dashboard's
// "Generate proposal bulan ini" button, or automatically on dashboard load.
// ─────────────────────────────────────────────────────────────────────────────
//
// Body: { merchantId: string, month?: string }  ("YYYY-MM", defaults to current month)
//
// Responses:
//   201  — new proposal created
//   200  — proposal already exists for this merchant+month (returned as-is,
//           no overwrite — the @@unique constraint is the safety net)
//   204  — no closed sessions this month, nothing to propose
//   400  — invalid body
//   404  — merchant not found

function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

const generateSchema = z.object({
  merchantId: z.string().min(1),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month harus format "YYYY-MM"')
    .optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body bukan JSON yang valid" }, { status: 400 });
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body tidak valid", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { merchantId, month = currentMonth() } = parsed.data;

  // ── Guard: merchant must exist ────────────────────────────────────────────
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) {
    return NextResponse.json({ error: "Merchant tidak ditemukan" }, { status: 404 });
  }

  // ── Idempotency check: return existing proposal if already generated ───────
  // This must happen BEFORE computing revenue so we never overwrite a
  // CONFIRMED or DECLINED proposal even if the caller forgets to check.
  const existing = await db.savingsProposal.findUnique({
    where: { merchantId_month: { merchantId, month } },
  });
  if (existing) {
    // 200 (not 201) signals "already exists, no change made"
    return NextResponse.json(existing, { status: 200 });
  }

  // ── Aggregate closed sessions for this merchant in the given month ─────────
  // Parse month boundaries in UTC to avoid timezone edge-cases.
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(year, monthNum - 1, 1));
  const monthEnd = new Date(Date.UTC(year, monthNum, 1)); // exclusive upper bound

  const sessions = await db.session.findMany({
    where: {
      merchantId,
      status: { in: ["RECONCILED", "FLAGGED"] },
      closedAt: { gte: monthStart, lt: monthEnd },
    },
    select: { qrisTotal: true, voiceCashEstimate: true },
  });

  // ── Revenue proxy: qrisTotal + voiceCashEstimate across all closed sessions
  // This is NOT net profit — Kasir Siluman does not track costs.
  // See computeMonthlyRevenue() in src/lib/reconciliation.ts for the full note.
  const revenueProxy = computeMonthlyRevenue(sessions);

  if (revenueProxy === 0) {
    // No closed sessions this month — a Rp0 proposal is meaningless.
    return new NextResponse(null, { status: 204 });
  }

  // ── Create proposal ───────────────────────────────────────────────────────
  const proposal = proposeMonthlySavings(revenueProxy, month);

  const created = await db.savingsProposal.create({
    data: {
      merchantId,
      month,
      netProfit: revenueProxy, // stored as "revenue proxy" — see field comment in schema
      suggestedAmount: proposal.suggestedAmount,
      status: proposal.status,
      lockedUntil: proposal.lockedUntil,
    },
  });

  return NextResponse.json(created, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// POST /api/internal/audit-log  — create an AuditLog entry
// GET  /api/internal/audit-log  — read recent entries (newest first)
//
// Protected by shared secret: `x-orchestrate-internal-secret` must match
// ORCHESTRATE_INTERNAL_SECRET in .env — same pattern as
// src/app/api/internal/item-prices/route.ts (x-radar-internal-secret).
//
// Called by:
//   - watsonx Orchestrate agents directly (when a decision is taken in an
//     Orchestrate-mediated flow), and
//   - src/app/api/session/[id]/close/route.ts  (best-effort, always fires)
//   - src/app/api/savings/[id]/confirm/route.ts (best-effort)
//   - src/app/api/savings/[id]/decline/route.ts (best-effort)
//
// This ensures the log is populated regardless of whether the Orchestrate
// agents are fully wired in — the dashboard Audit Log panel works from day one.

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function checkSecret(req: NextRequest): boolean {
  const secret = req.headers.get("x-orchestrate-internal-secret");
  return !!secret && secret === process.env.ORCHESTRATE_INTERNAL_SECRET;
}

// ── POST — create ─────────────────────────────────────────────────────────────

const createSchema = z.object({
  agentName: z.enum(["Listener", "Payment-Event", "Reconciliation", "Radar Tetangga", "Growth"]),
  action: z.string().min(1).max(100),
  entityId: z.string().min(1),
  merchantId: z.string().optional(),
  // detail must be a short human-readable summary — no raw payloads or PII.
  detail: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Signature tidak valid" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body bukan JSON yang valid" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body tidak valid", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const entry = await db.auditLog.create({ data: parsed.data });
  return NextResponse.json(entry, { status: 201 });
}

// ── GET — list ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: "Signature tidak valid" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const merchantId = searchParams.get("merchantId") ?? undefined;
  const rawLimit = parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  const entries = await db.auditLog.findMany({
    where: merchantId ? { merchantId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(entries);
}

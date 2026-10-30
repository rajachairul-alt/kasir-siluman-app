import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forbidden, getAuth } from "@/lib/auth";

// GET /api/audit-log
//
// Read-only view of the AuditLog table for the owner dashboard (owner
// session required). Returns summary data only — no raw payloads, no PII.
//
// Separation from /api/internal/audit-log mirrors the pattern already
// established by /api/internal/item-prices (internal, secret-protected,
// write+read) vs /api/radar (public, read-only, calls the internal route
// internally).
//
// Query params (all optional):
//   merchantId  — filter to a single merchant
//   limit       — max entries to return (default 20, max 100)

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(req: NextRequest) {
  if (!(await getAuth(req)).owner) return forbidden();
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

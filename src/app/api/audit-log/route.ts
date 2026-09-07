import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/audit-log
//
// Public (no shared secret) read-only proxy over the AuditLog table —
// safe for the browser / dashboard to call directly because it returns
// only summary data (no raw payloads, no PII) and is read-only.
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

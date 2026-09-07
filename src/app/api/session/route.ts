import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// POST /api/session -> "Buka Lapak": open a new session for a merchant.
// GET  /api/session -> list sessions (used by the owner dashboard).

const openSchema = z.object({
  merchantId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = openSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "merchantId wajib diisi" }, { status: 400 });
  }

  const session = await db.session.create({
    data: { merchantId: parsed.data.merchantId, status: "OPEN" },
  });

  return NextResponse.json(session, { status: 201 });
}

export async function GET() {
  const sessions = await db.session.findMany({
    orderBy: { openedAt: "desc" },
    include: { merchant: true, transactions: true },
    take: 30,
  });

  return NextResponse.json(sessions);
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// POST /api/transactions -> log one captured event against an open session.
//
// This is the landing point for BOTH capture lanes described in the PRD:
//   - source: "voice"  -> called by the Langflow Voice-to-Transaction
//                         pipeline once it has extracted a price from
//                         what the seller said out loud.
//   - source: "qris"   -> also reachable here directly, but in production
//                         QRIS events should come in through
//                         /api/webhook/qris instead (see that route).
//
// Nothing here ever accepts a transaction typed in after the fact with no
// source event behind it — see PRD section 4, Core Concept & Trust Highlight.

const transactionSchema = z.object({
  sessionId: z.string().min(1),
  source: z.enum(["qris", "voice"]),
  amount: z.number().int().positive(),
  itemLabel: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = transactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = await db.session.findUnique({ where: { id: parsed.data.sessionId } });
  if (!session) {
    return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
  }
  if (session.status !== "OPEN") {
    return NextResponse.json(
      { error: "Sesi sudah ditutup, transaksi baru tidak bisa ditambahkan" },
      { status: 409 }
    );
  }

  const transaction = await db.transaction.create({ data: parsed.data });

  return NextResponse.json(transaction, { status: 201 });
}

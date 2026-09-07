import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { reconcileSession } from "@/lib/reconciliation";
import { writeAuditLog } from "@/lib/auditLog";

// POST /api/session/:id/close -> "Tutup Buku": the seller reports one
// number out loud, and we reconcile it against what was independently
// captured through the day (QRIS webhook events + voice-extracted prices).
// See PRD section 4 (Core Concept & Trust Highlight) and section 9.

const closeSchema = z.object({
  closingReportTotal: z.number().int().nonnegative(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "closingReportTotal (angka tutup buku) wajib diisi" },
      { status: 400 }
    );
  }

  const session = await db.session.findUnique({
    where: { id: params.id },
    include: { transactions: true },
  });
  if (!session) {
    return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
  }
  if (session.status !== "OPEN") {
    return NextResponse.json({ error: "Sesi sudah ditutup" }, { status: 409 });
  }

  const qrisTotal = session.transactions
    .filter((t) => t.source === "qris")
    .reduce((sum, t) => sum + t.amount, 0);
  const voiceCashEstimate = session.transactions
    .filter((t) => t.source === "voice")
    .reduce((sum, t) => sum + t.amount, 0);

  const result = reconcileSession(
    qrisTotal,
    voiceCashEstimate,
    parsed.data.closingReportTotal
  );

  const updated = await db.session.update({
    where: { id: params.id },
    data: {
      closedAt: new Date(),
      status: result.status,
      qrisTotal: result.qrisTotal,
      voiceCashEstimate: result.voiceCashEstimate,
      closingReportTotal: result.closingReportTotal,
      varianceAmount: result.varianceAmount,
    },
  });

  // Best-effort audit log — never let a logging failure break the close action.
  writeAuditLog({
    agentName: "Reconciliation",
    action: "session.closed",
    entityId: updated.id,
    merchantId: updated.merchantId,
    detail: `status=${updated.status}, selisih=${updated.varianceAmount ?? 0}`,
  }).catch(() => {});

  return NextResponse.json(updated);
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/auditLog";

// POST /api/savings/:id/decline
//
// Seller declines a PENDING_SELLER_CONFIRMATION savings proposal ("Lewati bulan ini").
// Once declined, the proposal is locked — calling this or /confirm again
// returns 409, never silently re-opens it.
//
// No request body needed — the action is fully described by the URL.

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const proposal = await db.savingsProposal.findUnique({ where: { id: params.id } });
  if (!proposal) {
    return NextResponse.json({ error: "Proposal tidak ditemukan" }, { status: 404 });
  }
  if (proposal.status !== "PENDING_SELLER_CONFIRMATION") {
    return NextResponse.json(
      {
        error: "Proposal sudah diputuskan sebelumnya dan tidak dapat diubah lagi",
        currentStatus: proposal.status,
      },
      { status: 409 }
    );
  }

  const updated = await db.savingsProposal.update({
    where: { id: params.id },
    data: { status: "DECLINED" },
  });

  // Best-effort audit log.
  writeAuditLog({
    agentName: "Reconciliation",
    action: "savings.declined",
    entityId: updated.id,
    merchantId: updated.merchantId,
    detail: `bulan=${updated.month}, jumlah=${updated.suggestedAmount}`,
  }).catch(() => {});

  return NextResponse.json(updated);
}

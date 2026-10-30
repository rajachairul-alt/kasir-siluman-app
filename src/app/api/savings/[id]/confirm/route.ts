import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { writeAuditLog } from "@/lib/auditLog";

// POST /api/savings/:id/confirm
//
// Seller confirms a PENDING_SELLER_CONFIRMATION savings proposal.
// Once confirmed, the proposal is locked — calling this or /decline again
// returns 409, never silently re-opens it.
//
// No request body needed — the action is fully described by the URL.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const proposal = await db.savingsProposal.findUnique({ where: { id: params.id } });
  // Only the merchant the proposal belongs to may decide on it.
  if (!proposal || (await getAuth(req)).merchantId !== proposal.merchantId) {
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
    data: { status: "CONFIRMED" },
  });

  // Best-effort audit log.
  writeAuditLog({
    agentName: "Reconciliation",
    action: "savings.confirmed",
    entityId: updated.id,
    merchantId: updated.merchantId,
    detail: `bulan=${updated.month}, jumlah=${updated.suggestedAmount}`,
  }).catch(() => {});

  return NextResponse.json(updated);
}

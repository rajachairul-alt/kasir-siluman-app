// Optional seed so the owner dashboard has something to show without
// running the /session demo flow first. Run with `npm run db:seed`.
//
// What this seed sets up:
//   - Merchant 1 (Bakso Pak Budi): 3 closed sessions (2 RECONCILED, 1 FLAGGED)
//     with itemLabel on every voice transaction.
//   - Merchant 2 (Es Teh Bu Sari): 1 closed session, also sells "bakso" at a
//     different price — ensures Radar Tetangga has ≥2 distinct merchants for
//     "bakso" so it returns a real averagePrice (not 204 / "data kurang").
//   - AuditLog entries for every session close and the savings confirmation,
//     so the "Log Keputusan Agent" panel in /dashboard is populated from the
//     very first `npm run db:seed`.
//   - One CONFIRMED SavingsProposal for Merchant 1 for the current month, so
//     the "Tabungan dikonfirmasi" card shows a non-zero number without anyone
//     pressing the generate button first.

import { PrismaClient } from "@prisma/client";
import { reconcileSession, computeMonthlyRevenue, proposeMonthlySavings } from "../src/lib/reconciliation";
import { writeAuditLog } from "../src/lib/auditLog";

const db = new PrismaClient();

function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function main() {
  // ── Merchant 1: Bakso Pak Budi ─────────────────────────────────────────────
  const merchant1 = await db.merchant.upsert({
    where: { id: "demo-merchant" },
    update: {},
    create: { id: "demo-merchant", name: "Bakso Pak Budi", cartType: "gerobak" },
  });

  // ── Merchant 2: Es Teh Bu Sari (second merchant for Radar Tetangga) ────────
  // This merchant also sells "bakso" at a different price so the Radar
  // Tetangga aggregation (which requires ≥2 distinct merchants per item) can
  // return a real averagePrice during the demo, not the "data kurang" 204.
  const merchant2 = await db.merchant.upsert({
    where: { id: "demo-merchant-2" },
    update: {},
    create: { id: "demo-merchant-2", name: "Es Teh Bu Sari", cartType: "gerobak" },
  });

  // ── Scenarios for Merchant 1 ───────────────────────────────────────────────
  // Each scenario keeps the original {qris, voice, reported} shape plus
  // itemLabel(s) for the voice transactions.
  const scenarios: Array<{
    qris: number;
    voice: number;
    reported: number;
    voiceItems: Array<{ amount: number; itemLabel: string }>;
  }> = [
    {
      qris: 85000,
      voice: 62000,
      reported: 60000, // clean day (within 5% tolerance)
      voiceItems: [
        { amount: 20000, itemLabel: "bakso" },
        { amount: 15000, itemLabel: "es teh" },
        { amount: 27000, itemLabel: "gorengan" },
      ],
    },
    {
      qris: 120000,
      voice: 45000,
      reported: 30000, // FLAGGED: employee shortfall (selisih Rp15.000 > 5%)
      voiceItems: [
        { amount: 20000, itemLabel: "bakso" },
        { amount: 25000, itemLabel: "bakso" },
      ],
    },
    {
      qris: 60000,
      voice: 90000,
      reported: 88000, // clean day
      voiceItems: [
        { amount: 15000, itemLabel: "es teh" },
        { amount: 20000, itemLabel: "gorengan" },
        { amount: 15000, itemLabel: "es teh" },
        { amount: 40000, itemLabel: "bakso" },
      ],
    },
  ];

  for (const s of scenarios) {
    const result = reconcileSession(s.qris, s.voice, s.reported);
    const session = await db.session.create({
      data: {
        merchantId: merchant1.id,
        status: result.status,
        closedAt: new Date(),
        qrisTotal: result.qrisTotal,
        voiceCashEstimate: result.voiceCashEstimate,
        closingReportTotal: result.closingReportTotal,
        varianceAmount: result.varianceAmount,
      },
    });

    // QRIS transaction (no itemLabel — aggregator-captured, exact)
    await db.transaction.create({
      data: { sessionId: session.id, source: "qris", amount: s.qris },
    });

    // Voice transactions (with itemLabel — required for Radar Tetangga & Promo)
    for (const item of s.voiceItems) {
      await db.transaction.create({
        data: {
          sessionId: session.id,
          source: "voice",
          amount: item.amount,
          itemLabel: item.itemLabel,
          confidence: 0.9,
        },
      });
    }

    // AuditLog — same entry that writeAuditLog() would create from the real
    // close route. This populates the dashboard panel from day one of demo.
    await writeAuditLog({
      agentName: "Reconciliation",
      action: "session.closed",
      entityId: session.id,
      merchantId: merchant1.id,
      detail: `status=${result.status}, selisih=${result.varianceAmount ?? 0}`,
    }).catch(() => {});
  }

  // ── Merchant 2 session (one RECONCILED day, sells "bakso" at a higher price)
  {
    const result = reconcileSession(70000, 55000, 54000); // clean day
    const session = await db.session.create({
      data: {
        merchantId: merchant2.id,
        status: result.status,
        closedAt: new Date(),
        qrisTotal: result.qrisTotal,
        voiceCashEstimate: result.voiceCashEstimate,
        closingReportTotal: result.closingReportTotal,
        varianceAmount: result.varianceAmount,
      },
    });

    await db.transaction.create({
      data: { sessionId: session.id, source: "qris", amount: 70000 },
    });
    // Different price for "bakso" — this is what Radar Tetangga averages
    // across merchants.  Also sells "es teh" to round out the promo context.
    for (const item of [
      { amount: 25000, itemLabel: "bakso" },
      { amount: 12000, itemLabel: "es teh" },
      { amount: 18000, itemLabel: "bakso" },
    ]) {
      await db.transaction.create({
        data: {
          sessionId: session.id,
          source: "voice",
          amount: item.amount,
          itemLabel: item.itemLabel,
          confidence: 0.88,
        },
      });
    }

    await writeAuditLog({
      agentName: "Reconciliation",
      action: "session.closed",
      entityId: session.id,
      merchantId: merchant2.id,
      detail: `status=${result.status}, selisih=${result.varianceAmount ?? 0}`,
    }).catch(() => {});
  }

  // ── SavingsProposal for Merchant 1 (CONFIRMED) ────────────────────────────
  // Use the same logic as the real generate endpoint so the "Tabungan
  // dikonfirmasi" card on /dashboard shows a real number from the first demo.
  const month = currentMonth();
  const revenueProxy = computeMonthlyRevenue(
    scenarios.map((s) => ({
      qrisTotal: s.qris,
      voiceCashEstimate: s.voice,
    }))
  );
  const proposal = proposeMonthlySavings(revenueProxy, month);

  const savingsEntry = await db.savingsProposal.upsert({
    where: { merchantId_month: { merchantId: merchant1.id, month } },
    update: { status: "CONFIRMED" },
    create: {
      merchantId: merchant1.id,
      month,
      netProfit: revenueProxy,
      suggestedAmount: proposal.suggestedAmount,
      status: "CONFIRMED",
      lockedUntil: proposal.lockedUntil,
    },
  });

  await writeAuditLog({
    agentName: "Reconciliation",
    action: "savings.confirmed",
    entityId: savingsEntry.id,
    merchantId: merchant1.id,
    detail: `bulan=${month}, jumlah=${proposal.suggestedAmount}`,
  }).catch(() => {});

  console.log(`Seed selesai:`);
  console.log(`  - 3 sesi ${merchant1.name} (2 RECONCILED, 1 FLAGGED)`);
  console.log(`  - 1 sesi ${merchant2.name} (RECONCILED, punya data bakso untuk Radar)`);
  console.log(`  - SavingsProposal CONFIRMED bulan ${month}: Rp${proposal.suggestedAmount.toLocaleString("id-ID")}`);
  console.log(`  - AuditLog: 4 sesi + 1 savings.confirmed`);
}

main().finally(() => db.$disconnect());

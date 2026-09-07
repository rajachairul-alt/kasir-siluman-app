import type { ReconciliationResult } from "./types";

/**
 * Core reconciliation rule from the PRD (section 9 & section 4, Core Concept
 * & Trust Highlight): a day only counts as clean when the seller's own
 * spoken closing total agrees, within tolerance, with the cash total that
 * was independently captured from ambient audio during the session.
 *
 * QRIS is never part of this comparison on the cash side — it is already
 * exact, straight from the webhook.
 */
export const TOLERANCE_RATE = 0.05; // 5% of the closing report total

export function reconcileSession(
  qrisTotal: number,
  voiceCashEstimate: number,
  closingReportTotal: number
): ReconciliationResult {
  const varianceAmount = Math.abs(voiceCashEstimate - closingReportTotal);
  const tolerance = closingReportTotal * TOLERANCE_RATE;

  return {
    qrisTotal,
    voiceCashEstimate,
    closingReportTotal,
    varianceAmount,
    status: varianceAmount <= tolerance ? "RECONCILED" : "FLAGGED",
  };
}

/**
 * Compute a monthly revenue proxy from a list of closed sessions.
 *
 * ── MVP simplification ───────────────────────────────────────────────────────
 * Kasir Siluman does not track costs/COGS yet, so we cannot compute a true
 * net profit. This function returns the sum of qrisTotal + voiceCashEstimate
 * across all provided sessions as an honest proxy for "recorded revenue".
 *
 * Callers must use honest naming (e.g. `revenueProxy`, not `netProfit`) and
 * the UI must label results as "berdasarkan omzet tercatat", not "laba bersih".
 * Adding cost tracking is a post-hackathon roadmap item.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function computeMonthlyRevenue(
  sessions: { qrisTotal: number; voiceCashEstimate: number }[]
): number {
  return sessions.reduce((sum, s) => sum + s.qrisTotal + s.voiceCashEstimate, 0);
}

/**
 * Monthly net-profit savings proposal (PRD section 9). Runs once a month,
 * always PENDING_SELLER_CONFIRMATION until the seller approves it, and the
 * resulting amount is locked until the first day of the next month.
 */
export const SAVINGS_RATE = 0.1; // 10% of monthly recorded revenue (proxy for net profit)

export function proposeMonthlySavings(netProfit: number, month: string) {
  const suggestedAmount = Math.round(netProfit * SAVINGS_RATE);
  const [year, monthIndex] = month.split("-").map(Number);
  const lockedUntil = new Date(year, monthIndex, 1); // first day of next month

  return {
    status: "PENDING_SELLER_CONFIRMATION" as const,
    suggestedAmount,
    lockedUntil,
  };
}

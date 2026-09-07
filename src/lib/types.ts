// Shared shapes used by both the API routes and the UI. These intentionally
// mirror the pseudocode in the PRD (section 9, System Logic & Data Model)
// so the code and the spec never drift apart.

export type TransactionSource = "qris" | "voice";

export interface TransactionEventInput {
  sessionId: string;
  source: TransactionSource;
  amount: number;
  itemLabel?: string;
  /** only meaningful for voice-sourced events, 0-1 */
  confidence?: number;
}

export type SessionStatus = "OPEN" | "RECONCILED" | "FLAGGED";

export interface ReconciliationResult {
  qrisTotal: number;
  voiceCashEstimate: number;
  closingReportTotal: number;
  varianceAmount: number;
  status: Extract<SessionStatus, "RECONCILED" | "FLAGGED">;
}

import { db } from "@/lib/db";

// Lightweight helper: write an AuditLog entry from any server-side route.
//
// Always best-effort — the caller must wrap with `.catch(() => {})` so a
// logging failure never blocks the primary action (reconciliation, savings
// confirm/decline, etc.).
//
// Privacy rule (BOB_BRIEF.md): `detail` must be a short human-readable
// summary only. Never pass raw audio data, full transaction payloads, or PII.

export interface AuditLogEntry {
  agentName: "Listener" | "Payment-Event" | "Reconciliation" | "Radar Tetangga" | "Growth";
  action: string;
  entityId: string;
  merchantId?: string;
  detail?: string;
}

export function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  return db.auditLog
    .create({ data: entry })
    .then(() => undefined);
}

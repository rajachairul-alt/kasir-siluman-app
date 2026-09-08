"use client";

import { useEffect, useState } from "react";

// Owner Dashboard (PRD section 7 & section 10, Feature Breakdown, P0).
//
// PRD section 4 (Core Concept & Trust Highlight) is explicit: a gap between
// the independently-captured totals and the seller's closing report must be
// shown "apa adanya" to the owner — not buried, not smoothed over.
// FLAGGED sessions therefore appear as a prominent alert above everything
// else, not just as a coloured row inside a table.

interface Merchant {
  id: string;
  name: string;
}

interface AuditLogEntry {
  id: string;
  agentName: string;
  action: string;
  entityId: string;
  merchantId: string | null;
  detail: string | null;
  createdAt: string;
}

interface SavingsProposal {
  id: string;
  merchantId: string;
  month: string; // "YYYY-MM"
  netProfit: number;
  suggestedAmount: number;
  status: "PENDING_SELLER_CONFIRMATION" | "CONFIRMED" | "DECLINED";
  lockedUntil: string;
  createdAt: string;
}

interface LedgerRow {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  qrisTotal: number;
  voiceCashEstimate: number;
  closingReportTotal: number | null;
  varianceAmount: number | null;
  merchant: Merchant;
}

function rupiah(n: number) {
  return "Rp" + n.toLocaleString("id-ID");
}

function shortDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function currentMonth(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("id-ID", { month: "long", year: "numeric" });
}

export default function DashboardPage() {
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantFilter, setMerchantFilter] = useState<string>(""); // "" = all
  const [loading, setLoading] = useState(true);

  // ── Tabungan Bulanan state ────────────────────────────────────────────────
  const [savings, setSavings] = useState<SavingsProposal[]>([]);
  const [savingsLoading, setSavingsLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);

  // ── Audit Log state ───────────────────────────────────────────────────────
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);

  // Re-fetch whenever the merchant filter changes.
  useEffect(() => {
    setLoading(true);
    const url = merchantFilter
      ? `/api/ledger?merchantId=${encodeURIComponent(merchantFilter)}`
      : "/api/ledger";

    fetch(url)
      .then((r) => r.json())
      .then((data: { sessions: LedgerRow[]; merchants: Merchant[] }) => {
        setRows(data.sessions ?? []);
        // Only update the merchant list on the first load; it doesn't change
        // based on the filter and we don't want the dropdown to flicker.
        setMerchants((prev) => (prev.length ? prev : data.merchants ?? []));
      })
      .finally(() => setLoading(false));
  }, [merchantFilter]);

  // Fetch savings proposals when the merchant filter changes (same cadence as
  // the ledger fetch above, so summary numbers stay in sync).
  useEffect(() => {
    setSavingsLoading(true);
    const url = merchantFilter
      ? `/api/savings?merchantId=${encodeURIComponent(merchantFilter)}`
      : "/api/savings";

    fetch(url)
      .then((r) => r.json())
      .then((data: SavingsProposal[]) => setSavings(data ?? []))
      .catch(() => setSavings([]))
      .finally(() => setSavingsLoading(false));
  }, [merchantFilter]);

  // Fetch audit log whenever the merchant filter changes.
  useEffect(() => {
    setAuditLoading(true);
    const url = merchantFilter
      ? `/api/audit-log?merchantId=${encodeURIComponent(merchantFilter)}&limit=20`
      : "/api/audit-log?limit=20";

    fetch(url)
      .then((r) => r.json())
      .then((data: AuditLogEntry[]) => setAuditLogs(data ?? []))
      .catch(() => setAuditLogs([]))
      .finally(() => setAuditLoading(false));
  }, [merchantFilter]);

  // Generate proposals for all known merchants (or filtered one) for the
  // current month.  Idempotent: POST returns 200 if already generated.
  async function generateProposals() {
    const targets = merchantFilter ? [merchantFilter] : merchants.map((m) => m.id);
    if (targets.length === 0) return;
    setGenerateLoading(true);
    try {
      await Promise.all(
        targets.map((merchantId) =>
          fetch("/api/savings/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ merchantId, month: currentMonth() }),
          })
        )
      );
      // Re-fetch savings after generation so the summary card updates.
      const url = merchantFilter
        ? `/api/savings?merchantId=${encodeURIComponent(merchantFilter)}`
        : "/api/savings";
      const data: SavingsProposal[] = await fetch(url).then((r) => r.json());
      setSavings(data ?? []);
    } catch (err) {
      console.error("[generateProposals]", err);
    } finally {
      setGenerateLoading(false);
    }
  }

  const flaggedRows = rows.filter((r) => r.status === "FLAGGED");
  const flaggedCount = flaggedRows.length;
  const totalOmzet = rows.reduce((sum, r) => sum + r.qrisTotal + r.voiceCashEstimate, 0);

  // Sum of all CONFIRMED suggestedAmounts for the current month.
  const thisMonth = currentMonth();
  const confirmedSavingsThisMonth = savings
    .filter((p) => p.status === "CONFIRMED" && p.month === thisMonth)
    .reduce((sum, p) => sum + p.suggestedAmount, 0);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/owner-login";
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-5 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Kasir Siluman</h1>
          <p className="text-sm text-[#6B6458]">Tampilan pemilik — pantauan jarak jauh</p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-[#6B6458] shadow-sm transition hover:bg-black/5"
        >
          Keluar
        </button>
      </div>

      {/* ── FLAGGED alert banner ─────────────────────────────────────────────
          PRD section 4: gaps must be visible to the owner "as-is", not hidden
          in secondary table columns. Only rendered when there is at least one
          FLAGGED session in the current view. */}
      {!loading && flaggedCount > 0 && (
        <div className="mb-6 rounded-xl border-2 border-red-400 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-xl leading-none" aria-hidden>⚠️</span>
            <div className="flex-1">
              <p className="font-bold text-red-700">
                {flaggedCount} sesi perlu ditinjau
              </p>
              <p className="mt-0.5 text-xs text-red-600">
                Selisih antara estimasi tangkapan suara dan laporan tutup buku
                melebihi toleransi. Tinjau bersama pedagang.
              </p>

              {/* Per-session variance list — owner sees the amount without
                  having to scroll down or open any detail. */}
              <ul className="mt-3 flex flex-col gap-2">
                {flaggedRows.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-lg bg-red-100 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-red-800">
                      {r.merchant.name}
                    </span>
                    <span className="text-xs text-red-600">
                      {shortDate(r.closedAt)}
                    </span>
                    <span className="ml-auto font-bold text-red-700">
                      Selisih {rupiah(r.varianceAmount ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-navy/15 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#6B6458]">Total omzet tercatat</p>
          <p className="mt-1 text-xl font-bold text-navy">{rupiah(totalOmzet)}</p>
        </div>

        {/* This card intentionally mirrors the alert banner: red when there
            are flagged sessions, neutral when all is clean. */}
        <div
          className={`rounded-xl border p-4 ${
            flaggedCount > 0
              ? "border-red-400/60 bg-red-50"
              : "border-navy/15 bg-white"
          }`}
        >
          <p
            className={`text-xs uppercase tracking-wide ${
              flaggedCount > 0 ? "text-red-600" : "text-[#6B6458]"
            }`}
          >
            Sesi perlu ditinjau
          </p>
          <p
            className={`mt-1 text-xl font-bold ${
              flaggedCount > 0 ? "text-red-700" : "text-[#6B6458]"
            }`}
          >
            {flaggedCount}
          </p>
        </div>

        {/* Third card: confirmed savings this month */}
        <div className="col-span-2 rounded-xl border border-teal/30 bg-teal/5 p-4 sm:col-span-1">
          <p className="text-xs uppercase tracking-wide text-teal">
            Tabungan dikonfirmasi
          </p>
          <p className="mt-0.5 text-xs text-[#6B6458]">{formatMonth(thisMonth)}</p>
          <p className="mt-1 text-xl font-bold text-teal">
            {savingsLoading ? "…" : rupiah(confirmedSavingsThisMonth)}
          </p>
          {/* Generate button — idempotent, safe to press multiple times */}
          <button
            onClick={generateProposals}
            disabled={generateLoading || merchants.length === 0}
            className="mt-3 w-full rounded-lg bg-teal px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {generateLoading ? "Membuat…" : "Generate proposal bulan ini"}
          </button>
        </div>
      </div>

      {/* ── Merchant filter ──────────────────────────────────────────────────
          Prepared now; works even with a single merchant in the demo.
          The dropdown is only shown once the merchant list has loaded. */}
      {merchants.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <label htmlFor="merchant-filter" className="text-sm text-[#6B6458] whitespace-nowrap">
            Filter pedagang:
          </label>
          <select
            id="merchant-filter"
            value={merchantFilter}
            onChange={(e) => setMerchantFilter(e.target.value)}
            className="rounded-lg border border-navy/20 px-3 py-1.5 text-sm"
          >
            <option value="">Semua pedagang</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ── Session table ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-navy/15 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-navy text-left text-white">
            <tr>
              <th className="px-3 py-2">Pedagang</th>
              <th className="px-3 py-2">Ditutup</th>
              <th className="px-3 py-2">QRIS</th>
              <th className="px-3 py-2">Suara</th>
              <th className="px-3 py-2">Tutup Buku</th>
              <th className="px-3 py-2">Selisih</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                className={
                  r.status === "FLAGGED"
                    ? "bg-red-50"
                    : i % 2 === 1
                    ? "bg-light"
                    : ""
                }
              >
                <td className="px-3 py-2">{r.merchant.name}</td>
                <td className="px-3 py-2">{shortDate(r.closedAt)}</td>
                <td className="px-3 py-2">{rupiah(r.qrisTotal)}</td>
                <td className="px-3 py-2">{rupiah(r.voiceCashEstimate)}</td>
                <td className="px-3 py-2">{rupiah(r.closingReportTotal ?? 0)}</td>
                <td
                  className={`px-3 py-2 font-medium ${
                    r.status === "FLAGGED" ? "text-red-700" : ""
                  }`}
                >
                  {rupiah(r.varianceAmount ?? 0)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      r.status === "RECONCILED"
                        ? "bg-teal/15 text-teal"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {r.status === "RECONCILED" ? "Cocok ✓" : "⚠ Selisih"}
                  </span>
                </td>
              </tr>
            ))}
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[#6B6458]">
                  Memuat…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[#6B6458]">
                  Belum ada sesi yang ditutup
                  {merchantFilter ? " untuk pedagang ini" : ""}. Buka /session untuk mulai demo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Audit Log panel ─────────────────────────────────────────────────
          Governance layer: every reconciliation decision and savings status
          change appears here — proof that the watsonx Orchestrate layer is
          recording decisions, not just routing them.
          Data comes from GET /api/audit-log (public read-only proxy). */}
      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-navy">
          Log Keputusan Agent
        </h2>
        <p className="mb-3 text-xs text-[#6B6458]">
          Setiap rekonsiliasi sesi dan perubahan status tabungan dicatat di sini
          secara otomatis — ini yang ditampilkan sebagai bukti "governance layer"
          watsonx Orchestrate kepada juri.
        </p>

        <div className="overflow-x-auto rounded-xl border border-navy/15 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-navy text-left text-white">
              <tr>
                <th className="px-3 py-2">Waktu</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Ringkasan</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log, i) => (
                <tr
                  key={log.id}
                  className={i % 2 === 1 ? "bg-light" : ""}
                >
                  <td className="px-3 py-2 tabular-nums text-[#6B6458]">
                    {shortDate(log.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy">
                      {log.agentName}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
                  <td className="px-3 py-2 text-[#6B6458]">{log.detail ?? "—"}</td>
                </tr>
              ))}
              {auditLoading && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#6B6458]">
                    Memuat log…
                  </td>
                </tr>
              )}
              {!auditLoading && auditLogs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#6B6458]">
                    Belum ada entri log. Tutup satu sesi atau confirm/decline
                    proposal tabungan untuk melihat log pertama.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Riwayat Tabungan Bulanan ─────────────────────────────────────────
          Data already in `savings` state (fetched from /api/savings, filtered
          by merchantFilter). Sorted newest-first by parsing the "YYYY-MM"
          month string — no extra fetch needed. */}
      <div className="mt-8">
        <h2 className="mb-3 text-base font-semibold text-navy">
          Riwayat Tabungan Bulanan
        </h2>

        <div className="overflow-x-auto rounded-xl border border-navy/15 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-navy text-left text-white">
              <tr>
                <th className="px-3 py-2">Bulan</th>
                <th className="px-3 py-2">Omzet tercatat</th>
                <th className="px-3 py-2">Saran tabungan</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...savings]
                .sort((a, b) => b.month.localeCompare(a.month))
                .map((p, i) => (
                  <tr key={p.id} className={i % 2 === 1 ? "bg-light" : ""}>
                    <td className="px-3 py-2 font-medium">{formatMonth(p.month)}</td>
                    <td className="px-3 py-2">{rupiah(p.netProfit)}</td>
                    <td className="px-3 py-2">{rupiah(p.suggestedAmount)}</td>
                    <td className="px-3 py-2">
                      {p.status === "CONFIRMED" && (
                        <span className="rounded-full bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal">
                          Dikonfirmasi ✓
                        </span>
                      )}
                      {p.status === "DECLINED" && (
                        <span className="rounded-full bg-[#6B6458]/15 px-2 py-0.5 text-xs font-semibold text-[#6B6458]">
                          Ditolak
                        </span>
                      )}
                      {p.status === "PENDING_SELLER_CONFIRMATION" && (
                        <span className="rounded-full bg-orange/15 px-2 py-0.5 text-xs font-semibold text-orange">
                          Menunggu konfirmasi
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              {savingsLoading && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#6B6458]">
                    Memuat…
                  </td>
                </tr>
              )}
              {!savingsLoading && savings.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-[#6B6458]">
                    Belum ada riwayat tabungan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

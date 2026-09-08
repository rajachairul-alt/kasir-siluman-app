"use client";

import { useEffect, useState } from "react";

// Owner Dashboard (PRD section 7 & section 10, Feature Breakdown, P0).
//
// PRD section 4 (Core Concept & Trust Highlight) is explicit: a gap between
// the independently-captured totals and the seller's closing report must be
// shown "apa adanya" to the owner — not buried, not smoothed over.
// FLAGGED sessions therefore appear as a prominent alert above everything
// else, not just as a coloured row inside a table.
//
// NOTE ON THIS FILE: only the visual layer (JSX markup / Tailwind classes)
// was redesigned — this pass restyles the layout as a sidebar + topbar admin
// dashboard (referencing the "BankDash" Figma admin-dashboard UI kit: white
// card panels on a cool light-gray canvas, pastel icon-circle stat tiles,
// quiet tables with pill status badges). All state, effects, handlers, and
// business logic are unchanged from the original implementation.

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

// ── Shared visual primitives ──────────────────────────────────────────────
function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.08)] ${className}`}
    >
      {children}
    </div>
  );
}

function SectionHeading({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-start gap-2.5">
      <IconCircle tone="navy">{icon}</IconCircle>
      <div className="pt-0.5">
        <h2 className="text-base font-bold text-navy">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "RECONCILED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">
        ✓ Cocok
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
      ⚠ Selisih
    </span>
  );
}

type Tone = "navy" | "teal" | "orange" | "red" | "slate";

const toneClasses: Record<Tone, string> = {
  navy: "bg-navy/10 text-navy",
  teal: "bg-teal/10 text-teal",
  orange: "bg-orange/10 text-orange",
  red: "bg-red-50 text-red-500",
  slate: "bg-slate-100 text-slate-500",
};

function IconCircle({ children, tone = "navy" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base ${toneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

function StatCard({
  icon,
  tone,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: string;
  tone: Tone;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <Panel className={`p-4 ${highlight ? "border-red-200" : ""}`}>
      <div className="flex items-center gap-3">
        <IconCircle tone={tone}>{icon}</IconCircle>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-400">{label}</p>
          <p className={`text-lg font-bold ${highlight ? "text-red-600" : "text-navy"}`}>{value}</p>
        </div>
      </div>
      {sub && <p className="mt-2 text-[11px] text-slate-400">{sub}</p>}
    </Panel>
  );
}

const NAV_ITEMS = [
  { href: "#ringkasan", icon: "🏠", label: "Ringkasan" },
  { href: "#sesi", icon: "🧾", label: "Sesi Pedagang" },
  { href: "#log-agent", icon: "🛡️", label: "Log Keputusan Agent" },
  { href: "#tabungan", icon: "💰", label: "Tabungan Bulanan" },
];

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
    <div className="min-h-screen bg-[#F3F5FB]">
      <div className="mx-auto flex min-h-screen max-w-[1400px]">
        {/* ── Sidebar (BankDash-style: logo, nav list with icon + label) ── */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-100 bg-white px-5 py-6 lg:flex">
          <div className="mb-8 flex items-center gap-2.5 px-1">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy text-lg text-white shadow-sm shadow-navy/20">
              👑
            </span>
            <span className="text-lg font-extrabold tracking-tight text-navy">Kasir Siluman.</span>
          </div>

          <nav className="flex flex-1 flex-col gap-1">
            {NAV_ITEMS.map((item, i) => (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  i === 0
                    ? "border-l-[3px] border-navy bg-navy/[0.06] text-navy"
                    : "border-l-[3px] border-transparent text-slate-500 hover:bg-slate-50 hover:text-navy"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </a>
            ))}
          </nav>

          <button
            onClick={handleLogout}
            className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-slate-50 hover:text-red-500"
          >
            <span className="text-base">🚪</span>
            Keluar
          </button>
        </aside>

        {/* ── Main column ── */}
        <main className="min-h-screen flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          {/* ── Topbar ── */}
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h1 id="ringkasan" className="scroll-mt-6 text-2xl font-extrabold text-navy">
                Ringkasan
              </h1>
              <p className="mt-0.5 text-xs text-slate-400">Tampilan pemilik — pantauan jarak jauh</p>
            </div>
            <div className="flex items-center gap-2.5">
              {flaggedCount > 0 && (
                <span className="hidden items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 sm:flex">
                  🔔 {flaggedCount} perlu ditinjau
                </span>
              )}
              <button
                onClick={handleLogout}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-500 shadow-sm transition hover:bg-slate-50 lg:hidden"
                title="Keluar"
              >
                🚪
              </button>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-sm text-white shadow-sm">
                👑
              </span>
            </div>
          </div>

          {/* ── FLAGGED alert banner ─────────────────────────────────────────────
              PRD section 4: gaps must be visible to the owner "as-is", not hidden
              in secondary table columns. Only rendered when there is at least one
              FLAGGED session in the current view. */}
          {!loading && flaggedCount > 0 && (
            <div className="mb-6 rounded-2xl border-2 border-red-200 bg-red-50/70 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <IconCircle tone="red">⚠️</IconCircle>
                <div className="flex-1">
                  <p className="font-bold text-red-700">{flaggedCount} sesi perlu ditinjau</p>
                  <p className="mt-0.5 text-xs text-red-500">
                    Selisih antara estimasi tangkapan suara dan laporan tutup buku melebihi
                    toleransi. Tinjau bersama pedagang.
                  </p>

                  {/* Per-session variance list — owner sees the amount without
                      having to scroll down or open any detail. */}
                  <ul className="mt-3 flex flex-col gap-2">
                    {flaggedRows.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-xl bg-white px-3.5 py-2.5 text-sm shadow-sm"
                      >
                        <span className="font-semibold text-red-700">{r.merchant.name}</span>
                        <span className="text-xs text-red-400">{shortDate(r.closedAt)}</span>
                        <span className="ml-auto font-bold text-red-600">
                          Selisih {rupiah(r.varianceAmount ?? 0)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ── Summary stat cards ──────────────────────────────────────────────── */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard icon="💵" tone="navy" label="Total omzet tercatat" value={rupiah(totalOmzet)} />
            <StatCard icon="🧾" tone="slate" label="Total sesi tercatat" value={String(rows.length)} />
            <StatCard
              icon="⚠️"
              tone={flaggedCount > 0 ? "red" : "slate"}
              label="Sesi perlu ditinjau"
              value={String(flaggedCount)}
              highlight={flaggedCount > 0}
            />
            <Panel className="p-4">
              <div className="flex items-center gap-3">
                <IconCircle tone="teal">💰</IconCircle>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-400">Tabungan dikonfirmasi</p>
                  <p className="text-lg font-bold text-teal">
                    {savingsLoading ? "…" : rupiah(confirmedSavingsThisMonth)}
                  </p>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{formatMonth(thisMonth)}</p>
              <button
                onClick={generateProposals}
                disabled={generateLoading || merchants.length === 0}
                className="mt-3 w-full rounded-xl bg-teal px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-teal/30 transition hover:bg-teal/90 disabled:opacity-50"
              >
                {generateLoading ? "Membuat…" : "Generate proposal bulan ini"}
              </button>
            </Panel>
          </div>

          {/* ── Merchant filter ──────────────────────────────────────────────────
              Prepared now; works even with a single merchant in the demo.
              The dropdown is only shown once the merchant list has loaded. */}
          {merchants.length > 1 && (
            <div className="mb-4 flex items-center gap-3">
              <label htmlFor="merchant-filter" className="whitespace-nowrap text-sm text-slate-500">
                Filter pedagang:
              </label>
              <select
                id="merchant-filter"
                value={merchantFilter}
                onChange={(e) => setMerchantFilter(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm outline-none transition focus:border-navy/40 focus:ring-2 focus:ring-navy/10"
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
          <h2 id="sesi" className="mb-3 scroll-mt-6 text-base font-bold text-navy">
            Sesi Pedagang
          </h2>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3">Pedagang</th>
                    <th className="px-4 py-3">Ditutup</th>
                    <th className="px-4 py-3">QRIS</th>
                    <th className="px-4 py-3">Suara</th>
                    <th className="px-4 py-3">Tutup Buku</th>
                    <th className="px-4 py-3">Selisih</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={`transition hover:bg-slate-50 ${
                        r.status === "FLAGGED" ? "bg-red-50/40" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-navy">{r.merchant.name}</td>
                      <td className="px-4 py-2.5 text-slate-500">{shortDate(r.closedAt)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{rupiah(r.qrisTotal)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{rupiah(r.voiceCashEstimate)}</td>
                      <td className="px-4 py-2.5 text-slate-500">
                        {rupiah(r.closingReportTotal ?? 0)}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-semibold ${
                          r.status === "FLAGGED" ? "text-red-600" : "text-navy"
                        }`}
                      >
                        {rupiah(r.varianceAmount ?? 0)}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  ))}
                  {loading && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        Memuat…
                      </td>
                    </tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        Belum ada sesi yang ditutup
                        {merchantFilter ? " untuk pedagang ini" : ""}. Buka /session untuk mulai demo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* ── Audit Log panel ─────────────────────────────────────────────────
              Governance layer: every reconciliation decision and savings status
              change appears here — proof that the watsonx Orchestrate layer is
              recording decisions, not just routing them.
              Data comes from GET /api/audit-log (public read-only proxy). */}
          <div className="mt-8">
            <SectionHeading
              icon="🛡️"
              title="Log Keputusan Agent"
              subtitle={
                'Setiap rekonsiliasi sesi dan perubahan status tabungan dicatat di sini secara otomatis — ini yang ditampilkan sebagai bukti "governance layer" watsonx Orchestrate kepada juri.'
              }
            />

            <Panel>
              <div className="overflow-x-auto">
                <table id="log-agent" className="w-full scroll-mt-6 text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Waktu</th>
                      <th className="px-4 py-3">Agent</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Ringkasan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="transition hover:bg-slate-50">
                        <td className="px-4 py-2.5 tabular-nums text-slate-400">
                          {shortDate(log.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="rounded-full bg-navy/10 px-2.5 py-1 text-xs font-semibold text-navy">
                            {log.agentName}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{log.action}</td>
                        <td className="px-4 py-2.5 text-slate-500">{log.detail ?? "—"}</td>
                      </tr>
                    ))}
                    {auditLoading && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                          Memuat log…
                        </td>
                      </tr>
                    )}
                    {!auditLoading && auditLogs.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                          Belum ada entri log. Tutup satu sesi atau confirm/decline proposal
                          tabungan untuk melihat log pertama.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          {/* ── Riwayat Tabungan Bulanan ─────────────────────────────────────────
              Data already in `savings` state (fetched from /api/savings, filtered
              by merchantFilter). Sorted newest-first by parsing the "YYYY-MM"
              month string — no extra fetch needed. */}
          <div className="mt-8">
            <SectionHeading icon="💰" title="Riwayat Tabungan Bulanan" />

            <Panel>
              <div className="overflow-x-auto">
                <table id="tabungan" className="w-full scroll-mt-6 text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="px-4 py-3">Bulan</th>
                      <th className="px-4 py-3">Omzet tercatat</th>
                      <th className="px-4 py-3">Saran tabungan</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...savings]
                      .sort((a, b) => b.month.localeCompare(a.month))
                      .map((p) => (
                        <tr key={p.id} className="transition hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium text-navy">{formatMonth(p.month)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{rupiah(p.netProfit)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{rupiah(p.suggestedAmount)}</td>
                          <td className="px-4 py-2.5">
                            {p.status === "CONFIRMED" && (
                              <span className="rounded-full bg-teal/10 px-2.5 py-1 text-xs font-semibold text-teal">
                                Dikonfirmasi ✓
                              </span>
                            )}
                            {p.status === "DECLINED" && (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                Ditolak
                              </span>
                            )}
                            {p.status === "PENDING_SELLER_CONFIRMATION" && (
                              <span className="rounded-full bg-orange/10 px-2.5 py-1 text-xs font-semibold text-orange">
                                Menunggu konfirmasi
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    {savingsLoading && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                          Memuat…
                        </td>
                      </tr>
                    )}
                    {!savingsLoading && savings.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                          Belum ada riwayat tabungan.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </main>
      </div>
    </div>
  );
}

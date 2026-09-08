"use client";

import { useEffect, useRef, useState } from "react";
import { extractFromAudio } from "@/lib/voiceToTransaction";
import { getNeighborhoodPricing, type NeighborhoodPricing } from "@/lib/radarTetangga";
import { generatePromo, type PromoResult } from "@/lib/generativePromo";

// Seller-facing "Client Companion App" (PRD section 7, System Architecture).
//
// What's real here: opening/closing a session, logging transactions, and
// the reconciliation call — all backed by the API routes and the SQLite
// database.
//
// What's a stand-in for the hackathon demo, clearly marked below and
// handed off in BOB_BRIEF.md:
//   - the "Simulasikan QRIS" button stands in for the real QRIS webhook
//   - the voice recording panel calls extractFromAudio() from
//     src/lib/voiceToTransaction.ts, which currently throws until the
//     Langflow endpoint is wired in (see that file for the wiring guide)
//
// PRIVACY CONSTRAINT (BOB_BRIEF.md): the microphone may only be active
// while the session is OPEN.  This is enforced in two places:
//   1. The "Rekam" button is only rendered when isOpen === true.
//   2. The useEffect that watches `isOpen` calls stopRecording() and
//      releases the MediaStream the moment the session leaves OPEN status.
//
// NOTE ON THIS FILE: only the visual layer (JSX markup / Tailwind classes)
// was redesigned — this pass adopts the same "BankDash" Figma admin-kit
// visual language used on /dashboard (cool light-gray canvas, white rounded
// cards, pastel icon-circle tiles, pill badges) in a compact topbar layout
// suited to a phone screen at a food cart. All state, effects, handlers, and
// business logic are unchanged from the original implementation.

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

interface Transaction {
  id: string;
  source: "qris" | "voice";
  amount: number;
  itemLabel?: string | null;
  timestamp: string;
}

interface SessionState {
  id: string;
  status: string;
  qrisTotal: number;
  voiceCashEstimate: number;
  closingReportTotal: number | null;
  varianceAmount: number | null;
  transactions: Transaction[];
}

type RecordingStatus =
  | "idle"       // mic not active
  | "requesting" // waiting for getUserMedia permission
  | "recording"  // MediaRecorder running, capturing audio
  | "processing" // extractFromAudio() in flight
  | "error";     // last attempt failed — message stored in voiceError

type RadarStatus =
  | "inactive"          // pipeline not yet wired — shown as honest placeholder
  | "loading"           // getNeighborhoodPricing() in flight
  | "ready"             // result available
  | "insufficient-data" // pipeline suppressed the result (sampleSize < 2)
  | "error";            // call failed

type PromoStatus =
  | "inactive"   // pipeline not yet wired — shown as honest placeholder
  | "loading"    // context fetch + generatePromo() in flight
  | "ready"      // result available
  | "error";     // call failed

// Shape returned by GET /api/savings
interface SavingsProposal {
  id: string;
  merchantId: string;
  month: string;         // "YYYY-MM"
  netProfit: number;     // stored as revenue proxy — see reconciliation.ts
  suggestedAmount: number;
  status: "PENDING_SELLER_CONFIRMATION" | "CONFIRMED" | "DECLINED";
  lockedUntil: string;
  createdAt: string;
}

function rupiah(n: number) {
  return "Rp" + n.toLocaleString("id-ID");
}

function formatMonth(ym: string): string {
  const [year, month] = ym.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleString("id-ID", { month: "long", year: "numeric" });
}

// ── Shared visual primitives ──────────────────────────────────────────────
function SectionCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_-12px_rgba(15,23,42,0.08)] ${className}`}
    >
      {children}
    </div>
  );
}

function EyebrowLabel({
  children,
  tone = "navy",
}: {
  children: React.ReactNode;
  tone?: "navy" | "orange" | "teal";
}) {
  const toneClass =
    tone === "orange" ? "text-orange" : tone === "teal" ? "text-teal" : "text-navy";
  return (
    <p className={`text-[11px] font-bold uppercase tracking-wider ${toneClass}`}>{children}</p>
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

export default function SessionPage() {
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState<string>("");
  const [session, setSession] = useState<SessionState | null>(null);
  const [qrisAmount, setQrisAmount] = useState("15000");
  const [closingTotal, setClosingTotal] = useState("");
  const [result, setResult] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(false);

  // ── Voice recording state ─────────────────────────────────────────────────
  const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [lastVoiceResult, setLastVoiceResult] = useState<string | null>(null);

  // ── Radar Tetangga state ──────────────────────────────────────────────────
  const [radarStatus, setRadarStatus] = useState<RadarStatus>("inactive");
  const [radarResult, setRadarResult] = useState<NeighborhoodPricing | null>(null);
  const [radarQuery, setRadarQuery] = useState(""); // item label to look up

  // ── Generative Promo state ────────────────────────────────────────────────
  const [promoStatus, setPromoStatus] = useState<PromoStatus>("inactive");
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);

  // ── Tabungan bulanan state ────────────────────────────────────────────────
  const [pendingSavings, setPendingSavings] = useState<SavingsProposal | null>(null);
  const [savingsActionLoading, setSavingsActionLoading] = useState(false);

  // Refs hold the live MediaRecorder/MediaStream so the cleanup effect can
  // reach them without stale closure issues.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const isOpen = session?.status === "OPEN";

  // ── Identitas pedagang dari cookie login (lihat /login) ────────────────────
  useEffect(() => {
    setMerchantId(readCookie("ks_merchant_id"));
    setMerchantName(readCookie("ks_merchant_name") ?? "");
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  // ── PRIVACY ENFORCEMENT ───────────────────────────────────────────────────
  // Stop and release the microphone the instant the session is no longer OPEN.
  // This covers two paths: explicit "Tutup Buku" and any external status change
  // picked up by refreshSession().
  useEffect(() => {
    if (!isOpen) {
      stopRecording();
    }
  }, [isOpen]);

  // Also clean up on component unmount.
  useEffect(() => {
    return () => stopRecording();
  }, []);

  // ── Fetch pending savings proposal on mount ───────────────────────────────
  useEffect(() => {
    if (!merchantId) return;
    fetch(`/api/savings?merchantId=${encodeURIComponent(merchantId)}`)
      .then((r) => r.json())
      .then((proposals: SavingsProposal[]) => {
        const pending = proposals.find(
          (p) => p.status === "PENDING_SELLER_CONFIRMATION"
        ) ?? null;
        setPendingSavings(pending);
      })
      .catch(() => {
        // Non-critical — savings panel stays hidden on fetch error.
      });
  }, [merchantId]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    // Only reset to idle if we're not already in the middle of processing;
    // processing is ended by its own branch below.
    setRecordingStatus((prev) => (prev === "processing" ? prev : "idle"));
  }

  async function refreshSession(id: string) {
    const res = await fetch(`/api/session`);
    const all: SessionState[] = await res.json();
    const found = all.find((s) => s.id === id);
    if (found) setSession(found);
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────
  async function bukaLapak() {
    if (!merchantId) return;
    setLoading(true);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId }),
    });
    const data = await res.json();
    setSession({ ...data, transactions: [] });
    setResult(null);
    setLoading(false);
  }

  async function simulateQris() {
    if (!session) return;
    await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: session.id,
        source: "qris",
        amount: Number(qrisAmount),
      }),
    });
    refreshSession(session.id);
  }

  async function tutupBuku(closingReportTotal: number) {
    if (!session) return;
    setLoading(true);
    const res = await fetch(`/api/session/${session.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closingReportTotal }),
    });
    const data = await res.json();
    setResult(data);
    setSession(data);
    // Mic is released by the isOpen useEffect above once status changes.
    setLoading(false);
  }

  async function tutupBukuManual() {
    if (!closingTotal) return;
    await tutupBuku(Number(closingTotal));
  }

  // ── Voice recording & extraction ──────────────────────────────────────────
  async function startRecording() {
    if (!isOpen) return; // guard: mic only during OPEN session
    setVoiceError(null);
    setLastVoiceResult(null);
    setRecordingStatus("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError("Izin mikrofon ditolak atau tidak tersedia.");
      setRecordingStatus("error");
      return;
    }

    // Double-check session is still OPEN after the async permission prompt.
    // The user might have closed the session in another tab during the prompt.
    if (!isOpen) {
      stream.getTracks().forEach((t) => t.stop());
      setRecordingStatus("idle");
      return;
    }

    mediaStreamRef.current = stream;
    audioChunksRef.current = [];

    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      // Release the mic tracks immediately — audio is only held in memory as
      // a Blob for the duration of extractFromAudio(), then discarded.
      stream.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;

      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];

      if (chunks.length === 0) {
        setRecordingStatus("idle");
        return;
      }

      // Build the blob in-memory.  This is the ONLY form audio ever takes
      // in this app — it is never uploaded separately or stored.
      const audioBlob = new Blob(chunks, { type: recorder.mimeType });

      setRecordingStatus("processing");

      try {
        const extraction = await extractFromAudio(audioBlob);
        // audioBlob goes out of scope here and will be GC'd — not persisted.

        if (extraction.isClosingReport) {
          // Seller said a "tutup buku" phrase.
          if (extraction.amount !== undefined) {
            setLastVoiceResult(
              `Terdeteksi tutup buku: ${rupiah(extraction.amount)}. Menutup sesi…`
            );
            await tutupBuku(extraction.amount);
          } else {
            // Closing phrase detected but no amount — fall back to manual input.
            setLastVoiceResult(
              "Terdeteksi frasa tutup buku, tapi jumlah tidak jelas. " +
                "Masukkan total di kolom Tutup Buku."
            );
          }
        } else if (extraction.amount !== undefined) {
          // Regular price capture.
          await fetch("/api/transactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: session!.id,
              source: "voice",
              amount: extraction.amount,
              itemLabel: extraction.itemLabel,
              confidence: extraction.confidence,
            }),
          });
          setLastVoiceResult(
            `Dicatat: ${rupiah(extraction.amount)}` +
              (extraction.itemLabel ? ` (${extraction.itemLabel})` : "")
          );
          refreshSession(session!.id);
        } else {
          setLastVoiceResult("Tidak ada harga yang berhasil diekstrak dari ucapan ini.");
        }
        setRecordingStatus("idle");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Terjadi kesalahan tak dikenal.";
        setVoiceError(msg);
        setRecordingStatus("error");
      }
    };

    recorder.start();
    setRecordingStatus("recording");
  }

  function stopRecordingManually() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop(); // triggers recorder.onstop above
    }
  }

  // ── Radar Tetangga ────────────────────────────────────────────────────────
  async function queryRadar(itemLabel: string) {
    if (!itemLabel.trim()) return;
    setRadarStatus("loading");
    setRadarResult(null);
    try {
      const pricing = await getNeighborhoodPricing(itemLabel.trim());
      if (pricing === null) {
        // Fewer than 2 neighbouring merchants sold this item recently —
        // the pipeline suppressed the average rather than reveal a single
        // merchant's price. Show that honestly, not a zero or blank result.
        setRadarStatus("insufficient-data");
      } else {
        setRadarResult(pricing);
        setRadarStatus("ready");
      }
    } catch (err) {
      // Surface the error message honestly — never show fake data.
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan tak dikenal.";
      // If it's the "not wired yet" throw, keep status as inactive so the UI
      // shows the placeholder instead of an alarming error colour.
      if (msg.includes("Langflow belum disambungkan")) {
        setRadarStatus("inactive");
      } else {
        setRadarStatus("error");
      }
    }
  }

  // ── Tabungan Bulanan ──────────────────────────────────────────────────────
  async function confirmSavings() {
    if (!pendingSavings) return;
    setSavingsActionLoading(true);
    try {
      const res = await fetch(`/api/savings/${pendingSavings.id}/confirm`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[confirmSavings]", res.status, body);
        return;
      }
      const updated: SavingsProposal = await res.json();
      setPendingSavings(updated.status === "PENDING_SELLER_CONFIRMATION" ? updated : null);
    } catch (err) {
      console.error("[confirmSavings]", err);
    } finally {
      setSavingsActionLoading(false);
    }
  }

  async function declineSavings() {
    if (!pendingSavings) return;
    setSavingsActionLoading(true);
    try {
      const res = await fetch(`/api/savings/${pendingSavings.id}/decline`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("[declineSavings]", res.status, body);
        return;
      }
      // Proposal is now DECLINED — hide the panel.
      setPendingSavings(null);
    } catch (err) {
      console.error("[declineSavings]", err);
    } finally {
      setSavingsActionLoading(false);
    }
  }

  // ── Generative Promo ──────────────────────────────────────────────────────
  async function buatPromo() {
    if (!session) return;
    setPromoStatus("loading");
    setPromoResult(null);
    try {
      // Step 1: fetch aggregated context from the database — no manual input.
      const ctxRes = await fetch(
        `/api/promo/context?sessionId=${encodeURIComponent(session.id)}`
      );
      if (!ctxRes.ok) {
        throw new Error(`Context fetch gagal: ${ctxRes.status}`);
      }
      const context = await ctxRes.json();

      // Step 2: call the Langflow pipeline boundary.
      const promo = await generatePromo(context);
      setPromoResult(promo);
      setPromoStatus("ready");
    } catch (err) {
      // Pipeline is live — all errors go to "error" state, not "inactive".
      console.error("[buatPromo]", err);
      setPromoStatus("error");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F3F5FB]">
      <main className="mx-auto min-h-screen max-w-md px-4 pb-14 pt-5 sm:px-5">
        {/* ── Topbar (BankDash-style: icon-circle brand mark, title, avatar) ── */}
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Kasir Siluman" className="h-10 w-10 rounded-xl shadow-sm shadow-navy/20" />
            <div>
              <h1 className="text-sm font-extrabold leading-tight text-navy">Kasir Siluman</h1>
              <p className="text-xs text-slate-400">
                {merchantName ? `Lapak: ${merchantName}` : "Tampilan penjual"}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-navy"
            title="Keluar"
          >
            🚪
          </button>
        </div>

        {!session && (
          <button
            onClick={bukaLapak}
            disabled={loading || !merchantId}
            className="group flex w-full items-center gap-4 rounded-2xl bg-gradient-to-br from-navy to-[#152A40] px-5 py-5 text-left shadow-lg shadow-navy/25 transition active:scale-[0.99] disabled:opacity-50"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10 text-2xl">
              🏪
            </span>
            <span className="flex-1">
              <span className="block text-sm font-medium text-white/70">Langkah 1</span>
              <span className="block text-lg font-bold text-white">
                {loading ? "Membuka lapak…" : "Buka Lapak"}
              </span>
            </span>
            <span className="text-xl text-white/50 transition group-hover:translate-x-0.5">›</span>
          </button>
        )}

        {session && isOpen && (
          <div className="flex flex-col gap-4">
            {/* ── Sesi aktif summary — BankDash-style pastel icon-circle stat tiles ── */}
            <SectionCard>
              <div className="flex items-center justify-between">
                <EyebrowLabel>Sesi aktif</EyebrowLabel>
                <span className="flex items-center gap-1.5 rounded-full bg-teal/10 px-2.5 py-1 text-[11px] font-semibold text-teal">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                  Berjualan
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-3">
                  <IconCircle tone="teal">💳</IconCircle>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-400">QRIS</p>
                    <p className="truncate text-base font-bold text-navy">{rupiah(session.qrisTotal)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 p-3">
                  <IconCircle tone="navy">🎙</IconCircle>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-slate-400">Suara</p>
                    <p className="truncate text-base font-bold text-navy">
                      {rupiah(session.voiceCashEstimate)}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* ── Simulasi QRIS ── */}
            <SectionCard className="border-orange/20">
              <div className="flex items-start gap-2.5">
                <IconCircle tone="orange">⚠️</IconCircle>
                <div className="pt-0.5">
                  <EyebrowLabel tone="orange">Simulasi — bukan koneksi QRIS asli</EyebrowLabel>
                  <p className="mt-1 text-xs text-slate-400">
                    Tombol ini berdiri di tempat webhook QRIS asli. Lihat BOB_BRIEF.md.
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  value={qrisAmount}
                  onChange={(e) => setQrisAmount(e.target.value)}
                  className="w-28 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium outline-none transition focus:border-navy/40 focus:ring-2 focus:ring-navy/10"
                />
                <button
                  onClick={simulateQris}
                  className="flex-1 rounded-xl bg-teal px-3 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal/30 transition hover:bg-teal/90 active:scale-[0.99]"
                >
                  Simulasikan Pembayaran QRIS
                </button>
              </div>
            </SectionCard>

            {/* ── Voice capture panel ── */}
            <VoicePanel
              recordingStatus={recordingStatus}
              voiceError={voiceError}
              lastVoiceResult={lastVoiceResult}
              onStart={startRecording}
              onStop={stopRecordingManually}
            />

            {/* ── Radar Tetangga insight card ── */}
            <RadarTetanggaPanel
              status={radarStatus}
              result={radarResult}
              query={radarQuery}
              onQueryChange={setRadarQuery}
              onQuery={queryRadar}
            />

            {/* ── Generative Promo ── */}
            <PromoPanel status={promoStatus} result={promoResult} onGenerate={buatPromo} />

            {/* ── Tabungan Bulanan ── only shown when there is a pending proposal */}
            {pendingSavings && (
              <SavingsPanel
                proposal={pendingSavings}
                loading={savingsActionLoading}
                onConfirm={confirmSavings}
                onDecline={declineSavings}
              />
            )}

            {/* ── Daftar transaksi ── */}
            <SectionCard>
              <EyebrowLabel>Transaksi hari ini ({session.transactions.length})</EyebrowLabel>
              <ul className="mt-2 flex flex-col divide-y divide-slate-100">
                {session.transactions.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="flex items-center gap-2.5 text-slate-500">
                      <IconCircle tone={t.source === "qris" ? "teal" : "navy"}>
                        <span className="text-[11px] font-bold">{t.source === "qris" ? "Q" : "S"}</span>
                      </IconCircle>
                      <span>
                        {t.source === "qris" ? "QRIS" : "Suara"}
                        {t.itemLabel && <span className="text-xs text-slate-300"> · {t.itemLabel}</span>}
                      </span>
                    </span>
                    <span className="font-semibold text-navy">{rupiah(t.amount)}</span>
                  </li>
                ))}
                {session.transactions.length === 0 && (
                  <li className="py-3 text-center text-sm text-slate-300">Belum ada transaksi.</li>
                )}
              </ul>
            </SectionCard>

            {/* ── Tutup Buku manual ── */}
            <div className="rounded-2xl bg-gradient-to-br from-navy to-[#16283D] p-4 shadow-lg shadow-navy/20">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">
                Langkah 3 · Tutup Buku (manual)
              </p>
              <p className="mt-1 text-xs text-white/45">
                Atau ucapkan frasa &quot;tutup buku&quot; saat merekam — sistem akan menutup sesi
                otomatis.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="number"
                  placeholder="Total tunai yang dihitung"
                  value={closingTotal}
                  onChange={(e) => setClosingTotal(e.target.value)}
                  className="w-full rounded-xl border-0 bg-white/95 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-white/40"
                />
                <button
                  onClick={tutupBukuManual}
                  disabled={loading || !closingTotal}
                  className="shrink-0 rounded-xl bg-orange px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-orange/90 active:scale-[0.99] disabled:opacity-50"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Rekonsiliasi result ── */}
        {result && result.status !== "OPEN" && (
          <div
            className={`mt-5 rounded-2xl border p-4 shadow-sm ${
              result.status === "RECONCILED"
                ? "border-teal/25 bg-teal/[0.05]"
                : "border-red-200 bg-red-50/60"
            }`}
          >
            {/* Status title */}
            <div className="flex items-center gap-2.5">
              <IconCircle tone={result.status === "RECONCILED" ? "teal" : "red"}>
                {result.status === "RECONCILED" ? "✅" : "⚠️"}
              </IconCircle>
              <p
                className={`font-bold ${
                  result.status === "RECONCILED" ? "text-teal" : "text-red-600"
                }`}
              >
                {result.status === "RECONCILED" ? "Rekonsiliasi cocok" : "Ada selisih — FLAGGED"}
              </p>
            </div>

            {/* Category breakdown */}
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">Tutup buku (pedagang)</span>
                <span className="font-semibold text-navy">
                  {rupiah(result.closingReportTotal ?? 0)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-slate-400">Estimasi kas dari suara</span>
                <span className="font-semibold text-navy">{rupiah(result.voiceCashEstimate)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-slate-400">
                  QRIS{" "}
                  <span className="text-xs opacity-70">
                    — tidak dihitung dalam selisih, sudah terverifikasi otomatis
                  </span>
                </span>
                <span className="shrink-0 font-semibold text-navy">{rupiah(result.qrisTotal)}</span>
              </div>
            </div>

            {/* Variance row — more prominent */}
            <div
              className={`mt-3 border-t pt-3 ${
                result.status === "RECONCILED" ? "border-teal/15" : "border-red-200"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="font-semibold text-navy">Selisih</span>
                  <p className="text-xs text-slate-400">dihitung dari tutup buku vs. estimasi suara</p>
                </div>
                <span
                  className={`text-xl font-bold ${
                    result.status === "RECONCILED" ? "text-teal" : "text-red-600"
                  }`}
                >
                  {rupiah(result.varianceAmount ?? 0)}
                </span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── VoicePanel sub-component ──────────────────────────────────────────────────
// Extracted so JSX stays readable and the recording state machine is clear.

interface VoicePanelProps {
  recordingStatus: RecordingStatus;
  voiceError: string | null;
  lastVoiceResult: string | null;
  onStart: () => void;
  onStop: () => void;
}

function VoicePanel({
  recordingStatus,
  voiceError,
  lastVoiceResult,
  onStart,
  onStop,
}: VoicePanelProps) {
  const isRecording = recordingStatus === "recording";
  const isProcessing = recordingStatus === "processing";
  const isRequesting = recordingStatus === "requesting";
  const busy = isRecording || isProcessing || isRequesting;

  return (
    <SectionCard>
      <div className="flex items-start gap-2.5">
        <IconCircle tone="navy">🎙</IconCircle>
        <div className="pt-0.5">
          <EyebrowLabel>Langkah 2 · Rekam Harga / Tutup Buku</EyebrowLabel>
          <p className="mt-1 text-xs text-slate-400">
            Tekan Rekam, sebutkan harga atau ucapkan &quot;tutup buku&quot;, lalu tekan Berhenti.
            {/* TODO: remove this notice once Langflow is wired in */}{" "}
            <span className="font-medium text-orange">
              (Pipeline suara belum tersambung — lihat src/lib/voiceToTransaction.ts)
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex justify-center">
        {!isRecording ? (
          <button
            onClick={onStart}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-navy/20 transition hover:bg-navy/90 active:scale-[0.99] disabled:opacity-50"
          >
            <span className="text-base">🎙</span>
            {isRequesting ? "Meminta izin mikrofon…" : isProcessing ? "Memproses…" : "Rekam"}
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-red-500/30 transition active:scale-[0.99]"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            Berhenti (sedang merekam…)
          </button>
        )}
      </div>

      {lastVoiceResult && !voiceError && (
        <p className="mt-2.5 rounded-lg bg-teal/[0.08] px-3 py-2 text-xs font-medium text-teal">
          {lastVoiceResult}
        </p>
      )}

      {voiceError && (
        <p className="mt-2.5 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          Gagal: {voiceError}
        </p>
      )}
    </SectionCard>
  );
}

// ── RadarTetanggaPanel sub-component ─────────────────────────────────────────
// Shows neighbourhood average pricing for a given item label.
//
// AGGREGATION CONSTRAINT: this panel may only display aggregate data returned
// by getNeighborhoodPricing().  It must never be modified to show individual
// merchant prices — see src/lib/radarTetangga.ts for the full constraint note.

interface RadarTetanggaPanelProps {
  status: RadarStatus;
  result: NeighborhoodPricing | null;
  query: string;
  onQueryChange: (v: string) => void;
  onQuery: (itemLabel: string) => void;
}

function RadarTetanggaPanel({
  status,
  result,
  query,
  onQueryChange,
  onQuery,
}: RadarTetanggaPanelProps) {
  return (
    <SectionCard>
      <div className="flex items-start gap-2.5">
        <IconCircle tone="teal">📡</IconCircle>
        <div className="pt-0.5">
          <EyebrowLabel>Radar Tetangga</EyebrowLabel>
          <p className="mt-1 text-xs text-slate-400">
            Rata-rata harga barang serupa di sekitar lapak Anda, dari data agregat anonim.
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="mis. bakso, es teh"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onQuery(query)}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-navy/40 focus:ring-2 focus:ring-navy/10"
          disabled={status === "loading"}
        />
        <button
          onClick={() => onQuery(query)}
          disabled={!query.trim() || status === "loading"}
          className="rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy/90 disabled:opacity-50"
        >
          {status === "loading" ? "…" : "Cek"}
        </button>
      </div>

      {/* ── Result states ── */}
      {status === "inactive" && (
        <p className="mt-3 text-xs text-slate-400">
          {/* Honest placeholder — no fake data. */}
          Radar Tetangga belum aktif — menunggu pipeline Langflow
          ({/* TODO: remove once wired in */}
          <span className="font-medium">LANGFLOW_RADAR_TETANGGA_FLOW_ID</span>).
        </p>
      )}

      {status === "loading" && (
        <p className="mt-3 text-xs text-slate-400">Mencari data sekitar…</p>
      )}

      {status === "ready" && result && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3">
          <p className="text-sm font-semibold text-navy">{result.itemLabel}</p>
          <p className="mt-0.5 text-xl font-bold text-navy">{rupiah(result.averagePrice)}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            rata-rata dari {result.sampleSize} pedagang sekitar
            {result.radius ? ` (radius ${result.radius})` : ""}
          </p>
        </div>
      )}

      {status === "insufficient-data" && (
        <p className="mt-3 text-xs text-slate-400">
          Belum cukup data dari pedagang sekitar untuk barang ini (minimal 2
          pedagang lain). Coba lagi nanti setelah lebih banyak transaksi tercatat.
        </p>
      )}

      {status === "error" && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          Gagal mengambil data radar. Coba lagi.
        </p>
      )}
    </SectionCard>
  );
}

// ── PromoPanel sub-component ──────────────────────────────────────────────────
// Triggers context aggregation + Generative Promo pipeline, displays result.
//
// Context is always built from real Transaction data via /api/promo/context —
// never from text typed in by the seller.  See src/lib/generativePromo.ts.

interface PromoPanelProps {
  status: PromoStatus;
  result: PromoResult | null;
  onGenerate: () => void;
}

function PromoPanel({ status, result, onGenerate }: PromoPanelProps) {
  return (
    <SectionCard>
      <div className="flex items-start gap-2.5">
        <IconCircle tone="orange">✨</IconCircle>
        <div className="pt-0.5">
          <EyebrowLabel>Buat Promo</EyebrowLabel>
          <p className="mt-1 text-xs text-slate-400">
            Buat teks poster dan prompt gambar dari data penjualan terbaru Anda.
          </p>
        </div>
      </div>

      <button
        onClick={onGenerate}
        disabled={status === "loading"}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy/90 active:scale-[0.99] disabled:opacity-50"
      >
        <span>✨</span>
        {status === "loading" ? "Sedang membuat promo…" : "Buat Promo"}
      </button>

      {/* ── Result states ── */}
      {status === "inactive" && (
        <p className="mt-3 text-xs text-slate-400">
          Tekan tombol di atas untuk membuat teks promo dari data penjualan terbaru.
        </p>
      )}

      {status === "loading" && (
        <p className="mt-3 text-xs text-slate-400">Mengambil konteks dan membuat promo…</p>
      )}

      {status === "ready" && result && (
        <div className="mt-3 flex flex-col gap-3">
          {/* Poster copy */}
          <div className="rounded-xl bg-slate-50 px-3.5 py-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Teks Poster
            </p>
            <p className="whitespace-pre-wrap text-sm text-navy">{result.posterText}</p>
          </div>

          {/* Image prompt — displayed as read-only text to copy into an image tool */}
          <div className="rounded-xl border border-dashed border-navy/20 px-3.5 py-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Prompt Gambar
            </p>
            <p className="text-xs italic text-slate-400">{result.imagePrompt}</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          Gagal membuat promo. Coba lagi.
        </p>
      )}
    </SectionCard>
  );
}

// ── SavingsPanel sub-component ────────────────────────────────────────────────
// Only rendered when there is a PENDING_SELLER_CONFIRMATION proposal for this
// month.  The seller sees the suggested amount and confirms or declines it.
//
// Note: "omzet tercatat" is used deliberately — NOT "profit".  The figure is
// qrisTotal + voiceCashEstimate, a revenue proxy.  Kasir Siluman does not
// track costs.  See computeMonthlyRevenue() in src/lib/reconciliation.ts.

interface SavingsPanelProps {
  proposal: SavingsProposal;
  loading: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}

function SavingsPanel({ proposal, loading, onConfirm, onDecline }: SavingsPanelProps) {
  return (
    <SectionCard className="border-teal/25">
      <div className="flex items-start gap-2.5">
        <IconCircle tone="teal">💰</IconCircle>
        <div className="pt-0.5">
          <EyebrowLabel tone="teal">Saran Tabungan Bulan Ini</EyebrowLabel>
          <p className="mt-1 text-xs text-slate-400">
            Berdasarkan omzet tercatat bulan{" "}
            <span className="font-medium text-navy">{formatMonth(proposal.month)}</span>
          </p>
        </div>
      </div>

      {/* Revenue proxy context */}
      <div className="mt-3 rounded-xl bg-slate-50 px-3.5 py-3">
        <div className="flex justify-between text-sm">
          <span className="text-slate-400">Omzet tercatat</span>
          <span className="font-semibold text-navy">{rupiah(proposal.netProfit)}</span>
        </div>
        <div className="mt-1.5 flex justify-between text-sm">
          <span className="text-slate-400">Saran tabungan (10%)</span>
          <span className="font-bold text-teal">{rupiah(proposal.suggestedAmount)}</span>
        </div>
      </div>

      <p className="mt-2.5 text-xs text-slate-400">
        Setujui untuk mencatat komitmen ini, atau tolak jika belum memungkinkan.
      </p>

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 rounded-xl bg-teal px-3 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal/30 transition hover:bg-teal/90 active:scale-[0.99] disabled:opacity-50"
        >
          {loading ? "…" : "✓ Setuju"}
        </button>
        <button
          onClick={onDecline}
          disabled={loading}
          className="flex-1 rounded-xl border border-navy/20 bg-white px-3 py-2.5 text-sm font-semibold text-navy transition hover:bg-navy/5 disabled:opacity-50"
        >
          {loading ? "…" : "Tolak"}
        </button>
      </div>
    </SectionCard>
  );
}

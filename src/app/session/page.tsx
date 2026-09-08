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
    <main className="mx-auto min-h-screen max-w-md px-5 py-8">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Kasir Siluman</h1>
          <p className="text-sm text-[#6B6458]">
            {merchantName ? `Lapak: ${merchantName}` : "Tampilan penjual"}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-[#6B6458] shadow-sm transition hover:bg-black/5"
        >
          Keluar
        </button>
      </div>

      {!session && (
        <button
          onClick={bukaLapak}
          disabled={loading || !merchantId}
          className="w-full rounded-xl bg-navy px-5 py-4 font-semibold text-white shadow-sm disabled:opacity-50"
        >
          1. Buka Lapak
        </button>
      )}

      {session && isOpen && (
        <div className="flex flex-col gap-5">
          {/* ── Sesi aktif summary ── */}
          <div className="rounded-xl border border-navy/15 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-[#6B6458]">Sesi aktif</p>
            <p className="mt-1 text-sm">
              QRIS: <span className="font-semibold">{rupiah(session.qrisTotal)}</span> ·
              Suara: <span className="font-semibold">{rupiah(session.voiceCashEstimate)}</span>
            </p>
          </div>

          {/* ── Simulasi QRIS ── */}
          <div className="rounded-xl border border-orange/30 bg-light p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange">
              Simulasi — bukan koneksi QRIS asli
            </p>
            <p className="mt-1 text-xs text-[#6B6458]">
              Tombol ini berdiri di tempat webhook QRIS asli. Lihat BOB_BRIEF.md.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                value={qrisAmount}
                onChange={(e) => setQrisAmount(e.target.value)}
                className="w-28 rounded-lg border border-navy/20 px-3 py-2 text-sm"
              />
              <button
                onClick={simulateQris}
                className="flex-1 rounded-lg bg-teal px-3 py-2 text-sm font-semibold text-white"
              >
                Simulasikan Pembayaran QRIS
              </button>
            </div>
          </div>

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
          <PromoPanel
            status={promoStatus}
            result={promoResult}
            onGenerate={buatPromo}
          />

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
          <div className="rounded-xl border border-navy/15 bg-white p-4">
            <p className="mb-2 text-xs uppercase tracking-wide text-[#6B6458]">
              Transaksi hari ini ({session.transactions.length})
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {session.transactions.map((t) => (
                <li key={t.id} className="flex justify-between">
                  <span className="text-[#6B6458]">{t.source === "qris" ? "QRIS" : "Suara"}</span>
                  <span className="font-medium">{rupiah(t.amount)}</span>
                </li>
              ))}
              {session.transactions.length === 0 && (
                <li className="text-[#6B6458]">Belum ada transaksi.</li>
              )}
            </ul>
          </div>

          {/* ── Tutup Buku manual ── */}
          <div className="rounded-xl bg-navy p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
              3. Tutup Buku (manual)
            </p>
            <p className="mt-1 text-xs text-white/50">
              Atau ucapkan frasa &quot;tutup buku&quot; saat merekam — sistem akan menutup sesi
              otomatis.
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="number"
                placeholder="Total tunai yang dihitung"
                value={closingTotal}
                onChange={(e) => setClosingTotal(e.target.value)}
                className="w-full rounded-lg border-0 px-3 py-2 text-sm"
              />
              <button
                onClick={tutupBukuManual}
                disabled={loading || !closingTotal}
                className="rounded-lg bg-orange px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
          className={`mt-5 rounded-xl border p-4 ${
            result.status === "RECONCILED"
              ? "border-teal/40 bg-teal/10"
              : "border-red-400/40 bg-red-50"
          }`}
        >
          {/* Status title */}
          <p className={`font-semibold ${result.status === "RECONCILED" ? "text-teal" : "text-red-700"}`}>
            {result.status === "RECONCILED" ? "Rekonsiliasi cocok ✓" : "Ada selisih — FLAGGED"}
          </p>

          {/* Category breakdown */}
          <div className="mt-3 flex flex-col gap-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-[#6B6458]">Tutup buku (pedagang)</span>
              <span className="font-medium">{rupiah(result.closingReportTotal ?? 0)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[#6B6458]">Estimasi kas dari suara</span>
              <span className="font-medium">{rupiah(result.voiceCashEstimate)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[#6B6458]">
                QRIS{" "}
                <span className="text-xs opacity-70">— tidak dihitung dalam selisih, sudah terverifikasi otomatis</span>
              </span>
              <span className="shrink-0 font-medium">{rupiah(result.qrisTotal)}</span>
            </div>
          </div>

          {/* Variance row — more prominent */}
          <div
            className={`mt-3 border-t pt-3 ${
              result.status === "RECONCILED" ? "border-teal/30" : "border-red-300/50"
            }`}
          >
            <div className="flex items-baseline justify-between">
              <div>
                <span className="font-semibold">Selisih</span>
                <p className="text-xs text-[#6B6458]">dihitung dari tutup buku vs. estimasi suara</p>
              </div>
              <span
                className={`text-lg font-bold ${
                  result.status === "RECONCILED" ? "text-teal" : "text-red-700"
                }`}
              >
                {rupiah(result.varianceAmount ?? 0)}
              </span>
            </div>
          </div>
        </div>
      )}
    </main>
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
    <div className="rounded-xl border border-navy/15 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy">
        2. Rekam Harga / Tutup Buku
      </p>
      <p className="mt-1 text-xs text-[#6B6458]">
        Tekan Rekam, sebutkan harga atau ucapkan &quot;tutup buku&quot;, lalu tekan Berhenti.
        {/* TODO: remove this notice once Langflow is wired in */}{" "}
        <span className="text-orange font-medium">
          (Pipeline suara belum tersambung — lihat src/lib/voiceToTransaction.ts)
        </span>
      </p>

      <div className="mt-3 flex gap-2">
        {!isRecording ? (
          <button
            onClick={onStart}
            disabled={busy}
            className="flex-1 rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isRequesting ? "Meminta izin mikrofon…" : isProcessing ? "Memproses…" : "🎙 Rekam"}
          </button>
        ) : (
          <button
            onClick={onStop}
            className="flex-1 animate-pulse rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white"
          >
            ⏹ Berhenti (sedang merekam…)
          </button>
        )}
      </div>

      {lastVoiceResult && !voiceError && (
        <p className="mt-2 text-xs text-teal">{lastVoiceResult}</p>
      )}

      {voiceError && (
        <p className="mt-2 text-xs text-red-600">
          Gagal: {voiceError}
        </p>
      )}
    </div>
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
    <div className="rounded-xl border border-navy/15 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy">
        Radar Tetangga
      </p>
      <p className="mt-1 text-xs text-[#6B6458]">
        Rata-rata harga barang serupa di sekitar lapak Anda, dari data agregat anonim.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="mis. bakso, es teh"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onQuery(query)}
          className="flex-1 rounded-lg border border-navy/20 px-3 py-2 text-sm"
          disabled={status === "loading"}
        />
        <button
          onClick={() => onQuery(query)}
          disabled={!query.trim() || status === "loading"}
          className="rounded-lg bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === "loading" ? "…" : "Cek"}
        </button>
      </div>

      {/* ── Result states ── */}
      {status === "inactive" && (
        <p className="mt-3 text-xs text-[#6B6458]">
          {/* Honest placeholder — no fake data. */}
          Radar Tetangga belum aktif — menunggu pipeline Langflow
          ({/* TODO: remove once wired in */}
          <span className="font-medium">LANGFLOW_RADAR_TETANGGA_FLOW_ID</span>).
        </p>
      )}

      {status === "loading" && (
        <p className="mt-3 text-xs text-[#6B6458]">Mencari data sekitar…</p>
      )}

      {status === "ready" && result && (
        <div className="mt-3 rounded-lg bg-navy/5 px-3 py-2">
          <p className="text-sm font-semibold text-navy">
            {result.itemLabel}
          </p>
          <p className="text-lg font-bold text-navy">
            {rupiah(result.averagePrice)}
          </p>
          <p className="text-xs text-[#6B6458]">
            rata-rata dari {result.sampleSize} pedagang sekitar
            {result.radius ? ` (radius ${result.radius})` : ""}
          </p>
        </div>
      )}

      {status === "insufficient-data" && (
        <p className="mt-3 text-xs text-[#6B6458]">
          Belum cukup data dari pedagang sekitar untuk barang ini (minimal 2
          pedagang lain). Coba lagi nanti setelah lebih banyak transaksi tercatat.
        </p>
      )}

      {status === "error" && (
        <p className="mt-3 text-xs text-red-600">
          Gagal mengambil data radar. Coba lagi.
        </p>
      )}
    </div>
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
    <div className="rounded-xl border border-navy/15 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy">
        Buat Promo
      </p>
      <p className="mt-1 text-xs text-[#6B6458]">
        Buat teks poster dan prompt gambar dari data penjualan terbaru Anda.
      </p>

      <button
        onClick={onGenerate}
        disabled={status === "loading"}
        className="mt-3 w-full rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {status === "loading" ? "Sedang membuat promo…" : "✨ Buat Promo"}
      </button>

      {/* ── Result states ── */}
      {status === "inactive" && (
        <p className="mt-3 text-xs text-[#6B6458]">
          Tekan tombol di atas untuk membuat teks promo dari data penjualan terbaru.
        </p>
      )}

      {status === "loading" && (
        <p className="mt-3 text-xs text-[#6B6458]">Mengambil konteks dan membuat promo…</p>
      )}

      {status === "ready" && result && (
        <div className="mt-3 flex flex-col gap-3">
          {/* Poster copy */}
          <div className="rounded-lg bg-navy/5 px-3 py-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6B6458]">
              Teks Poster
            </p>
            <p className="whitespace-pre-wrap text-sm text-navy">{result.posterText}</p>
          </div>

          {/* Image prompt — displayed as read-only text to copy into an image tool */}
          <div className="rounded-lg border border-dashed border-navy/20 px-3 py-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#6B6458]">
              Prompt Gambar
            </p>
            <p className="text-xs italic text-[#6B6458]">{result.imagePrompt}</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <p className="mt-3 text-xs text-red-600">
          Gagal membuat promo. Coba lagi.
        </p>
      )}
    </div>
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
    <div className="rounded-xl border-2 border-teal/40 bg-teal/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-teal">
        💰 Saran Tabungan Bulan Ini
      </p>
      <p className="mt-1 text-xs text-[#6B6458]">
        Berdasarkan omzet tercatat bulan{" "}
        <span className="font-medium">{formatMonth(proposal.month)}</span>
      </p>

      {/* Revenue proxy context */}
      <div className="mt-3 rounded-lg bg-white px-3 py-2">
        <div className="flex justify-between text-sm">
          <span className="text-[#6B6458]">Omzet tercatat</span>
          <span className="font-medium">{rupiah(proposal.netProfit)}</span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span className="text-[#6B6458]">Saran tabungan (10%)</span>
          <span className="font-bold text-teal">{rupiah(proposal.suggestedAmount)}</span>
        </div>
      </div>

      <p className="mt-2 text-xs text-[#6B6458]">
        Setujui untuk mencatat komitmen ini, atau tolak jika belum memungkinkan.
      </p>

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={loading}
          className="flex-1 rounded-lg bg-teal px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "…" : "✓ Setuju"}
        </button>
        <button
          onClick={onDecline}
          disabled={loading}
          className="flex-1 rounded-lg border border-navy/20 px-3 py-2 text-sm font-semibold text-navy disabled:opacity-50"
        >
          {loading ? "…" : "Tolak"}
        </button>
      </div>
    </div>
  );
}

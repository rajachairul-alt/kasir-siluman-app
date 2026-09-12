"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IBM_Plex_Sans } from "next/font/google";
import { ChartLineUp } from "@phosphor-icons/react";
import TiltCard from "@/components/TiltCard";

// Scoped to this page only (same choice as the other pages) — not applied
// globally in layout.tsx.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export default function OwnerLoginPage() {
  return (
    <Suspense fallback={null}>
      <OwnerLoginForm />
    </Suspense>
  );
}

function OwnerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/pemilik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "PIN salah.");
        setLoading(false);
        return;
      }
      document.cookie = `ks_owner=1; path=/; max-age=${60 * 60 * 12}`;
      router.push(next);
      router.refresh();
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setLoading(false);
    }
  }

  return (
    <div
      className={`relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-[#0F0F3D] to-[#191970] px-4 ${ibmPlexSans.className}`}
    >
      {/* Ambient gradient orbs — pure CSS, no 3D library */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 top-0 h-72 w-72 animate-ks-float rounded-full bg-white/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 bottom-0 h-80 w-80 animate-ks-float-slow rounded-full bg-teal/20 blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <TiltCard max={10} className="mx-auto mb-4 inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Kasir Siluman"
              className="mx-auto h-14 w-14 rounded-2xl shadow-lg shadow-black/30"
            />
          </TiltCard>
          <h1 className="text-2xl font-bold text-white">Kasir Siluman</h1>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/60">
            <ChartLineUp size={15} aria-hidden="true" /> Masuk sebagai pemilik untuk melihat dashboard
          </p>
        </div>

        <TiltCard max={3}>
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-6 shadow-xl"
          >
            <label className="block text-xs font-semibold uppercase tracking-wide text-white/50 mb-1.5">
              PIN Pemilik
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              maxLength={6}
              className="w-full rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-center text-lg tracking-[0.5em] text-white placeholder-white/30 outline-none transition duration-200 focus:border-white/40 focus:ring-2 focus:ring-white/10"
            />

            {error && (
              <p className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-200">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || pin.length === 0}
              className="mt-5 w-full cursor-pointer rounded-xl bg-white py-3 text-sm font-semibold text-[#1F3A56] shadow-md transition duration-200 hover:bg-white/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            >
              <span className={loading ? "animate-pulse" : ""}>
                {loading ? "Memeriksa…" : "Masuk ke Dashboard"}
              </span>
            </button>
          </form>
        </TiltCard>

        <p className="mt-6 text-center text-xs text-white/40">
          Pedagang?{" "}
          <a href="/login" className="font-medium text-white/80 underline underline-offset-2">
            Masuk ke sesi jualan
          </a>
        </p>
      </div>
    </div>
  );
}

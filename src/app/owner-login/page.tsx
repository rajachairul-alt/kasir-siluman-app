"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function OwnerLoginPage() {
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#0F2338] to-[#1F3A56] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-2xl backdrop-blur">
            👑
          </div>
          <h1 className="text-2xl font-bold text-white">Kasir Siluman</h1>
          <p className="mt-1 text-sm text-white/60">Masuk sebagai pemilik untuk melihat dashboard</p>
        </div>

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
            className="w-full rounded-xl border border-white/15 bg-white/10 px-3.5 py-2.5 text-center text-lg tracking-[0.5em] text-white placeholder-white/30 outline-none transition focus:border-white/40 focus:ring-2 focus:ring-white/10"
          />

          {error && (
            <p className="mt-3 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || pin.length === 0}
            className="mt-5 w-full rounded-xl bg-white py-3 text-sm font-semibold text-[#1F3A56] shadow-md transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Memeriksa…" : "Masuk ke Dashboard"}
          </button>
        </form>

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

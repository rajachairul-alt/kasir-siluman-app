"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface Merchant {
  id: string;
  name: string;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/session";

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/merchants")
      .then((r) => r.json())
      .then((data: Merchant[]) => {
        setMerchants(data);
        if (data.length > 0) setMerchantId(data[0].id);
      })
      .catch(() => setError("Gagal memuat daftar pedagang."));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!merchantId || pin.length === 0) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/pedagang", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "PIN salah.");
        setLoading(false);
        return;
      }
      document.cookie = `ks_merchant_id=${data.merchantId}; path=/; max-age=${60 * 60 * 12}`;
      document.cookie = `ks_merchant_name=${encodeURIComponent(data.merchantName)}; path=/; max-age=${60 * 60 * 12}`;
      router.push(next);
      router.refresh();
    } catch {
      setError("Terjadi kesalahan jaringan.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#FBF6EE] to-[#F3E9D8] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1F3A56] text-2xl shadow-lg shadow-[#1F3A56]/20">
            🛒
          </div>
          <h1 className="text-2xl font-bold text-[#1F3A56]">Kasir Siluman</h1>
          <p className="mt-1 text-sm text-[#6B6357]">Masuk sebagai pedagang untuk mulai berjualan</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-black/5 bg-white/80 backdrop-blur p-6 shadow-xl shadow-black/5"
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-[#6B6357] mb-1.5">
            Pilih lapak
          </label>
          <select
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-[#231F1A] outline-none transition focus:border-[#1F3A56] focus:ring-2 focus:ring-[#1F3A56]/15"
          >
            {merchants.length === 0 && <option>Memuat…</option>}
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[#6B6357] mb-1.5">
            PIN
          </label>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
            maxLength={6}
            className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-center text-lg tracking-[0.5em] text-[#231F1A] outline-none transition focus:border-[#1F3A56] focus:ring-2 focus:ring-[#1F3A56]/15"
          />

          {error && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !merchantId || pin.length === 0}
            className="mt-5 w-full rounded-xl bg-[#1F3A56] py-3 text-sm font-semibold text-white shadow-md shadow-[#1F3A56]/25 transition hover:bg-[#16283d] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Memeriksa…" : "Masuk"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#8C8375]">
          Pemilik lapak?{" "}
          <a href="/owner-login" className="font-medium text-[#1F3A56] underline underline-offset-2">
            Masuk ke dashboard
          </a>
        </p>
      </div>
    </div>
  );
}

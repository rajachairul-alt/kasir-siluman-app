"use client";

import Link from "next/link";
import { IBM_Plex_Sans } from "next/font/google";
import { Storefront, ChartLineUp, Microphone, ShieldCheck, ArrowRight } from "@phosphor-icons/react";
import TiltCard from "@/components/TiltCard";

// Scoped to this page only (same choice as /dashboard and /session) — not
// applied globally in layout.tsx.
const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const FEATURES = [
  {
    icon: <Microphone size={20} aria-hidden="true" />,
    title: "Catat dari suara",
    desc: "Sebutkan harga sambil melayani pembeli, tercatat otomatis.",
  },
  {
    icon: <ShieldCheck size={20} aria-hidden="true" />,
    title: "Rekonsiliasi jujur",
    desc: "QRIS, suara, dan tutup buku dicocokkan — selisih langsung ketahuan.",
  },
  {
    icon: <ChartLineUp size={20} aria-hidden="true" />,
    title: "Omzet & tabungan",
    desc: "Ringkasan bulanan dan saran tabungan otomatis untuk pemilik.",
  },
];

export default function Home() {
  return (
    <main
      className={`relative min-h-screen overflow-hidden bg-[#F3F5FB] ${ibmPlexSans.className}`}
    >
      {/* Ambient gradient orbs — pure CSS, no 3D library */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 animate-ks-float-slow rounded-full bg-navy/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 top-1/3 h-80 w-80 animate-ks-float rounded-full bg-teal/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-1/4 h-64 w-64 animate-ks-float-slow rounded-full bg-orange/10 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-16">
        {/* ── Hero ── */}
        <TiltCard max={6} className="mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Kasir Siluman"
            className="mx-auto h-24 w-24 rounded-3xl shadow-2xl shadow-navy/30"
          />
        </TiltCard>

        <h1 className="text-center text-4xl font-bold tracking-tight text-navy sm:text-5xl">
          Kasir Siluman
        </h1>
        <p className="mt-4 max-w-md text-center text-base text-[#6B6458]">
          Copilot finansial otomatis untuk pedagang gerobak &amp; UMKM mikro —
          mencatat, mencocokkan, dan menabung tanpa kertas.
        </p>

        {/* ── Feature strip ── */}
        <div className="mt-12 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-100 bg-white/70 p-4 text-left shadow-sm backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-navy/10 text-navy"
                aria-hidden="true"
              >
                {f.icon}
              </span>
              <p className="mt-3 text-sm font-semibold text-navy">{f.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#6B6458]">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* ── Entry cards — role-based, each tilts independently on hover ── */}
        <div className="mt-12 grid w-full max-w-2xl gap-5 sm:grid-cols-2">
          <TiltCard max={5}>
            <Link
              href="/session"
              className="group flex h-full cursor-pointer flex-col justify-between rounded-2xl bg-gradient-to-br from-navy to-[#152A40] p-6 text-left shadow-lg shadow-navy/25 transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/40"
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white"
                aria-hidden="true"
              >
                <Storefront size={22} />
              </span>
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/60">
                  Untuk penjual
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-white">
                  Buka Lapak
                  <ArrowRight
                    size={16}
                    aria-hidden="true"
                    className="transition duration-200 group-hover:translate-x-1"
                  />
                </p>
              </div>
            </Link>
          </TiltCard>

          <TiltCard max={5}>
            <Link
              href="/dashboard"
              className="group flex h-full cursor-pointer flex-col justify-between rounded-2xl border border-navy/15 bg-white p-6 text-left shadow-sm transition duration-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy/30"
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl bg-navy/10 text-navy"
                aria-hidden="true"
              >
                <ChartLineUp size={22} />
              </span>
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-navy/60">
                  Untuk pemilik
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-navy">
                  Lihat Dashboard
                  <ArrowRight
                    size={16}
                    aria-hidden="true"
                    className="transition duration-200 group-hover:translate-x-1"
                  />
                </p>
              </div>
            </Link>
          </TiltCard>
        </div>
      </div>
    </main>
  );
}

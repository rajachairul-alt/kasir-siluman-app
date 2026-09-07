import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-3xl font-bold text-navy">Kasir Siluman</h1>
        <p className="mt-2 text-sm text-[#6B6458]">
          Copilot finansial otomatis untuk pedagang gerobak &amp; UMKM mikro.
        </p>
      </div>

      <div className="flex w-full flex-col gap-3">
        <Link
          href="/session"
          className="rounded-xl bg-navy px-5 py-4 font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          Buka sebagai Penjual
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl border border-navy/20 bg-white px-5 py-4 font-semibold text-navy shadow-sm transition hover:bg-light"
        >
          Buka sebagai Pemilik
        </Link>
      </div>

      <p className="text-xs text-[#6B6458]">
        MVP hackathon — data QRIS &amp; suara masih disimulasikan, lihat README.md
      </p>
    </main>
  );
}

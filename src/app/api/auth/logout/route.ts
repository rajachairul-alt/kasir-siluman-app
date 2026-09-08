import { NextResponse } from "next/server";

// POST /api/auth/logout -> hapus cookie sesi (pedagang & pemilik sekaligus,
// aman dipanggil dari kedua sisi karena hanya menghapus yang ada).
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ks_merchant_id", "", { path: "/", maxAge: 0 });
  res.cookies.set("ks_merchant_name", "", { path: "/", maxAge: 0 });
  res.cookies.set("ks_owner", "", { path: "/", maxAge: 0 });
  return res;
}

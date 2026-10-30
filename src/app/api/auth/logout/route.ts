import { NextResponse } from "next/server";
import { MERCHANT_COOKIE, OWNER_COOKIE } from "@/lib/auth";

// POST /api/auth/logout -> clear both session cookies (safe from either side),
// plus the old client-set cookies from before signed sessions.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  for (const name of [MERCHANT_COOKIE, OWNER_COOKIE, "ks_merchant_id", "ks_merchant_name", "ks_owner"]) {
    res.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return res;
}

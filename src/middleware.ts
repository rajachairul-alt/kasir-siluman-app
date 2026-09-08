import { NextRequest, NextResponse } from "next/server";

// Gerbang login sederhana berbasis PIN (lihat src/app/login dan
// src/app/owner-login). Ini BUKAN sistem auth enterprise — cukup untuk
// memisahkan sesi antar pedagang dan menjaga /dashboard dari akses publik
// tanpa PIN pemilik.
//
// Cookie diset dari sisi client (document.cookie) setelah PIN diverifikasi
// oleh /api/auth/pedagang atau /api/auth/pemilik, jadi middleware ini cukup
// mengecek keberadaan & nilai cookie tanpa perlu query database.

const MERCHANT_COOKIE = "ks_merchant_id";
const OWNER_COOKIE = "ks_owner";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/session")) {
    const merchantId = req.cookies.get(MERCHANT_COOKIE)?.value;
    if (!merchantId) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/dashboard")) {
    const owner = req.cookies.get(OWNER_COOKIE)?.value;
    if (owner !== "1") {
      const url = req.nextUrl.clone();
      url.pathname = "/owner-login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/session/:path*", "/dashboard/:path*"],
};

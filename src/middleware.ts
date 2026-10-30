import { NextRequest, NextResponse } from "next/server";
import { getAuth, isSignedIn } from "@/lib/auth";

// First gate for every protected page and API route. Sessions are signed
// httpOnly cookies set by /api/auth/pedagang and /api/auth/pemilik (see
// src/lib/auth.ts), so a hand-made cookie in DevTools no longer gets in.
//
// - /session needs a pedagang session, /dashboard an owner session.
// - /api/* needs either session, except the login routes and the
//   server-to-server routes that check their own shared secret.
// API routes still check per-merchant ownership themselves.

const OPEN_API = [/^\/api\/auth\//, /^\/api\/webhook\//, /^\/api\/internal\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (OPEN_API.some((r) => r.test(pathname))) return NextResponse.next();
    if (isSignedIn(await getAuth(req))) return NextResponse.next();
    return NextResponse.json({ error: "Silakan login dulu." }, { status: 401 });
  }

  const auth = await getAuth(req);
  const loginPage = pathname.startsWith("/dashboard")
    ? auth.owner ? null : "/owner-login"
    : auth.merchantId ? null : "/login";
  if (!loginPage) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = loginPage;
  url.search = "";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/session/:path*", "/dashboard/:path*", "/api/:path*"],
};

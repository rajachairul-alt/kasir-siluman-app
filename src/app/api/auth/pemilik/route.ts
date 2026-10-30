import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { OWNER_COOKIE, setSessionCookie, signSession } from "@/lib/auth";
import { sameSecret } from "@/lib/pin";
import { clearFailures, clientIp, lockedResponse, recordFailure } from "@/lib/loginGuard";

// POST /api/auth/pemilik -> verify the owner PIN (env OWNER_PIN, one PIN for
// all owners until per-owner accounts land) and set the signed, httpOnly
// owner session cookie. Wrong PINs are rate-limited (src/lib/loginGuard.ts).

const schema = z.object({ pin: z.string().min(1).max(64) });
const ACCOUNT = "pemilik";

export async function POST(req: NextRequest) {
  const ownerPin = process.env.OWNER_PIN;
  if (!ownerPin) {
    return NextResponse.json(
      { error: "OWNER_PIN belum diisi di environment variables server." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "pin wajib diisi" }, { status: 400 });
  }

  const ip = clientIp(req);
  const locked = await lockedResponse(ACCOUNT, ip);
  if (locked) return locked;

  if (!sameSecret(parsed.data.pin, ownerPin)) {
    await recordFailure(ACCOUNT, ip);
    return NextResponse.json({ error: "PIN salah." }, { status: 401 });
  }

  const token = await signSession("owner");
  if (!token) {
    return NextResponse.json({ error: "SESSION_SECRET belum diisi di server." }, { status: 500 });
  }

  await clearFailures(ACCOUNT);
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, OWNER_COOKIE, token);
  return res;
}

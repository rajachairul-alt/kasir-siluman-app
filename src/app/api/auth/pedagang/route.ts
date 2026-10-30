import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { MERCHANT_COOKIE, setSessionCookie, signSession } from "@/lib/auth";
import { DEFAULT_PIN, hashPin, isHashed, verifyPin } from "@/lib/pin";
import { clearFailures, clientIp, lockedResponse, recordFailure } from "@/lib/loginGuard";

// POST /api/auth/pedagang -> verify a merchant's PIN and set the signed,
// httpOnly pedagang session cookie (src/lib/auth.ts). Wrong PINs are
// rate-limited per merchant and per IP (src/lib/loginGuard.ts).

const schema = z.object({
  merchantId: z.string().min(1).max(100),
  pin: z.string().min(1).max(32),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "merchantId dan pin wajib diisi" }, { status: 400 });
  }
  const { merchantId, pin } = parsed.data;
  const account = `pedagang:${merchantId}`;
  const ip = clientIp(req);

  const locked = await lockedResponse(account, ip);
  if (locked) return locked;

  const merchant = await db.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, name: true, pin: true },
  });

  if (!merchant || !(await verifyPin(pin, merchant.pin))) {
    await recordFailure(account, ip);
    return NextResponse.json({ error: "PIN salah." }, { status: 401 });
  }
  if (pin === DEFAULT_PIN) {
    return NextResponse.json(
      { error: "PIN bawaan 0000 tidak boleh dipakai. Minta pemilik mengganti PIN dulu." },
      { status: 403 }
    );
  }

  const token = await signSession("merchant", merchant.id);
  if (!token) {
    return NextResponse.json({ error: "SESSION_SECRET belum diisi di server." }, { status: 500 });
  }

  await clearFailures(account);
  if (!isHashed(merchant.pin)) {
    await db.merchant.update({ where: { id: merchant.id }, data: { pin: await hashPin(pin) } });
  }

  const res = NextResponse.json({ ok: true, merchantId: merchant.id, merchantName: merchant.name });
  setSessionCookie(res, MERCHANT_COOKIE, token);
  return res;
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// POST /api/auth/pedagang -> verifikasi PIN pedagang untuk satu merchant.
// Tidak mengeset cookie di sini (Set-Cookie dari route handler + client
// fetch punya beberapa gotcha SameSite) — client yang mengeset cookie
// document.cookie setelah menerima { ok: true } dari sini. Ini bukan data
// sensitif finansial, jadi trade-off ini cukup aman untuk skala UMKM.

const schema = z.object({
  merchantId: z.string().min(1),
  pin: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "merchantId dan pin wajib diisi" }, { status: 400 });
  }

  const merchant = await db.merchant.findUnique({
    where: { id: parsed.data.merchantId },
    select: { id: true, name: true, pin: true },
  });

  if (!merchant || merchant.pin !== parsed.data.pin) {
    return NextResponse.json({ error: "PIN salah." }, { status: 401 });
  }

  return NextResponse.json({ ok: true, merchantId: merchant.id, merchantName: merchant.name });
}

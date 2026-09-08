import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// POST /api/auth/pemilik -> verifikasi PIN pemilik terhadap env var OWNER_PIN.
// Satu PIN untuk semua pemilik (cukup untuk skala UMKM/demo) — bukan
// per-akun. Set OWNER_PIN di .env lokal dan di Environment Variables Vercel.

const schema = z.object({ pin: z.string().min(1) });

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

  if (parsed.data.pin !== ownerPin) {
    return NextResponse.json({ error: "PIN salah." }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}

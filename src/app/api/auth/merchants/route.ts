import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/auth/merchants -> daftar merchant untuk dropdown di /login.
// Hanya id + name yang dikembalikan — PIN tidak pernah dikirim ke client.

export async function GET() {
  const merchants = await db.merchant.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json(merchants);
}

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Brute-force guard for the PIN logins. Failed attempts are stored in Turso
// (table LoginAttempt) so the limit holds across every Vercel instance:
// at most 5 wrong PINs per account and 20 per IP address in 15 minutes.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 20;

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

/** A 429 response while the account or IP is locked, otherwise null. */
export async function lockedResponse(account: string, ip: string): Promise<NextResponse | null> {
  const since = new Date(Date.now() - WINDOW_MS);
  const [accountFails, ipFails] = await Promise.all([
    db.loginAttempt.findMany({
      where: { account, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: MAX_PER_ACCOUNT,
      select: { createdAt: true },
    }),
    db.loginAttempt.count({ where: { ip, createdAt: { gte: since } } }),
  ]);
  if (accountFails.length < MAX_PER_ACCOUNT && ipFails < MAX_PER_IP) return null;

  // The account unlocks when the 5th most recent failure leaves the window.
  const unlockAt =
    accountFails.length >= MAX_PER_ACCOUNT
      ? accountFails[MAX_PER_ACCOUNT - 1].createdAt.getTime() + WINDOW_MS
      : Date.now() + WINDOW_MS;
  const minutes = Math.max(1, Math.ceil((unlockAt - Date.now()) / 60000));
  return NextResponse.json(
    { error: `Terlalu banyak PIN salah. Coba lagi dalam ${minutes} menit.` },
    { status: 429, headers: { "Retry-After": String(minutes * 60) } }
  );
}

export async function recordFailure(account: string, ip: string): Promise<void> {
  await db.loginAttempt.create({ data: { account, ip } });
  // Housekeeping: rows older than a day are never needed again.
  await db.loginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    .catch(() => {});
}

export async function clearFailures(account: string): Promise<void> {
  await db.loginAttempt.deleteMany({ where: { account } }).catch(() => {});
}

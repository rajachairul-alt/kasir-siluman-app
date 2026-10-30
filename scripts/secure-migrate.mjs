// One-off migration for signed sessions + PIN hardening, run against Turso
// AFTER the new code is deployed. Safe to run more than once.
//   1. Creates the LoginAttempt table used by src/lib/loginGuard.ts.
//   2. Hashes every merchant PIN still stored as plain text, in the same
//      "scrypt$<salt>$<hash>" format as src/lib/pin.ts.
//   3. Lists merchants still on the default PIN 0000 (login refuses it).
// Prints names and counts only, never a PIN.
//
// Run with:  node scripts/secure-migrate.mjs

import { readFileSync, existsSync } from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import { createClient } from "@libsql/client";

function loadEnvVar(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;
  const match = readFileSync(".env", "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

const url = loadEnvVar("TURSO_DATABASE_URL");
if (!url) {
  console.error("TURSO_DATABASE_URL tidak ditemukan di .env.");
  process.exit(1);
}
const client = createClient({ url, authToken: loadEnvVar("TURSO_AUTH_TOKEN") });

// keep in sync with hashPin() in src/lib/pin.ts
function hashPin(pin) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scryptSync(pin, salt, 32).toString("base64")}`;
}

try {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS "LoginAttempt" (
         "id" TEXT NOT NULL PRIMARY KEY,
         "account" TEXT NOT NULL,
         "ip" TEXT NOT NULL,
         "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
      `CREATE INDEX IF NOT EXISTS "LoginAttempt_account_createdAt_idx" ON "LoginAttempt"("account", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "LoginAttempt_ip_createdAt_idx" ON "LoginAttempt"("ip", "createdAt")`,
    ],
    "write"
  );
  console.log("Tabel LoginAttempt siap.");

  const { rows } = await client.execute(`SELECT id, name, pin FROM "Merchant"`);
  let hashed = 0;
  const onDefault = [];
  for (const m of rows) {
    const pin = String(m.pin);
    if (pin === "0000") onDefault.push(m.name);
    if (pin.startsWith("scrypt$")) continue;
    await client.execute({ sql: `UPDATE "Merchant" SET pin = ? WHERE id = ? AND pin = ?`, args: [hashPin(pin), m.id, pin] });
    hashed++;
  }
  console.log(`PIN di-hash: ${hashed} dari ${rows.length} merchant (sisanya sudah ter-hash).`);
  if (onDefault.length) {
    console.log(`Masih memakai PIN bawaan 0000 dan tidak bisa login sampai PIN diganti: ${onDefault.join(", ")}`);
  }
} catch (err) {
  console.error("Migrasi gagal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  client.close();
}

// One-off migration: add the `pin` column to Merchant on Turso, without
// needing the `turso` CLI or WSL. Uses @libsql/client directly (already a
// project dependency) and reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from
// .env by hand (no dotenv dependency needed).
//
// Run with:  node scripts/migrate-add-pin.mjs

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@libsql/client";

function loadEnvVar(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(".env")) return undefined;
  const content = readFileSync(".env", "utf8");
  const match = content.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) return undefined;
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const url = loadEnvVar("TURSO_DATABASE_URL");
const authToken = loadEnvVar("TURSO_AUTH_TOKEN");

if (!url || !authToken) {
  console.error(
    "TURSO_DATABASE_URL dan/atau TURSO_AUTH_TOKEN tidak ditemukan di .env. " +
      "Pastikan file .env ada di folder ini dan sudah diisi (lihat DEPLOYMENT_GUIDE.md step 2)."
  );
  process.exit(1);
}

const client = createClient({ url, authToken });

try {
  const schema = await client.execute("PRAGMA table_info(Merchant);");
  const hasPin = schema.rows.some((row) => row.name === "pin");

  if (hasPin) {
    console.log("Kolom `pin` sudah ada di tabel Merchant — tidak ada yang perlu dilakukan.");
  } else {
    await client.execute(
      "ALTER TABLE Merchant ADD COLUMN pin TEXT NOT NULL DEFAULT '0000';"
    );
    console.log("Berhasil: kolom `pin` ditambahkan ke tabel Merchant di Turso.");
  }

  const after = await client.execute("PRAGMA table_info(Merchant);");
  console.log(
    "Kolom Merchant sekarang:",
    after.rows.map((r) => r.name).join(", ")
  );
} catch (err) {
  console.error("Migrasi gagal:", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  client.close();
}

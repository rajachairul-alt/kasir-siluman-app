import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Merchant PINs are stored as "scrypt$<salt base64>$<hash base64>" (Node's
// default scrypt cost). Rows from before hashing still hold the plain PIN;
// verifyPin accepts them so logins keep working, and the pedagang login
// rehashes on success. scripts/secure-migrate.mjs hashes all of them at once
// with the same format — keep the two in sync.

const scrypt = promisify(scryptCb) as (pin: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** The schema default. Never accepted for login. */
export const DEFAULT_PIN = "0000";

export const isHashed = (stored: string) => stored.startsWith("scrypt$");

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  if (!isHashed(stored)) {
    const a = Buffer.from(pin);
    const b = Buffer.from(stored);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const [, salt, hash] = stored.split("$");
  const expected = Buffer.from(hash ?? "", "base64");
  if (!salt || expected.length === 0) return false;
  const actual = await scrypt(pin, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Constant-time compare for the owner PIN from env. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

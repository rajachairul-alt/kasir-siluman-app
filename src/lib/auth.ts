import { NextRequest, NextResponse } from "next/server";

// Signed session cookies for the two PIN logins. The server sets them
// (httpOnly, so page scripts can't read or forge them) and every protected
// page and API route verifies the HMAC-SHA256 signature with SESSION_SECRET.
// Web Crypto only, so this module runs in Edge middleware and in Node routes.
//
// Cookie value: "<base64url JSON payload>.<base64url signature>",
// payload = { role, merchantId?, exp }.

export const MERCHANT_COOKIE = "ks_pedagang";
export const OWNER_COOKIE = "ks_pemilik";
export const SESSION_MAX_AGE = 12 * 60 * 60; // seconds

type Role = "merchant" | "owner";
interface Payload {
  role: Role;
  merchantId?: string;
  exp: number;
}

export interface Auth {
  /** Owner PIN session, or a server-to-server call from watsonx Orchestrate. */
  owner: boolean;
  /** Merchant from the pedagang PIN session. */
  merchantId: string | null;
}

const enc = new TextEncoder();
const toB64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmacKey(): Promise<CryptoKey | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null; // fail closed: no secret, no sessions
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(role: Role, merchantId?: string): Promise<string | null> {
  const key = await hmacKey();
  if (!key) return null;
  const payload: Payload = { role, merchantId, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE };
  const body = toB64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  return `${body}.${toB64url(sig)}`;
}

async function verifySession(token: string | undefined, role: Role): Promise<Payload | null> {
  if (!token) return null;
  const key = await hmacKey();
  if (!key) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", key, fromB64url(sig), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Payload;
    if (p.role !== role || typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    if (role === "merchant" && typeof p.merchantId !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

// Orchestrate tools authenticate with the same header the internal audit-log
// route already uses (see orchestrate/openapi/*.yaml).
function isOrchestrateCall(req: NextRequest): boolean {
  const expected = process.env.ORCHESTRATE_INTERNAL_SECRET;
  const got = req.headers.get("x-orchestrate-internal-secret");
  if (!expected || expected.length < 16 || !got || got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function getAuth(req: NextRequest): Promise<Auth> {
  const [merchant, owner] = await Promise.all([
    verifySession(req.cookies.get(MERCHANT_COOKIE)?.value, "merchant"),
    verifySession(req.cookies.get(OWNER_COOKIE)?.value, "owner"),
  ]);
  return { owner: owner !== null || isOrchestrateCall(req), merchantId: merchant?.merchantId ?? null };
}

export const isSignedIn = (auth: Auth) => auth.owner || auth.merchantId !== null;

/** The owner sees every merchant; a pedagang only their own. */
export const canAccessMerchant = (auth: Auth, merchantId: string) => auth.owner || auth.merchantId === merchantId;

export const unauthorized = () => NextResponse.json({ error: "Silakan login dulu." }, { status: 401 });
export const forbidden = () => NextResponse.json({ error: "Tidak punya akses ke data ini." }, { status: 403 });

export function setSessionCookie(res: NextResponse, name: string, token: string) {
  res.cookies.set(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

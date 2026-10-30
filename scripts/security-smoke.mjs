// Checks the login and API protections against a running app, e.g. after a
// Vercel deploy. Uses a made-up merchant id for the lockout test, so no real
// account gets locked.
//
//   node scripts/security-smoke.mjs https://kasir-siluman-app.vercel.app
//   node scripts/security-smoke.mjs http://localhost:3000
//
// Optional: SMOKE_MERCHANT_ID + SMOKE_PIN also check that a pedagang session
// cannot read owner data.

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
let failed = 0;

async function check(name, fn) {
  try {
    const why = await fn();
    console.log(`${why ? "GAGAL" : "OK   "}  ${name}${why ? ` — ${why}` : ""}`);
    if (why) failed++;
  } catch (e) {
    failed++;
    console.log(`GAGAL  ${name} — ${e.message}`);
  }
}

const get = (path, cookie) =>
  fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
const post = (path, body, cookie) =>
  fetch(base + path, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const expectStatus = (res, ...codes) => (codes.includes(res.status) ? null : `status ${res.status}, harusnya ${codes.join("/")}`);
const forged = `ks_owner=1; ks_merchant_id=demo-merchant; ks_pemilik=eyJyb2xlIjoib3duZXIiLCJleHAiOjk5OTk5OTk5OTl9.AAAA; ks_pedagang=eyJyb2xlIjoibWVyY2hhbnQiLCJtZXJjaGFudElkIjoiZGVtby1tZXJjaGFudCIsImV4cCI6OTk5OTk5OTk5OX0.AAAA`;

for (const path of ["/api/ledger", "/api/audit-log", "/api/savings", "/api/session"]) {
  await check(`GET ${path} tanpa login ditolak`, async () => expectStatus(await get(path), 401));
  await check(`GET ${path} dengan cookie palsu ditolak`, async () => expectStatus(await get(path, forged), 401));
}
await check("POST /api/transactions tanpa login ditolak", async () =>
  expectStatus(await post("/api/transactions", { sessionId: "x", source: "qris", amount: 1000 }), 401));
await check("POST /api/voice/extract tanpa login ditolak", async () => expectStatus(await post("/api/voice/extract", {}), 401));
await check("POST /api/dev/ensure-merchant tidak bisa dipakai", async () =>
  expectStatus(await post("/api/dev/ensure-merchant", {}), 401, 404));
await check("/dashboard dengan cookie palsu dialihkan ke login", async () => {
  const res = await get("/dashboard", forged);
  return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/owner-login")
    ? null : `status ${res.status}`;
});
await check("/session tanpa login dialihkan ke login", async () => {
  const res = await get("/session");
  return res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/login") ? null : `status ${res.status}`;
});
await check("Webhook QRIS tanpa secret ditolak", async () =>
  expectStatus(await post("/api/webhook/qris", { amount: 1000 }), 401, 403));

await check("PIN salah dikunci setelah 5 kali", async () => {
  const merchantId = `smoke-test-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    const r = await post("/api/auth/pedagang", { merchantId, pin: "9999" });
    if (r.status !== 401) return `percobaan ${i + 1}: status ${r.status}, harusnya 401`;
  }
  return expectStatus(await post("/api/auth/pedagang", { merchantId, pin: "9999" }), 429);
});

const { SMOKE_MERCHANT_ID, SMOKE_PIN } = process.env;
if (SMOKE_MERCHANT_ID && SMOKE_PIN) {
  const login = await post("/api/auth/pedagang", { merchantId: SMOKE_MERCHANT_ID, pin: SMOKE_PIN });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  await check("Login pedagang memberi cookie httpOnly", async () =>
    login.ok && /httponly/i.test(login.headers.get("set-cookie") ?? "") ? null : `status ${login.status}`);
  await check("Pedagang tidak bisa membaca ledger pemilik", async () => expectStatus(await get("/api/ledger", cookie), 403));
  await check("Pedagang hanya melihat sesinya sendiri", async () => {
    const rows = await (await get("/api/session", cookie)).json();
    const others = rows.filter((s) => s.merchantId !== SMOKE_MERCHANT_ID);
    return others.length ? `${others.length} sesi milik merchant lain terlihat` : null;
  });
  await check("Respons API tidak memuat PIN", async () => {
    const text = await (await get("/api/session", cookie)).text();
    return /"pin"/.test(text) ? "ada field pin" : null;
  });
}

console.log(failed ? `\n${failed} pemeriksaan gagal.` : "\nSemua pemeriksaan lolos.");
process.exitCode = failed ? 1 : 0;

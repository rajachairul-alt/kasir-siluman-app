#!/usr/bin/env node
// Voice-pipeline accuracy test (rencana A5). Node 18+, no dependencies.
//
//   node eval/voice/voice_eval.mjs record        recorder page on http://localhost:5055
//   node eval/voice/voice_eval.mjs run [tag]     send every recording through the Langflow flow
//   node eval/voice/voice_eval.mjs report [tag]  rebuild results/<tag>/summary.md + results.csv
//   node eval/voice/voice_eval.mjs selftest      checks phrases.csv and the regex baseline
//
// The flow is called exactly like src/app/api/voice/extract/route.ts does
// (upload → run with the STT tweak → delete), but with output_type "debug" we
// also keep the Whisper transcript, so the regex baseline runs on the same text.
import http from "node:http";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const REC_DIR = path.join(HERE, "recordings");
const STT_NAME = "Speech-to-Text (Groq Whisper)";
const PARSER_NAME = "Structured Output Parser";
const MIME = { webm: "audio/webm", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav" };
const UPLOAD_EXT = { webm: "webm", ogg: "ogg", opus: "ogg", m4a: "m4a", mp4: "m4a", mp3: "mp3", wav: "wav" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── data files ───────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim().replace(/^﻿/, ""), (r[i] ?? "").trim()])));
}

const csvCell = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

function loadPhrases() {
  return parseCsv(readFileSync(path.join(HERE, "phrases.csv"), "utf8")).map((r) => ({
    ...r,
    nominal: r.nominal === "" ? null : Number(r.nominal),
    tutup_buku: r.tutup_buku === "1",
  }));
}

// recordings/<speaker>__<id>.<ext>
function listRecordings() {
  if (!existsSync(REC_DIR)) return [];
  const seen = new Set();
  return readdirSync(REC_DIR).flatMap((name) => {
    const m = name.match(/^([a-z0-9-]+)__([A-Za-z0-9]+)\.([a-z0-9]+)$/);
    if (!m || !(m[3] in MIME) || seen.has(`${m[1]}__${m[2]}`)) return [];
    seen.add(`${m[1]}__${m[2]}`);
    return [{ speaker: m[1], id: m[2], ext: m[3], key: `${m[1]}__${m[2]}`, file: path.join(REC_DIR, name) }];
  });
}

function readRaw(file) {
  if (!existsSync(file)) return [];
  const byKey = new Map();
  for (const line of readFileSync(file, "utf8").split("\n")) if (line.trim()) { const r = JSON.parse(line); byKey.set(r.key, r); }
  return [...byKey.values()];
}

function loadEnv() {
  const env = {};
  for (const f of [".env", ".env.local"]) {
    const p = path.join(REPO, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return { ...env, ...process.env };
}

// ── baseline: regex + slang dictionary, no language model ───────────────────
const DIGIT = { nol: 0, satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9 };
const SLANG = { seceng: 1000, noceng: 2000, goceng: 5000, ceban: 10000, noban: 20000, goban: 50000, gocap: 50000, cepek: 100000 };
const CLOSING = /\b(tutup|selesai|segitu (aja|saja)|totalnya|total hari ini)\b/; // same cues as the flow's prompt

export function baseline(text) {
  const s = text.toLowerCase().replace(/\brp\.?\s*/g, " ");
  const found = [];
  let st = null;
  const cur = () => (st ??= { total: 0, group: 0, unit: 0, half: 0, scaled: false });
  const flush = () => { if (st) found.push({ value: st.total + st.group + st.unit + st.half, scaled: st.scaled }); st = null; };
  const scale = (m) => { const c = cur(); c.total += (c.group + c.unit + c.half || 1) * m; c.group = c.unit = c.half = 0; c.scaled = true; };
  for (const t of s.match(/\d+(?:[.,]\d+)*|[a-z]+/g) ?? []) {
    const n = t.replace(/ch/g, "c"); // Whisper spells slang either way: gocheng / goceng
    const w = { rebu: "ribu", rb: "ribu", ribuan: "ribu", k: "ribu", seribuan: "seribu", jt: "juta" }[n] ?? n;
    if (/^\d/.test(w)) {
      if (st?.unit || st?.group) flush();
      cur().unit = /^\d{1,3}([.,]\d{3})+$/.test(w) ? Number(w.replace(/[.,]/g, "")) : Number(w.replace(",", "."));
    } else if (w in DIGIT) { if (st?.unit) flush(); cur().unit = DIGIT[w]; }
    else if (w === "sepuluh") cur().group += 10;
    else if (w === "sebelas") cur().group += 11;
    else if (w === "belas") { const c = cur(); c.group += c.unit + 10; c.unit = 0; }
    else if (w === "puluh") { const c = cur(); c.group += c.unit * 10; c.unit = 0; }
    else if (w === "seratus") cur().group += 100;
    else if (w === "ratus") { const c = cur(); c.group += (c.unit || 1) * 100; c.unit = 0; }
    else if (w === "seribu") { cur().total += 1000; st.scaled = true; }
    else if (w === "sejuta") { cur().total += 1e6; st.scaled = true; }
    else if (w === "ribu") scale(1000);
    else if (w === "juta") scale(1e6);
    else if (w === "setengah") { if (st) st.half = 0.5; }
    else if (w in SLANG) { flush(); found.push({ value: SLANG[w], scaled: true }); }
    else flush();
  }
  flush();
  const cands = found.filter((f) => f.value > 0);
  const scaled = cands.filter((f) => f.scaled || f.value >= 1000);
  let amount = null;
  if (scaled.length) amount = Math.max(...scaled.map((f) => f.value));
  else if (cands.length) {
    const v = Math.max(...cands.map((f) => f.value));
    amount = v < 1000 ? Math.round(v * 1000) : v; // street-food prices are never below Rp1.000, so "dua puluh" means 20 ribu
  }
  return { amount, isClosingReport: CLOSING.test(s) };
}

// ── record: local page that saves straight into recordings/ ─────────────────
function record(port = 5055) {
  const phrases = loadPhrases();
  const ids = new Set(phrases.map((p) => p.id));
  mkdirSync(REC_DIR, { recursive: true });
  const send = (res, code, body, type = "text/plain; charset=utf-8") => { res.writeHead(code, { "Content-Type": type }); res.end(body); };
  http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/") return send(res, 200, readFileSync(path.join(HERE, "recorder.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/state")
      return send(res, 200, JSON.stringify({ phrases, done: listRecordings().map((r) => r.key) }), "application/json");
    if (req.method === "POST" && url.pathname === "/save") {
      const speaker = url.searchParams.get("speaker") ?? "", id = url.searchParams.get("id") ?? "", ext = url.searchParams.get("ext") ?? "";
      if (!/^[a-z0-9-]{1,20}$/.test(speaker) || !ids.has(id) || !["webm", "ogg", "m4a"].includes(ext)) return send(res, 400, "parameter tidak valid");
      const chunks = [];
      let size = 0;
      req.on("data", (c) => { size += c.length; if (size > 20e6) req.destroy(); else chunks.push(c); });
      req.on("end", () => {
        writeFileSync(path.join(REC_DIR, `${speaker}__${id}.${ext}`), Buffer.concat(chunks));
        send(res, 200, "ok");
      });
      return;
    }
    send(res, 404, "not found");
  }).listen(port, "127.0.0.1", () => console.log(`Perekam siap: buka http://localhost:${port} di Chrome. Tekan Ctrl+C kalau sudah selesai.`));
}

// ── run: one recording through the real flow ────────────────────────────────
function artifactText(outputs, name) {
  const o = outputs.find((x) => x.component_display_name === name);
  if (!o) return null;
  const a = Object.values(o.artifacts ?? {})[0];
  for (const v of [a?.raw, a?.repr, Object.values(o.outputs ?? {})[0]?.message, Object.values(o.results ?? {})[0]?.text])
    if (typeof v === "string") return v;
  return null;
}

// same coercion as toVoiceExtractionResult() in the API route
function toResult(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    amount: typeof d.amount === "number" && Number.isFinite(d.amount) ? d.amount : null,
    confidence: typeof d.confidence === "number" && Number.isFinite(d.confidence) ? Math.max(0, Math.min(1, d.confidence)) : null,
    isClosingReport: d.isClosingReport === true,
    itemLabel: typeof d.itemLabel === "string" && d.itemLabel ? d.itemLabel : null,
  };
}

async function runOne(cfg, rec) {
  const headers = { "x-api-key": cfg.apiKey, "ngrok-skip-browser-warning": "true" };
  const t0 = Date.now();
  let filePath = null;
  try {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(rec.file)], { type: MIME[rec.ext] }), `eval-${rec.speaker}-${rec.id}.${UPLOAD_EXT[rec.ext]}`);
    const up = await fetch(`${cfg.base}/api/v1/files/upload/${cfg.flowId}`, { method: "POST", headers, body: form });
    if (!up.ok) throw new Error(`unggah ${up.status}: ${(await up.text()).slice(0, 200)}`);
    filePath = (await up.json()).file_path;
    let outputs = null, lastErr = null;
    for (let attempt = 1; attempt <= 3 && !outputs; attempt++) { // same retry policy as src/lib/langflowRun.ts
      try {
        const r = await fetch(`${cfg.base}/api/v1/run/${cfg.flowId}?stream=false`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ input_value: "", input_type: "text", output_type: "debug", tweaks: { [cfg.sttId]: { audio_file: filePath } } }),
        });
        if (!r.ok) throw new Error(`run ${r.status}: ${(await r.text()).slice(0, 300)}`);
        const outs = (await r.json()).outputs?.[0]?.outputs ?? [];
        if (!outs.length) throw new Error("Langflow mengembalikan outputs kosong");
        outputs = outs;
      } catch (e) { lastErr = e; await sleep(500 * attempt); }
    }
    if (!outputs) throw lastErr;
    const parserText = artifactText(outputs, PARSER_NAME);
    if (parserText == null) throw new Error(`komponen "${PARSER_NAME}" tidak ditemukan; yang ada: ${outputs.map((o) => o.component_display_name).join(", ")}`);
    return { ...toResult(JSON.parse(parserText)), transcript: artifactText(outputs, STT_NAME), components: outputs.map((o) => o.component_display_name), ms: Date.now() - t0 };
  } finally {
    if (filePath) await fetch(`${cfg.base}/api/v1/files/delete/${cfg.flowId}/${filePath.split("/").pop()}`, { method: "DELETE", headers }).catch(() => {});
  }
}

async function run(tag) {
  const env = loadEnv();
  const need = (k) => { if (!env[k]) throw new Error(`${k} belum diisi di .env`); return env[k]; };
  const cfg = {
    base: need("LANGFLOW_BASE_URL").replace(/\/+$/, ""),
    flowId: need("LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID"),
    apiKey: need("LANGFLOW_API_KEY"),
    sttId: need("LANGFLOW_VOICE_STT_COMPONENT_ID"),
  };
  const outDir = path.join(HERE, "results", tag);
  mkdirSync(outDir, { recursive: true });
  const rawFile = path.join(outDir, "raw.jsonl");
  const done = new Set(readRaw(rawFile).map((r) => r.key));
  const phrases = new Map(loadPhrases().map((p) => [p.id, p]));
  const recs = listRecordings();
  const unknown = recs.filter((r) => !phrases.has(r.id));
  if (unknown.length) console.log(`Diabaikan (ID tidak ada di phrases.csv): ${unknown.map((r) => r.key).join(", ")}`);
  const todo = recs.filter((r) => phrases.has(r.id) && !done.has(r.key));
  console.log(`${todo.length} rekaman akan diproses ke results/${tag} (${done.size} sudah ada).`);
  let failed = 0, warned = false;
  for (const [i, rec] of todo.entries()) {
    try {
      const r = await runOne(cfg, rec);
      if (r.transcript == null && !warned) {
        warned = true;
        console.log(`  Peringatan: transkrip Whisper tidak ditemukan di output debug (komponen: ${r.components.join(", ")}). Baseline tidak bisa dihitung.`);
      }
      delete r.components;
      appendFileSync(rawFile, JSON.stringify({ key: rec.key, speaker: rec.speaker, id: rec.id, at: new Date().toISOString(), ...r }) + "\n");
      const p = phrases.get(rec.id);
      const ok = r.amount === p.nominal && r.isClosingReport === p.tutup_buku;
      console.log(`[${i + 1}/${todo.length}] ${rec.key} ${ok ? "BENAR" : "SALAH"}: ${r.isClosingReport ? "tutup buku " : ""}${r.amount ?? "null"} (harapan ${p.tutup_buku ? "tutup buku " : ""}${p.nominal ?? "null"}) | "${r.transcript ?? "?"}"`);
    } catch (e) {
      failed++;
      console.log(`[${i + 1}/${todo.length}] ${rec.key} GAGAL: ${e.message}`);
    }
    if (i < todo.length - 1) await sleep(3000); // Groq free tier is rate-limited per minute
  }
  if (failed) console.log(`${failed} rekaman gagal. Jalankan perintah yang sama lagi; yang sudah berhasil tidak diulang.`);
  report(tag);
}

// ── report ───────────────────────────────────────────────────────────────────
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const pct = (k, n) => (n ? `${k}/${n} (${Math.round((100 * k) / n)}%)` : "–");
const count = (rows, f) => rows.filter(f).length;
const rp = (n) => (n == null ? "null" : "Rp" + n.toLocaleString("id-ID"));
const expectText = (closing, amount) => `${closing ? "tutup buku " : ""}${rp(amount)}`;

function report(tag) {
  const outDir = path.join(HERE, "results", tag);
  const phrases = new Map(loadPhrases().map((p) => [p.id, p]));
  const rows = readRaw(path.join(outDir, "raw.jsonl")).filter((r) => phrases.has(r.id)).map((r) => {
    const p = phrases.get(r.id);
    const b = r.transcript == null ? null : baseline(r.transcript);
    return {
      ...r, p, b,
      okAmount: r.amount === p.nominal, okClose: r.isClosingReport === p.tutup_buku,
      bOkAmount: b != null && b.amount === p.nominal, bOkClose: b != null && b.isClosingReport === p.tutup_buku,
    };
  });
  if (!rows.length) return console.log(`Belum ada hasil di results/${tag}.`);
  rows.forEach((r) => { r.ok = r.okAmount && r.okClose; r.bOk = r.bOkAmount && r.bOkClose; });
  const withB = rows.filter((r) => r.b != null);
  const n = rows.length, nb = withB.length;
  const missing = listRecordings().filter((x) => phrases.has(x.id) && !rows.some((r) => r.key === x.key)).length;
  const speakers = [...new Set(rows.map((r) => r.speaker))].map((s) => `${s} (${count(rows, (r) => r.speaker === s)})`).join(", ");
  const groups = (key) => [...new Set(rows.map((r) => r.p[key]))];
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const ci = (k, m) => wilson(k, m).map((x) => Math.round(100 * x)).join("–");
  const k = count(rows, (r) => r.ok), kb = count(withB, (r) => r.bOk);
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  const q = (f) => (ms[Math.min(ms.length - 1, Math.floor(f * ms.length))] / 1000).toFixed(1);

  const lines = [
    `# Uji Akurasi Pipeline Suara Kasir Siluman (${tag})`,
    "",
    `Dibuat ${new Date().toISOString().slice(0, 10)} dengan \`eval/voice/voice_eval.mjs\`. ${n} rekaman dari ${speakers}; ${count(rows, (r) => r.p.kondisi === "tenang")} kondisi tenang dan ${count(rows, (r) => r.p.kondisi === "bising")} kondisi bising.`,
    "Penutur membacakan kalimat dari `phrases.csv`. Ini **bukan** rekaman transaksi pedagang asli.",
    ...(missing ? ["", `${missing} rekaman belum punya hasil karena gagal diproses, dan tidak dihitung di bawah.`] : []),
    "",
    "## Ringkasan",
    "",
    "| | Pipeline (Whisper + Granite) | Baseline (regex + kamus, tanpa model bahasa) |",
    "|---|---|---|",
    `| Nominal tepat | ${pct(count(rows, (r) => r.okAmount), n)} | ${pct(count(withB, (r) => r.bOkAmount), nb)} |`,
    `| Jenis ucapan tepat (transaksi / tutup buku) | ${pct(count(rows, (r) => r.okClose), n)} | ${pct(count(withB, (r) => r.bOkClose), nb)} |`,
    `| **Benar penuh** (nominal dan jenis) | **${pct(k, n)}**, CI 95% ${ci(k, n)}% | ${pct(kb, nb)}${nb ? `, CI 95% ${ci(kb, nb)}%` : ""} |`,
    "",
    "Baseline dijalankan pada transkrip Whisper yang sama, jadi selisih keduanya adalah sumbangan Granite dalam menafsirkan ucapan. Kalau Whisper salah dengar, keduanya ikut salah. CI 95% memakai interval Wilson.",
    "",
    "## Per kelas angka",
    "",
    "| Kelas | n | Pipeline benar penuh | Baseline benar penuh | Confidence rata-rata |",
    "|---|---|---|---|---|",
    ...groups("kelas").map((g) => {
      const rs = rows.filter((r) => r.p.kelas === g), bs = rs.filter((r) => r.b != null), c = avg(rs.map((r) => r.confidence).filter((x) => x != null));
      return `| ${g} | ${rs.length} | ${pct(count(rs, (r) => r.ok), rs.length)} | ${pct(count(bs, (r) => r.bOk), bs.length)} | ${c == null ? "–" : c.toFixed(2)} |`;
    }),
    "",
    "## Per kondisi",
    "",
    "| Kondisi | n | Pipeline benar penuh | Baseline benar penuh |",
    "|---|---|---|---|",
    ...groups("kondisi").map((g) => {
      const rs = rows.filter((r) => r.p.kondisi === g), bs = rs.filter((r) => r.b != null);
      return `| ${g} | ${rs.length} | ${pct(count(rs, (r) => r.ok), rs.length)} | ${pct(count(bs, (r) => r.bOk), bs.length)} |`;
    }),
    "",
    "## Kalau confidence dipakai sebagai ambang",
    "",
    "Dihitung dari ucapan yang menghasilkan nominal. Ucapan di bawah ambang bisa dimintakan konfirmasi ke pedagang (rencana B2, belum ada di aplikasi).",
    "",
    "| Ambang | Diterima otomatis | Benar di antara yang diterima |",
    "|---|---|---|",
    ...[0, 0.5, 0.7, 0.9].map((t) => {
      const withAmount = rows.filter((r) => r.amount != null), acc = withAmount.filter((r) => (r.confidence ?? 0) >= t);
      return `| ${t ? `≥ ${t}` : "tanpa ambang"} | ${pct(acc.length, withAmount.length)} | ${pct(count(acc, (r) => r.ok), acc.length)} |`;
    }),
    "",
    "## Waktu proses",
    "",
    `Median ${q(0.5)} detik, p90 ${q(0.9)} detik per rekaman (unggah ke Langflow, Whisper, Granite).`,
    "",
    "## Kesalahan pipeline",
    "",
    "| Rekaman | Ucapan | Harapan | Hasil pipeline | Transkrip Whisper |",
    "|---|---|---|---|---|",
    ...rows.filter((r) => !r.ok).map((r) =>
      `| ${r.key} | ${r.p.ucapan} | ${expectText(r.p.tutup_buku, r.p.nominal)} | ${expectText(r.isClosingReport, r.amount)} | ${(r.transcript ?? "?").replace(/\|/g, "/")} |`),
  ];
  writeFileSync(path.join(outDir, "summary.md"), lines.join("\n") + "\n");

  const cols = ["key", "speaker", "id", "kelas", "kondisi", "ucapan", "harapan_nominal", "harapan_tutup_buku", "transkrip", "pipeline_nominal", "pipeline_tutup_buku", "confidence", "item", "pipeline_benar", "baseline_nominal", "baseline_tutup_buku", "baseline_benar", "ms"];
  const csv = rows.map((r) => [r.key, r.speaker, r.id, r.p.kelas, r.p.kondisi, r.p.ucapan, r.p.nominal, r.p.tutup_buku ? 1 : 0, r.transcript, r.amount, r.isClosingReport ? 1 : 0, r.confidence, r.itemLabel, r.ok ? 1 : 0, r.b?.amount, r.b ? (r.b.isClosingReport ? 1 : 0) : "", r.b ? (r.bOk ? 1 : 0) : "", r.ms].map(csvCell).join(","));
  writeFileSync(path.join(outDir, "results.csv"), [cols.join(","), ...csv].join("\n") + "\n");
  console.log(`\nPipeline benar penuh ${pct(k, n)}; baseline ${pct(kb, nb)}.\nRingkasan: eval/voice/results/${tag}/summary.md`);
}

// ── selftest ─────────────────────────────────────────────────────────────────
function selftest() {
  const phrases = loadPhrases();
  const ids = phrases.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ID di phrases.csv harus unik");
  for (const p of phrases) {
    assert.match(p.id, /^[A-Za-z0-9]+$/, `ID ${p.id}`);
    assert.ok(p.nominal === null || Number.isInteger(p.nominal), `nominal ${p.id}`);
    assert.ok(["tenang", "bising"].includes(p.kondisi), `kondisi ${p.id}`);
    assert.ok(p.ucapan, `ucapan ${p.id}`);
  }
  const cases = [
    ["Es teh lima ribu", 5000, false], ["Bakso Rp25.000", 25000, false], ["bakso 25 ribu", 25000, false], ["15rb", 15000, false],
    ["Teh tarik tiga ribu lima ratus", 3500, false], ["Cilok seribu lima ratus", 1500, false], ["Nasi uduk dua belas ribu lima ratus", 12500, false],
    ["Es campur tujuh setengah", 7500, false], ["lontong tiga setengah ribu", 3500, false], ["Ayam geprek dua puluh", 20000, false],
    ["Tumpeng seratus dua puluh ribu", 120000, false], ["Kue pesanan dua ratus lima puluh ribu", 250000, false], ["2,5 juta", 2500000, false],
    ["Nasi bungkus goceng dua", 5000, false], ["Nasi Bungkus Gocheng 2", 5000, false], ["Es campur 7,5.", 7500, false], ["Kopi dua, tiga ribuan", 3000, false], ["Es batu noceng", 2000, false],
    ["Tutup buku, totalnya tiga ratus empat puluh ribu", 340000, true], ["Tutup, uang tunai empat ratus lima belas ribu", 415000, true],
    ["Total hari ini satu juta dua ratus ribu", 1200000, true], ["Segitu aja hari ini, total Rp520.000", 520000, true],
    ["Hujan deras dari tadi siang", null, false], ["Mas, tolong ambilin plastik.", null, false],
  ];
  for (const [text, amount, closing] of cases) assert.deepEqual(baseline(text), { amount, isClosingReport: closing }, text);
  const [lo, hi] = wilson(8, 10);
  assert.ok(Math.abs(lo - 0.49) < 0.01 && Math.abs(hi - 0.943) < 0.01, "wilson");
  console.log(`selftest ok: ${phrases.length} kalimat di phrases.csv, ${cases.length} kasus baseline.`);
}

const [cmd, tag = "v1"] = process.argv.slice(2);
if (cmd === "record") record();
else if (cmd === "run") run(tag).catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === "report") report(tag);
else if (cmd === "selftest") selftest();
else console.log("Pakai: node eval/voice/voice_eval.mjs record | run [tag] | report [tag] | selftest");

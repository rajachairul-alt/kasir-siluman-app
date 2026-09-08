<p align="center">
  <img src="public/logo.png" alt="Kasir Siluman logo" width="120" />
</p>

<h1 align="center">Kasir Siluman</h1>

**Automatic financial copilot for street-food cart vendors and Indonesian micro-merchants** — built for the **HACKTIV8 × IBM SkillsBuild National Hackathon**.

Kasir Siluman records a street vendor's transactions without them ever typing a number. Every ledger line comes from a real event — a QRIS payment or a price spoken out loud while selling — and is automatically reconciled against the vendor's own spoken closing report at the end of the day. Any gap is surfaced to the owner as-is, never smoothed over.

## The problem

Cart vendors and micro-merchants rarely keep consistent transaction records — manual bookkeeping interrupts selling, and conventional POS apps still require typing every line. The result is no trustworthy revenue data to detect cash leakage or plan savings.

## Core concept

> **A ledger line is only valid if it comes from a real event.** There is no path — for the vendor or the owner — to type in a transaction manually.

One selling session ("Open Stall" → sell → "Close Books"):

1. **QRIS** — exact amount from the payment webhook, real-time.
2. **Voice** — cash estimate extracted by AI from ambient audio while the vendor sells.
3. **Closing report** — the total the vendor states out loud at the end of the session.

The system compares **(2) vs (3)**: `varianceAmount = |voiceCashEstimate − closingReportTotal|`, 5% tolerance. QRIS is deliberately excluded from this comparison — it's already verified automatically by the payment system — and is shown alongside only as an informative reference. A session is **RECONCILED** (within tolerance) or **FLAGGED** (needs the owner's attention), and FLAGGED sessions are surfaced prominently on the dashboard, never buried in a table column.

## Features

| Feature | Status |
|---|---|
| Open/close session, zero forms | ✅ |
| Voice price capture (mic active only while a session is open) | ✅ Langflow + watsonx.ai |
| QRIS webhook (idempotent, HMAC-ready) + one-tap simulation for demos | ✅ |
| Three-way reconciliation with a categorized breakdown card | ✅ |
| Owner dashboard: FLAGGED banner, revenue summary, per-merchant filter | ✅ |
| Radar Tetangga — anonymized average price of nearby vendors | ✅ Langflow (deterministic, non-LLM) |
| Generative Promo — poster copy from real sales data | ✅ Langflow + watsonx.ai |
| Monthly savings (10% suggestion, vendor confirm/decline) + history | ✅ |
| Audit log — every agent decision recorded, shown on the dashboard | ✅ |
| 5 watsonx Orchestrate agents (governance layer) | ✅ |
| PWA (Add to Home Screen) | ✅ |

The one piece still simulated for demo purposes: QRIS payments use a one-tap simulation button rather than a live aggregator connection (Midtrans/Xendit/etc.). The real webhook endpoint is fully built and ready — see the `TODO` comments in `src/app/api/webhook/qris/route.ts`.

## Why this isn't just an LLM wrapper

- **Reconciliation and price aggregation are computed deterministically in code, never by an LLM.** The LLM is only used for language extraction (transcript → price, sales context → promo copy) — never for the arithmetic that determines the product's trust claim.
- **Layered privacy**: the microphone is released the instant a session closes, raw audio is never persisted, and Radar Tetangga suppresses its result whenever the sample is fewer than 2 vendors — one vendor's price is never leaked to another.
- **Governance that actually runs**: `AuditLog` entries are written directly from the API code path (not dependent on the Orchestrate agents being invoked), so the decision trail survives even if one layer fails.
- **Resilience by design**: calls into Langflow (which occasionally hit transient connection resets talking to watsonx.ai's cloud endpoint) are wrapped in automatic retry — see `src/lib/langflowRun.ts`.

## Tech stack (IBM-first)

| Layer | Technology |
|---|---|
| AI extraction & generation | **IBM watsonx.ai** (Granite), orchestrated via **Langflow** — 3 pipelines: Voice-to-Transaction, Radar Tetangga, Generative Promo |
| Agent & governance layer | **IBM watsonx Orchestrate** — 5 agents (Listener, Payment-Event, Reconciliation, Radar Tetangga, Growth), OpenAPI-based tools |
| Application | Next.js 14 (App Router) + TypeScript, Tailwind CSS |
| Data | Prisma ORM + SQLite (Turso/libSQL in production) |

Next.js was chosen so one repo runs both the frontend and the API without a separate backend — realistic for a small team on a tight timeline.

## Architecture

```
Vendor (phone)  /session  ──┐
                             ├──►  Next.js (App Router)
Owner (web)     /dashboard ─┘        │
                                      ├── Prisma + SQLite/Turso
QRIS aggregator ──► /api/webhook/qris│
  (real webhook, shared-secret auth) │
                                      ├── /api/voice/extract  ─┐
                                      ├── /api/radar           ├──► Langflow (3 pipelines) ──► IBM watsonx.ai
                                      ├── /api/promo/generate ─┘        (retried automatically on failure)
                                      │
                                      └── /api/internal/audit-log ──► watsonx Orchestrate (5 agents)
```

Design principles that matter here:

- **Next.js is the only inbound endpoint for third parties.** The QRIS aggregator's webhook always lands on Next.js, never on Orchestrate — Orchestrate cannot serve as a third-party inbound endpoint. The Payment-Event agent audits what Next.js already received; it doesn't replace the webhook.
- **The frontend calls Next.js directly**, never through Orchestrate — Orchestrate is a parallel governance/automation layer, not a replacement for the already-verified flow.
- **`AuditLog` fills independently of Orchestrate** — `writeAuditLog()` is called directly from the API route handlers, so the governance trail works at demo time regardless of whether all five agents are actively invoked.

## Data model

Five Prisma models (`prisma/schema.prisma`): `Merchant` → has many `Session`; each `Session` holds `qrisTotal`, `voiceCashEstimate`, `closingReportTotal`, and the computed `varianceAmount`, plus its `Transaction[]` (each tagged `source: "qris" | "voice"`, never manually entered); `SavingsProposal` (one per merchant per month, `PENDING_SELLER_CONFIRMATION` → `CONFIRMED`/`DECLINED`); and the append-only `AuditLog`.

Note on naming: `SavingsProposal.netProfit` is actually a **recorded-revenue proxy** (`qrisTotal + voiceCashEstimate`), not true net profit — the app doesn't track costs yet, and the UI always labels it "recorded revenue," never "net profit."

## API surface

| Method & path | Purpose |
|---|---|
| `POST /api/session` · `GET /api/session` | Open a session · list recent sessions |
| `POST /api/session/:id/close` | Close a session, run reconciliation, write the audit log |
| `POST /api/transactions` | Record one captured event (`source: "qris"` or `"voice"`) against an open session |
| `POST /api/webhook/qris` | Real inbound QRIS webhook, idempotent, shared-secret auth |
| `POST /api/voice/extract` | Audio → Langflow Voice-to-Transaction → extracted price/label |
| `POST /api/radar` | Item label → Langflow Radar Tetangga → neighborhood average |
| `GET /api/promo/context` · `POST /api/promo/generate` | Aggregate recent sales → Langflow Generative Promo → poster copy |
| `GET /api/savings` · `POST /api/savings/generate` · `POST /api/savings/:id/confirm`/`decline` | Monthly savings proposal lifecycle |
| `GET /api/ledger` | Dashboard data source: closed sessions + merchant list |
| `GET /api/audit-log` | Public read-only governance log |
| `GET/POST /api/internal/audit-log` · `GET /api/internal/item-prices` | Internal, shared-secret, server-to-server only |

## Running locally

```bash
npm install
cp .env.example .env      # fill in the variables — see INSTALLATION_GUIDE.md
npm run db:push
npm run db:seed           # optional: sample data for the dashboard
npm run dev
```

Open `http://localhost:3000/session` (vendor view) and `/dashboard` (owner view).

**For environment variables, Langflow pipeline setup, watsonx Orchestrate agent registration, and production deployment (Vercel + Turso), see [`INSTALLATION_GUIDE.md`](./INSTALLATION_GUIDE.md).**

## Credits

HACKTIV8 × IBM SkillsBuild National Hackathon. Built on IBM watsonx.ai (Granite), Langflow, and IBM watsonx Orchestrate.

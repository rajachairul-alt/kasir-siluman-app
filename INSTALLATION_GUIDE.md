# Installation & Configuration Guide

Everything needed to run Kasir Siluman end to end: local setup, environment variables, the three Langflow pipelines, the five watsonx Orchestrate agents, and production deployment. This is the single reference for all of it — no other setup docs are needed.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 18+ and npm | For the Next.js app |
| An IBM Cloud account with watsonx.ai access | Project ID, API key, and region endpoint (e.g. `https://us-south.ml.cloud.ibm.com`) |
| Python 3.10+ and `pip` | To self-host Langflow |
| A watsonx Orchestrate tenant | For agent/tool registration |
| (Production only) A [Vercel](https://vercel.com) account and a [Turso](https://turso.tech) account | Hosting + database |

---

## 2. Local install

```bash
git clone <this-repo>
cd kasir-siluman-app
npm install
cp .env.example .env
npm run db:push      # creates dev.db (SQLite) from prisma/schema.prisma
npm run db:seed      # optional: sample data for the dashboard (3 sessions, 1 savings proposal, 5 audit log entries)
npm run dev
```

Visit `http://localhost:3000/session` (vendor view) and `http://localhost:3000/dashboard` (owner view). At this point, everything works **except** the three AI pipelines and the Orchestrate agents — set those up next.

---

## 3. Environment variables

Copy from `.env.example`. **Never commit `.env` with real values** — it's already in `.gitignore`.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Always | `file:./dev.db` locally; replaced by a Turso libSQL URL in production (section 7). |
| `QRIS_WEBHOOK_SECRET` | `/api/webhook/qris` | Matched against the `x-qris-webhook-secret` header. Change from the demo default before going live. |
| `QRIS_WEBHOOK_HMAC_SECRET`, `QRIS_AGGREGATOR_BASE_URL` | Future QRIS webhook | Fill in once a real aggregator (Midtrans/Xendit/Duitku) is connected — see the `TODO` in `src/app/api/webhook/qris/route.ts`. |
| `LANGFLOW_BASE_URL`, `LANGFLOW_API_KEY` | All 3 Langflow pipelines | Langflow instance URL and API key (Settings → Langflow API Keys). |
| `LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID`, `LANGFLOW_VOICE_STT_COMPONENT_ID` | Voice-to-Transaction | Flow ID and the Speech-to-Text node's component ID — see section 4.1. |
| `LANGFLOW_RADAR_TETANGGA_FLOW_ID`, `LANGFLOW_RADAR_AGGREGATOR_COMPONENT_ID` | Radar Tetangga | Flow ID and the aggregator node's component ID — see section 4.2. |
| `LANGFLOW_PROMO_FLOW_ID`, `LANGFLOW_PROMO_PROMPT_TEMPLATE_COMPONENT_ID` | Generative Promo | Flow ID and the Prompt Template node's component ID — see section 4.3. |
| `RADAR_INTERNAL_SECRET` | `/api/internal/item-prices` | Shared secret checked against `x-radar-internal-secret`. Called only by the Radar Tetangga Langflow component, server-to-server. Must also be set as a Langflow Global Variable of the same name. |
| `WATSONX_ORCHESTRATE_BASE_URL`, `WATSONX_ORCHESTRATE_API_KEY` | Orchestrate console | Used when registering tools from the Orchestrate side — Next.js never calls Orchestrate; the direction is the reverse. |
| `ORCHESTRATE_INTERNAL_SECRET` | `/api/internal/audit-log` | Shared secret checked against `x-orchestrate-internal-secret`. Must also be registered as a connection/credential in Orchestrate (section 5.5). |

---

## 4. Langflow pipelines

Self-host Langflow (`pip install langflow` then `langflow run`, default port 7860), or use Langflow Cloud. Build three flows. All three end in a component that returns a single clean JSON string — the Next.js routes look for that exact JSON shape, not any particular wording of it.

**Security note:** store the watsonx.ai API key and any other secret as a Langflow **Global Variable** (Settings → Global Variables), and reference it from the component field rather than pasting the raw value in — Langflow's flow-export JSON embeds whatever is typed directly into a field in plaintext, including credentials. If you ever export a flow for backup or sharing, check the exported JSON for embedded secrets before storing or sharing it. Flow exports are intentionally **not** committed to this repository for that reason.

### 4.1 Voice-to-Transaction

**Contract** (`src/app/api/voice/extract/route.ts`): receives an audio blob, uploads it to Langflow's per-flow file storage, runs the flow with the Speech-to-Text node's `audio_file` field tweaked to the uploaded path, and expects a component named exactly **`Structured Output Parser`** in the debug output whose JSON artifact matches:

```ts
{ amount?: number; itemLabel?: string; confidence?: number; isClosingReport: boolean }
```

Node chain: `Speech-to-Text (custom component, e.g. Whisper) → Prompt Template → IBM watsonx.ai (Granite, temp 0.1–0.2) → Structured Output Parser`.

The prompt must instruct the model to: (1) decide whether the transcript is a **closing-report phrase** (vendor announces the session is done and states a cash total) vs. an **ordinary transaction** (vendor states one order's price); (2) extract the Rupiah amount, handling market slang (`gocap` = 50,000, `goceng` = 5,000, `ceban` = 10,000, `cepek` = 100,000, etc.); (3) extract the item label if present; (4) return a confidence score; (5) reply with **only** the JSON object above, nothing else. A handful of few-shot examples covering a clean sale, a multi-item sale, a closing phrase, an ambiguous mumble, and non-transaction background chatter (`amount: null`) meaningfully improves accuracy.

After building it, get the flow ID from the Langflow canvas URL (`/flow/<id>`) and the Speech-to-Text node's component ID via `GET {LANGFLOW_BASE_URL}/api/v1/flows/<flow-id>` (look for the node whose `data.node.display_name` matches your STT component) — fill both into `.env`.

### 4.2 Radar Tetangga

**Contract** (`src/app/api/radar/route.ts`): receives `{ itemLabel }`, runs the flow tweaking the aggregator node's `item_label` field, and expects a component named exactly **`Radar Tetangga Aggregator`** whose JSON artifact matches:

```ts
{ itemLabel?: string; averagePrice?: number | null; sampleSize?: number }
```

**Do not let an LLM compute the average.** This must be a deterministic Python component: it calls `GET {NEXTJS_URL}/api/internal/item-prices?itemLabel=...` (protected by `RADAR_INTERNAL_SECRET`) to get a raw list of prices across all merchants for that item, then computes `average = sum(amounts) / len(amounts)` and `sampleSize = len(amounts)` itself. Enforce the suppression rule (`sampleSize < 2` → don't return an average) inside this component — a single merchant's price must never reach the browser disguised as an "average." The Next.js route double-checks this rule defensively, but the primary enforcement belongs here.

### 4.3 Generative Promo

**Contract** (`src/app/api/promo/generate/route.ts`): receives a `PromoContext` (`{ merchantName, recentItems: { itemLabel, count }[] }`, built server-side from real transaction history — never free text), runs the flow tweaking the Prompt Template node's `merchant_name` and `recent_items_text` fields, and expects a component named exactly **`Structured Output Parser`** whose JSON artifact matches:

```ts
{ posterText: string; imagePrompt: string }
```

Node chain: `Prompt Template → IBM watsonx.ai (Granite, temp 0.6–0.8) → Structured Output Parser`. The prompt should ask for a short (2–4 sentence), friendly poster caption highlighting the best-selling item as social proof, explicitly forbidding invented prices or discounts not present in the data, plus an English image-generation prompt describing that item.

---

## 5. watsonx Orchestrate

Five agents, each wrapping one Next.js endpoint via an OpenAPI tool (specs live in `orchestrate/openapi/*.yaml`), except Payment-Event which reads the audit log directly.

### 5.1 Create a connection

**Credentials → Add connection** — API Key type, header location, header name `x-orchestrate-internal-secret`, value equal to `ORCHESTRATE_INTERNAL_SECRET` from `.env`.

### 5.2 Import the 4 OpenAPI tools

**Build agents and tools → Import tool → Upload OpenAPI file**, one per file in `orchestrate/openapi/`. Before importing, replace the placeholder `servers.url` in each YAML with your deployed backend's actual URL (no trailing/leading whitespace — a stray space in that field causes an opaque "invalid URL: parse" error at call time).

**Every tool's OpenAPI spec must declare a `security`/`components.securitySchemes` block.** Orchestrate reads a tool's "Auth Type" purely from whether the spec declares one, at import time — not from whether a connection exists in your account. A tool imported from a spec with no `security` block is permanently registered as "No Auth," and its Connectors tab will read "No connections to display" as non-editable text with no way to attach a connection after the fact. If this happens, delete the tool and re-import it from a corrected spec, then select your connection at the "Connect" step during that re-import.

| File | Tool | Agent |
|---|---|---|
| `listener.yaml` | `ExtractVoiceTransaction` | Listener |
| `reconciliation.yaml` | `CloseSession` | Reconciliation |
| `radar-tetangga.yaml` | `GetNeighborhoodPricing` | Radar Tetangga |
| `growth.yaml` | `GeneratePromo` | Growth |
| `audit-log.yaml` | `GetAuditLog` | Payment-Event |

### 5.3 Create the five agents

**Build agents and tools → Create Agent → Create from scratch.** For each: set the name, paste the system prompt below, attach the one tool listed above.

- **Listener** — *"You extract prices and item names from audio recorded by vendors. Call ExtractVoiceTransaction with the received audio file and return its result verbatim. Never add data that isn't in the tool's output."*
- **Payment-Event** — *"You audit incoming QRIS payment events. The Next.js webhook already received the event; you read the log via GetAuditLog and summarize it for the store owner. Never modify or create new QRIS events."* This agent is an **auditor, not a webhook receiver** — the inbound QRIS webhook is handled by Next.js and cannot be replaced by Orchestrate, since Orchestrate can't serve as an inbound endpoint for a third-party aggregator. This is an intentional, documented architectural constraint.
- **Reconciliation** — *"You close a vendor's session by calling CloseSession with the session ID and the cash total the vendor reported. Report back concisely whether the result is RECONCILED or FLAGGED, and by how much."*
- **Radar Tetangga** — *"You look up the average price of an item from nearby vendors using GetNeighborhoodPricing. If there isn't enough data (fewer than 2 vendors), say so honestly rather than inventing a number."*
- **Growth** — *"You write promo text and an image prompt for a vendor based on their real recent sales, using GeneratePromo with the given context."*

### 5.4 Verification

Test each agent from its Draft Preview chat (with "Show Reasoning" open to inspect the tool call):

1. **Reconciliation**: `Close session <id> with a cash total of 150000` → expect a RECONCILED/FLAGGED response and a new row in the dashboard's "Log Keputusan Agent" table.
2. **Radar Tetangga**: `What's the average price of bakso nearby?` → expect a number or an honest "not enough data."
3. **Growth**: give a merchant name + item list → expect poster text + an image prompt.
4. **Payment-Event**: `Show me the last 5 QRIS events` → expect a table read from the audit log.
5. **Listener**: provide a sample audio file → expect an extracted amount + item label.

`npx tsc --noEmit` should report 0 errors regardless of Orchestrate registration status — `AuditLog` is populated directly from the API code (`writeAuditLog()`), not through Orchestrate, so the app and its governance trail work even before all five agents are wired up.

---

## 6. Reliability note

Calls from Langflow into the "IBM watsonx.ai" component have been observed to intermittently fail with a mid-request connection reset to the cloud endpoint, even with a correctly configured flow — retrying the same call immediately afterward succeeds. `src/lib/langflowRun.ts` wraps every Langflow call (`/api/voice/extract`, `/api/radar`, `/api/promo/generate`) with automatic retry (up to 3 attempts) to absorb this. If a demo run feels slightly slower than usual before a promo/voice/radar result appears, this is why — not the app hanging.

---

## 7. Production deployment (Vercel + Turso)

The local SQLite file (`prisma/dev.db`) does not persist across requests on a serverless host. For a permanent, shareable deployment:

### 7.1 Push to GitHub

```bash
git init   # if not already a repo
git add -A && git status   # confirm .env is NOT listed
git commit -m "Initial commit"
git remote add origin https://github.com/<you>/kasir-siluman-app.git
git branch -M main && git push -u origin main
```

### 7.2 Create a Turso database

```bash
irm get.tur.so/install.ps1 | iex     # Windows PowerShell; see turso.tech/docs for macOS/Linux
turso auth login
turso db create kasir-siluman
turso db show kasir-siluman --url          # → libsql://kasir-siluman-<you>.turso.io
turso db tokens create kasir-siluman       # → auth token
```

### 7.3 Push the schema

```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > schema.sql
turso db shell kasir-siluman < schema.sql
turso db shell kasir-siluman ".tables"     # confirm Merchant, Session, Transaction, SavingsProposal, AuditLog exist
```

### 7.4 Switch Prisma to the libSQL driver adapter

```bash
npm install @libsql/client @prisma/adapter-libsql
```

In `prisma/schema.prisma`:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["driverAdapters"]
}

datasource db {
  provider = "sqlite"
  url      = env("TURSO_DATABASE_URL")
}
```

In `src/lib/db.ts`:

```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const libsql = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const adapter = new PrismaLibSQL(libsql);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter });
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
```

```bash
npx prisma generate
```

Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to `.env`, test locally (`npm run dev`), then commit and push.

### 7.5 Deploy to Vercel

vercel.com → **Add New → Project** → import the GitHub repo. Before deploying, add every variable from section 3 (plus `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`) as an Environment Variable. Deploy.

Seed the production database (your local `db.ts` now points at Turso, so a local seed lands in production):

```bash
npm run db:seed
```

### 7.6 Repoint the Orchestrate tools

Update `servers.url` in each `orchestrate/openapi/*.yaml` to the new Vercel domain, then in the Orchestrate console either update each tool's source or delete-and-reimport it (re-attaching the existing connection at the Connect step). Re-run the verification checklist in section 5.4 against the new URL.

---

## Troubleshooting notes (real issues hit during setup)

- **`npx prisma migrate dev` prompts a destructive database reset ("Drift detected... All data will be lost")** — do not confirm this against a dev database with seeded demo data. Use `npx prisma db push` instead, which syncs the SQLite schema non-destructively, then `npx prisma generate`.
- **`TypeError: Cannot read properties of undefined (reading 'findMany')`** after adding a Prisma model — the client wasn't regenerated. Run `npx prisma generate`.
- **`invalid URL: parse " https://..."` when an Orchestrate tool calls your backend** — a leading/trailing space inside the quoted `servers.url` string in that tool's OpenAPI YAML.
- **A tool call returns 401 "invalid signature" even though the connection's API key value is confirmed correct** — check the tool's Connectors tab. If it says "This tool uses No Auth," the OpenAPI spec it was imported from had no `security` block; fix the spec and re-import the tool (see section 5.2).

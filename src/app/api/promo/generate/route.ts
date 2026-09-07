import { NextRequest, NextResponse } from "next/server";
import type { PromoContext, PromoResult } from "@/lib/generativePromo";
import { runLangflowFlow, extractJsonArtifact } from "@/lib/langflowRun";

// POST /api/promo/generate
//
// Server-side seam between the seller UI and the Langflow
// "Kasir Siluman - Generative Promo" pipeline (BOB_BRIEF.md item #5).
//
// Receives a PromoContext (built by GET /api/promo/context from real
// Transaction data — never from free-text typed by the seller) and returns
// a PromoResult with poster copy and an image-generation prompt.
//
// Flow topology:
//   Prompt Template (merchant_name, recent_items_text)
//     → IBM watsonx.ai Granite (temp 0.7)
//     → Structured Output Parser (custom component)
//     → PromoResult JSON
//
// The pattern here is identical to src/app/api/radar/route.ts:
//   - POST to /api/v1/run/{flow_id}?stream=false with output_type:"debug"
//   - Tweak the Prompt Template node fields via the tweaks map
//   - Find the "Structured Output Parser" component in outputs[0].outputs
//   - JSON.parse its artifacts[<first key>].raw
//
// Required env vars (see .env.example):
//   LANGFLOW_BASE_URL                          e.g. "http://localhost:7860"
//   LANGFLOW_PROMO_FLOW_ID                     flow UUID
//   LANGFLOW_API_KEY                           Langflow API key
//   LANGFLOW_PROMO_PROMPT_TEMPLATE_COMPONENT_ID  node id of Prompt Template
//                                              (tweaks target for merchant_name
//                                              and recent_items_text)

const STRUCTURED_OUTPUT_DISPLAY_NAME = "Structured Output Parser";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Env var ${name} belum diisi — lihat .env.example.`);
  }
  return value;
}

export async function POST(req: NextRequest) {
  let baseUrl: string;
  let flowId: string;
  let apiKey: string;
  let promptComponentId: string;

  try {
    baseUrl = getRequiredEnv("LANGFLOW_BASE_URL").replace(/\/+$/, "");
    flowId = getRequiredEnv("LANGFLOW_PROMO_FLOW_ID");
    apiKey = getRequiredEnv("LANGFLOW_API_KEY");
    promptComponentId = getRequiredEnv("LANGFLOW_PROMO_PROMPT_TEMPLATE_COMPONENT_ID");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Konfigurasi Langflow tidak lengkap.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ── Parse and validate incoming PromoContext ───────────────────────────────
  let context: PromoContext;
  try {
    context = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body bukan JSON yang valid" }, { status: 400 });
  }

  if (!context.merchantName || !Array.isArray(context.recentItems)) {
    return NextResponse.json(
      { error: "PromoContext tidak valid: butuh merchantName dan recentItems[]" },
      { status: 400 }
    );
  }

  // ── Format recentItems into the string the prompt expects ──────────────────
  // "bakso (12 kali terjual), es teh (8 kali terjual), gorengan (5 kali terjual)"
  const recentItemsText =
    context.recentItems.length > 0
      ? context.recentItems
          .map((item) => `${item.itemLabel} (${item.count} kali terjual)`)
          .join(", ")
      : "(belum ada data penjualan cukup)";

  // ── Call Langflow ──────────────────────────────────────────────────────────
  // Retries a few times on network/connection-reset flakiness talking to
  // watsonx.ai — see src/lib/langflowRun.ts for why this is needed.
  try {
    const componentOutputs = await runLangflowFlow(baseUrl, flowId, apiKey, {
      [promptComponentId]: {
        merchant_name: context.merchantName,
        recent_items_text: recentItemsText,
      },
    });

    const parsed = extractJsonArtifact(componentOutputs, STRUCTURED_OUTPUT_DISPLAY_NAME);

    // ── Defensive coercion (Structured Output Parser already validates, but
    //    double-check so the browser never receives a malformed PromoResult) ──
    const data = (
      typeof parsed === "object" && parsed !== null ? parsed : {}
    ) as Record<string, unknown>;

    const result: PromoResult = {
      posterText:
        typeof data.posterText === "string" && data.posterText.trim()
          ? data.posterText
          : "Yuk mampir ke lapak kami — banyak pilihan makanan lezat menanti!",
      imagePrompt:
        typeof data.imagePrompt === "string" && data.imagePrompt.trim()
          ? data.imagePrompt
          : "Street food cart with delicious Indonesian food, warm lighting, appetizing food photography",
    };

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Terjadi kesalahan tak dikenal saat memanggil Langflow.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

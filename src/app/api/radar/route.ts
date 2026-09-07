import { NextRequest, NextResponse } from "next/server";
import type { NeighborhoodPricing } from "@/lib/radarTetangga";
import { runLangflowFlow, extractJsonArtifact } from "@/lib/langflowRun";

// POST /api/radar
//
// Server-side seam between the seller UI and the Langflow "Radar Tetangga"
// pipeline (BOB_BRIEF.md item #4, Langflow-Pipeline-Specs.md section 2).
//
// The pipeline's aggregation (average, sample size, the sampleSize < 2
// suppression rule) is computed deterministically in a Python component
// inside the flow — never by an LLM — see the flow's "Radar Tetangga
// Aggregator" custom component and /api/internal/item-prices, which it
// calls. This route just forwards the request and reshapes the response.
//
// Required env vars (see .env.example):
//   LANGFLOW_BASE_URL, LANGFLOW_RADAR_TETANGGA_FLOW_ID, LANGFLOW_API_KEY,
//   LANGFLOW_RADAR_AGGREGATOR_COMPONENT_ID

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Env var ${name} belum diisi — lihat .env.example.`);
  }
  return value;
}

const AGGREGATOR_DISPLAY_NAME = "Radar Tetangga Aggregator";

export async function POST(req: NextRequest) {
  let baseUrl: string;
  let flowId: string;
  let apiKey: string;
  let aggregatorComponentId: string;

  try {
    baseUrl = getRequiredEnv("LANGFLOW_BASE_URL").replace(/\/+$/, "");
    flowId = getRequiredEnv("LANGFLOW_RADAR_TETANGGA_FLOW_ID");
    apiKey = getRequiredEnv("LANGFLOW_API_KEY");
    aggregatorComponentId = getRequiredEnv("LANGFLOW_RADAR_AGGREGATOR_COMPONENT_ID");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Konfigurasi Langflow tidak lengkap.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let body: { itemLabel?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body bukan JSON yang valid" }, { status: 400 });
  }

  const itemLabel = typeof body.itemLabel === "string" ? body.itemLabel.trim() : "";
  if (!itemLabel) {
    return NextResponse.json({ error: "Field 'itemLabel' wajib diisi" }, { status: 400 });
  }

  try {
    // Retries a few times on network/connection-reset flakiness talking to
    // watsonx.ai — see src/lib/langflowRun.ts for why this is needed.
    const componentOutputs = await runLangflowFlow(baseUrl, flowId, apiKey, {
      [aggregatorComponentId]: { item_label: itemLabel },
    });

    const parsed = extractJsonArtifact(componentOutputs, AGGREGATOR_DISPLAY_NAME) as {
      itemLabel?: string;
      averagePrice?: number | null;
      sampleSize?: number;
    };

    // Suppression rule (sampleSize < 2) is enforced inside the Python
    // component, but this is checked again here defensively — a single
    // merchant's price must never reach the browser under the guise of an
    // "average".
    if (
      typeof parsed.averagePrice !== "number" ||
      typeof parsed.sampleSize !== "number" ||
      parsed.sampleSize < 2
    ) {
      return new NextResponse(null, { status: 204 });
    }

    const result: NeighborhoodPricing = {
      itemLabel: parsed.itemLabel ?? itemLabel,
      averagePrice: parsed.averagePrice,
      sampleSize: parsed.sampleSize,
    };
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan tak dikenal saat memanggil Langflow.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

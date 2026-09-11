import { NextRequest, NextResponse } from "next/server";
import type { VoiceExtractionResult } from "@/lib/voiceToTransaction";
import { runLangflowFlow, extractJsonArtifact } from "@/lib/langflowRun";

// POST /api/voice/extract
//
// Server-side seam between the browser's MediaRecorder blob and the
// Langflow "Kasir Siluman - Voice to Transaction" pipeline
// (Speech-to-Text (Gemini) → Prompt Template → IBM watsonx.ai →
// Structured Output Parser).
//
// Contract with the browser (src/lib/voiceToTransaction.ts):
//   - Receives multipart/form-data with a single field "audio" holding the
//     recorded Blob.
//   - Returns a VoiceExtractionResult JSON body on success.
//   - Returns { error: string } with a non-200 status on failure.
//
// Audio handling: the blob is read into memory, forwarded to Langflow's
// per-flow file storage (required so the Speech-to-Text component's
// FileInput can open it), then the uploaded copy is deleted again in a
// `finally` block. Nothing is written to this app's own database or disk —
// see BOB_BRIEF.md constraint on raw audio never being persisted.
//
// Required env vars (see .env.example):
//   LANGFLOW_BASE_URL                        e.g. "http://localhost:7860"
//   LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID     the flow's UUID
//   LANGFLOW_API_KEY                          a Langflow API key (Settings → Langflow API Keys)
//   LANGFLOW_VOICE_STT_COMPONENT_ID           node id of the "Speech-to-Text (Gemini)"
//                                              custom component inside that flow — this is
//                                              what the FileInput tweak targets. Find it by
//                                              opening the flow and checking the component's
//                                              node id (visible in the flow JSON export, or via
//                                              GET /api/v1/flows/{flow_id}).

const STRUCTURED_OUTPUT_DISPLAY_NAME = "Structured Output Parser";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Env var ${name} belum diisi — lihat .env.example.`);
  }
  return value;
}

/**
 * Coerce whatever the Structured Output Parser returned into the exact
 * VoiceExtractionResult shape the browser expects. The parser component
 * already validates/coerces types on the Langflow side (see the flow's
 * "Structured Output Parser" custom component) — this is a second,
 * defensive pass in case the flow is ever edited to skip that node.
 */
function toVoiceExtractionResult(raw: unknown): VoiceExtractionResult {
  const data = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >;

  const amount =
    typeof data.amount === "number" && Number.isFinite(data.amount)
      ? data.amount
      : undefined;

  const itemLabel =
    typeof data.itemLabel === "string" && data.itemLabel.length > 0
      ? data.itemLabel
      : undefined;

  const confidence =
    typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? Math.max(0, Math.min(1, data.confidence))
      : undefined;

  const isClosingReport = data.isClosingReport === true;

  return { amount, itemLabel, confidence, isClosingReport };
}

export async function POST(req: NextRequest) {
  let baseUrl: string;
  let flowId: string;
  let apiKey: string;
  let sttComponentId: string;

  try {
    baseUrl = getRequiredEnv("LANGFLOW_BASE_URL").replace(/\/+$/, "");
    flowId = getRequiredEnv("LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID");
    apiKey = getRequiredEnv("LANGFLOW_API_KEY");
    sttComponentId = getRequiredEnv("LANGFLOW_VOICE_STT_COMPONENT_ID");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Konfigurasi Langflow tidak lengkap.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json(
      { error: "Field 'audio' (Blob) wajib diisi dan tidak boleh kosong." },
      { status: 400 }
    );
  }

  // "ngrok-skip-browser-warning" is only needed when LANGFLOW_BASE_URL points
  // at a free ngrok tunnel (self-hosted Langflow demo setup) — otherwise
  // ngrok returns its HTML interstitial instead of proxying to Langflow.
  // Harmless no-op against a Langflow host not behind ngrok.
  const headers = { "x-api-key": apiKey, "ngrok-skip-browser-warning": "true" };
  let uploadedFilePath: string | null = null;

  try {
    // ── 1. Upload the audio blob into this flow's temp file storage ─────────
    const uploadForm = new FormData();
    // Langflow keys uploaded files by extension internally; give it a
    // generic-but-valid name matching the recorder's mime type when possible.
    const ext = audio.type.includes("ogg")
      ? "ogg"
      : audio.type.includes("wav")
        ? "wav"
        : audio.type.includes("mp4") || audio.type.includes("m4a")
          ? "m4a"
          : "webm";
    uploadForm.append("file", audio, `voice-capture.${ext}`);

    const uploadRes = await fetch(`${baseUrl}/api/v1/files/upload/${flowId}`, {
      method: "POST",
      headers,
      body: uploadForm,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => "");
      throw new Error(
        `Upload audio ke Langflow gagal (${uploadRes.status}): ${text.slice(0, 300)}`
      );
    }

    const uploadJson = (await uploadRes.json()) as { file_path: string };
    uploadedFilePath = uploadJson.file_path;

    // ── 2. Run the flow, tweaking the Speech-to-Text component's FileInput ──
    // Retries a few times on network/connection-reset flakiness talking to
    // watsonx.ai — see src/lib/langflowRun.ts for why this is needed.
    const componentOutputs = await runLangflowFlow(baseUrl, flowId, apiKey, {
      [sttComponentId]: { audio_file: uploadedFilePath },
    });

    const parsed = extractJsonArtifact(componentOutputs, STRUCTURED_OUTPUT_DISPLAY_NAME);

    const result = toVoiceExtractionResult(parsed);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan tak dikenal saat memanggil Langflow.";
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    // ── 3. Best-effort cleanup — never keep the uploaded audio around ───────
    if (uploadedFilePath) {
      const fileName = uploadedFilePath.split("/").pop();
      if (fileName) {
        fetch(`${baseUrl}/api/v1/files/delete/${flowId}/${fileName}`, {
          method: "DELETE",
          headers,
        }).catch(() => {
          // Deletion failing must never surface as a user-facing error —
          // the extraction result above is already what the caller needs.
        });
      }
    }
  }
}

// Shared helper for calling a Langflow flow's /run endpoint, used by all
// three pipelines (Voice-to-Transaction, Radar Tetangga, Generative Promo).
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Verified during setup: calling a correctly-configured flow that ends in an
// "IBM watsonx.ai" node intermittently fails with a mid-request connection
// reset (observed on Windows as "WinError 10054: An existing connection was
// forcibly closed by the remote host"), or occasionally returns HTTP 200 with
// an empty outputs[0].outputs array. Both were reproduced against flows whose
// wiring and env vars were already confirmed correct — retrying the exact
// same call immediately after succeeds. This is network/infra flakiness
// between the Langflow host and IBM watsonx.ai's cloud endpoint, not a
// flow-configuration bug, so the fix is a short automatic retry here rather
// than anything in the flow itself.

interface LangflowDebugOutput {
  component_display_name?: string;
  component_id?: string;
  artifacts?: Record<string, { raw?: unknown; repr?: unknown }>;
}

interface LangflowRunResponse {
  outputs?: {
    outputs?: LangflowDebugOutput[];
  }[];
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a Langflow flow via POST {baseUrl}/api/v1/run/{flowId}?stream=false
 * with output_type "debug", retrying (up to MAX_ATTEMPTS total attempts,
 * with a short increasing delay) on:
 *   - a thrown network error (e.g. connection reset before a response),
 *   - a non-2xx HTTP response,
 *   - a 200 response whose outputs[0].outputs came back empty — also
 *     observed as a symptom of the same intermittent failure.
 *
 * Throws a descriptive Error if every attempt fails. Callers should catch
 * this and return a 502 with the error message, exactly as before this
 * helper existed.
 */
export async function runLangflowFlow(
  baseUrl: string,
  flowId: string,
  apiKey: string,
  tweaks: Record<string, Record<string, unknown>>
): Promise<LangflowDebugOutput[]> {
  let lastError: Error = new Error("Menjalankan flow Langflow gagal setelah beberapa percobaan.");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const runRes = await fetch(`${baseUrl}/api/v1/run/${flowId}?stream=false`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({
          input_value: "",
          input_type: "text",
          output_type: "debug",
          tweaks,
        }),
      });

      if (!runRes.ok) {
        const text = await runRes.text().catch(() => "");
        throw new Error(`Menjalankan flow Langflow gagal (${runRes.status}): ${text.slice(0, 500)}`);
      }

      const runJson = (await runRes.json()) as LangflowRunResponse;
      const componentOutputs = runJson.outputs?.[0]?.outputs ?? [];

      if (componentOutputs.length === 0) {
        throw new Error(
          "Langflow mengembalikan outputs kosong — kemungkinan gangguan sementara ke watsonx.ai."
        );
      }

      return componentOutputs;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }

  throw lastError;
}

/**
 * Finds a component's output by its exact display name among the outputs
 * returned by runLangflowFlow(), and parses its "raw" artifact as JSON.
 * Shared final step for all three pipelines, whose terminal node is always
 * a Structured Output / aggregator component returning a JSON string in
 * artifacts[<first key>].raw.
 */
export function extractJsonArtifact(
  componentOutputs: LangflowDebugOutput[],
  displayName: string
): unknown {
  const match = componentOutputs.find((o) => o.component_display_name === displayName);
  if (!match) {
    throw new Error(
      `Komponen "${displayName}" tidak ditemukan di output flow. Pastikan flow belum diubah namanya di Langflow.`
    );
  }

  const artifactKey = Object.keys(match.artifacts ?? {})[0];
  const rawText = artifactKey ? match.artifacts?.[artifactKey]?.raw : undefined;

  if (typeof rawText !== "string") {
    throw new Error(`Komponen "${displayName}" tidak mengembalikan teks JSON.`);
  }

  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Komponen "${displayName}" mengembalikan JSON tidak valid: ${rawText.slice(0, 200)}`);
  }
}

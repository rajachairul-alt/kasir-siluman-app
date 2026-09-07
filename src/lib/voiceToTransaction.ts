// src/lib/voiceToTransaction.ts
//
// Boundary module for the Voice-to-Transaction pipeline (BOB_BRIEF.md item #2,
// PRD section 8.2 "Listener Agent").
//
// This file owns the single seam between the browser UI (MediaRecorder audio)
// and the Langflow endpoint that extracts prices from speech.  All audio
// handling stays local to the browser and this module's own network call;
// nothing is persisted to the server's database or disk (see BOB_BRIEF.md
// constraint: "Audio mentah tidak boleh disimpan ke database atau storage
// apa pun").
//
// ── How this is wired ────────────────────────────────────────────────────────
// The real work happens server-side in POST /api/voice/extract
// (src/app/api/voice/extract/route.ts), which:
//   1. Uploads the audio blob into the Langflow flow's temp file storage.
//   2. Runs the "Kasir Siluman - Voice to Transaction" Langflow flow
//      (Speech-to-Text (Gemini) → Prompt Template → IBM watsonx.ai →
//      Structured Output Parser), tweaking the Speech-to-Text component's
//      FileInput to point at the uploaded file.
//   3. Deletes the uploaded file again once the run completes.
//   4. Returns the Structured Output Parser's validated JSON as this module's
//      VoiceExtractionResult shape.
//
// Required env vars — see .env.example:
//   LANGFLOW_BASE_URL, LANGFLOW_VOICE_TO_TRANSACTION_FLOW_ID,
//   LANGFLOW_API_KEY, LANGFLOW_VOICE_STT_COMPONENT_ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalised output of the Voice-to-Transaction pipeline.
 *
 * One blob of audio produces exactly one VoiceExtractionResult.  The caller
 * (session/page.tsx) inspects isClosingReport to decide which API route to
 * hit next:
 *   - isClosingReport === true  → POST /api/session/:id/close  { closingReportTotal }
 *   - isClosingReport === false → POST /api/transactions        { source: "voice", amount }
 */
export interface VoiceExtractionResult {
  /**
   * Extracted price in Rupiah (full integer).
   * Present when isClosingReport is false and the pipeline detected a price.
   * Absent when the pipeline could not extract a price with enough confidence.
   */
  amount?: number;

  /**
   * Human-readable item label extracted from the utterance, if any.
   * Examples: "bakso", "es teh", "gorengan".
   */
  itemLabel?: string;

  /**
   * Confidence score from the pipeline, 0–1.
   * Forwarded as-is to /api/transactions so it is stored on the Transaction
   * record (the field is already defined in the Prisma schema).
   */
  confidence?: number;

  /**
   * True when the pipeline classifies the utterance as a "tutup buku" phrase
   * (e.g. "tutup", "selesai dagangnya", "total hari ini sekian").
   *
   * When true, `amount` should be interpreted as the seller's spoken closing
   * total to be sent to POST /api/session/:id/close as closingReportTotal.
   */
  isClosingReport: boolean;
}

/**
 * Send an audio blob to the Voice-to-Transaction pipeline and return the
 * extracted result.
 *
 * The blob is processed in-memory here and by the /api/voice/extract route —
 * it must never be stored in a database, uploaded to object storage, or held
 * beyond the current call stack. The server route also deletes its own
 * temporary copy from Langflow immediately after the flow run completes.
 *
 * @param audioBlob  Raw audio captured by MediaRecorder in the browser.
 *                   Typically audio/webm;codecs=opus or audio/ogg.
 * @returns          A VoiceExtractionResult describing what was heard.
 */
export async function extractFromAudio(
  audioBlob: Blob
): Promise<VoiceExtractionResult> {
  const form = new FormData();
  form.append("audio", audioBlob, "voice-capture");

  const res = await fetch("/api/voice/extract", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let message = `Ekstraksi suara gagal (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response body wasn't JSON — fall back to the generic message above.
    }
    throw new Error(message);
  }

  return (await res.json()) as VoiceExtractionResult;
}

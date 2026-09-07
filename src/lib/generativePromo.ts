// src/lib/generativePromo.ts
//
// Boundary module for the Generative Promo pipeline (BOB_BRIEF.md item #5,
// PRD section 8.2 "Growth Agent").
//
// ── Wiring ───────────────────────────────────────────────────────────────────
// generatePromo() calls POST /api/promo/generate (src/app/api/promo/generate/route.ts),
// which forwards the PromoContext to the Langflow
// "Kasir Siluman - Generative Promo" flow and returns a PromoResult.
//
// Langflow flow: Prompt Template → IBM watsonx.ai Granite (temp 0.7)
//                → Structured Output Parser → PromoResult JSON
//
// Required env vars — see .env.example:
//   LANGFLOW_BASE_URL, LANGFLOW_PROMO_FLOW_ID, LANGFLOW_API_KEY,
//   LANGFLOW_PROMO_PROMPT_TEMPLATE_COMPONENT_ID
//
// ── Source of truth for context ──────────────────────────────────────────────
// PromoContext is built entirely from data already in the database — recent
// Transaction records.  It is never based on free-text typed in by the seller
// after the fact (PRD section 4, Core Concept & Trust Highlight).
// Building context is the responsibility of GET /api/promo/context (see
// src/app/api/promo/context/route.ts), not this module.
//
// ── What the pipeline does (and does NOT do) ─────────────────────────────────
// Returns posterText (WhatsApp/poster copy) and imagePrompt (text for an
// image-generation model). Image generation itself is a separate step —
// the Langflow flow does not call an image model. If that changes, add
// `imageUrl?: string` to PromoResult.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregated sales context derived from Transaction records.
 * Built by GET /api/promo/context — never constructed from manual input.
 */
export interface PromoContext {
  /** Display name of the merchant, shown in the generated poster copy. */
  merchantName: string;

  /**
   * Items that appeared most frequently in the past N days, sorted by
   * count descending.  Only items that have an itemLabel are included
   * (QRIS-only transactions without a label are omitted).
   */
  recentItems: {
    itemLabel: string;
    /** Number of Transaction records with this label in the lookback window. */
    count: number;
  }[];
}

/**
 * The output of the Generative Promo pipeline.
 */
export interface PromoResult {
  /**
   * Ready-to-publish text for a poster or WhatsApp story.
   * In Indonesian, written for the merchant's customer audience.
   * Example: "Bakso Pak Budi — Segar setiap hari! Harga spesial hari ini…"
   */
  posterText: string;

  /**
   * A descriptive prompt for an image-generation model (Stable Diffusion,
   * DALL-E, Imagen, etc.).  The pipeline returns the prompt text only;
   * image generation is a separate step outside this app unless the
   * Langflow flow itself calls an image model (see module header note).
   * Example: "Street food cart at dusk, steaming bowl of bakso soup, warm
   *            lighting, photorealistic, vibrant colours"
   */
  imagePrompt: string;
}

/**
 * Call the Generative Promo pipeline with aggregated sales context and
 * return poster copy + an image-generation prompt.
 *
 * @param context  Aggregated sales context from /api/promo/context.
 *                 Never pass free-text typed by the seller — always use
 *                 the API route to build context from real Transaction data.
 * @returns        Poster text and image prompt from the pipeline.
 */
export async function generatePromo(context: PromoContext): Promise<PromoResult> {
  const res = await fetch("/api/promo/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(context),
  });

  if (!res.ok) {
    let message = `Generative Promo gagal (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response body wasn't JSON — fall back to the generic message above.
    }
    throw new Error(message);
  }

  return (await res.json()) as PromoResult;
}

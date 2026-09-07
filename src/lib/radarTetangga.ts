// src/lib/radarTetangga.ts
//
// Boundary module for the Radar Tetangga pipeline (BOB_BRIEF.md item #4,
// PRD section 8.2 "Radar Tetangga Agent").
//
// This module owns the single seam between the seller UI and the Langflow
// pipeline that aggregates neighbourhood pricing data.
//
// ── Aggregation constraint (BOB_BRIEF.md, non-negotiable) ───────────────────
// Radar Tetangga may ONLY return aggregated data. It must never expose
// any individual merchant's price to another merchant. This constraint is
// reflected in the NeighborhoodPricing type: there is no merchantId, no
// merchantName, and no per-merchant breakdown — only a statistical summary
// (averagePrice) and a transparency field (sampleSize) so the seller knows
// how many peers contributed to the figure.
//
// The averaging itself is computed deterministically — NOT by an LLM — in
// the Langflow flow's "Radar Tetangga Aggregator" Python component, which
// calls GET /api/internal/item-prices (server-to-server, shared-secret
// protected) to get the raw amounts, then does plain arithmetic. This
// avoids an LLM ever hallucinating a plausible-but-wrong average.
//
// ── How this is wired ────────────────────────────────────────────────────────
// getNeighborhoodPricing() calls POST /api/radar (src/app/api/radar/route.ts),
// which forwards to the Langflow "Kasir Siluman - Radar Tetangga" flow and
// reshapes its response. If the aggregator's sampleSize would be < 2, the
// route responds 204 and this function returns null — the caller must show
// a "not enough data yet" state rather than a spurious single-merchant
// average.
//
// Required env vars — see .env.example:
//   LANGFLOW_BASE_URL, LANGFLOW_RADAR_TETANGGA_FLOW_ID, LANGFLOW_API_KEY,
//   LANGFLOW_RADAR_AGGREGATOR_COMPONENT_ID, RADAR_INTERNAL_SECRET
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The normalised output of the Radar Tetangga pipeline.
 *
 * Every field is an aggregate — no field ever identifies an individual
 * merchant or contains data belonging exclusively to one merchant.
 */
export interface NeighborhoodPricing {
  /** The item that was queried (echoed back for display, e.g. "bakso"). */
  itemLabel: string;

  /**
   * Average price in Rupiah across all contributing merchants in the
   * neighbourhood, rounded to the nearest whole number.
   * This is the only price figure — there is no per-merchant breakdown.
   */
  averagePrice: number;

  /**
   * Number of sessions/merchants that contributed to averagePrice.
   * Shown to the seller for transparency ("based on N neighbours").
   * The pipeline should decline to return a result if sampleSize < 2,
   * to prevent a single merchant's data from being identifiable.
   */
  sampleSize: number;

  /**
   * Human-readable radius string, e.g. "500m" or "1km".
   * Optional: only present when the pipeline uses geolocation to bound
   * the aggregation area. Not populated by the current flow.
   */
  radius?: string;
}

/**
 * Fetch the neighbourhood average price for a given item label.
 *
 * The result is always an aggregate — it is safe to display to any merchant
 * because it never contains individual merchant data.
 *
 * @param itemLabel  The item to look up, e.g. "bakso", "es teh".
 *                   Comes from the last voice-captured transaction label.
 * @returns          A NeighborhoodPricing aggregate, or null when fewer than
 *                    2 neighbouring merchants have sold that item recently
 *                    (the pipeline suppresses the result rather than
 *                    revealing a single merchant's price).
 */
export async function getNeighborhoodPricing(
  itemLabel: string
): Promise<NeighborhoodPricing | null> {
  const res = await fetch("/api/radar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemLabel }),
  });

  if (res.status === 204) {
    return null;
  }

  if (!res.ok) {
    let message = `Radar Tetangga gagal (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response body wasn't JSON — fall back to the generic message above.
    }
    throw new Error(message);
  }

  return (await res.json()) as NeighborhoodPricing;
}

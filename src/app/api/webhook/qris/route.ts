import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

// POST /api/webhook/qris
//
// QRIS Webhook Parser — PRD section 7 architecture component.
// A real QRIS aggregator calls this endpoint the moment a payment succeeds.
// The endpoint is also reachable from the demo "Simulasikan Pembayaran QRIS"
// button in /session (via /api/transactions), which bypasses this file
// entirely so the simulation path stays separate.
//
// ── Authentication ──────────────────────────────────────────────────────────
// Current implementation: shared-secret check via the `x-qris-webhook-secret`
// request header matched against the QRIS_WEBHOOK_SECRET env variable.
//
// TODO (when aggregator credentials are available):
//   Most Indonesian QRIS aggregators (e.g. Midtrans, Xendit, Duitku) sign
//   their webhook payloads using HMAC-SHA256.  When that time comes:
//
//   1. Read the raw request body as a Buffer BEFORE parsing JSON:
//        const rawBody = Buffer.from(await req.arrayBuffer());
//
//   2. Compute the expected signature:
//        import { createHmac } from "crypto";
//        const expected = createHmac("sha256", process.env.QRIS_WEBHOOK_HMAC_SECRET!)
//          .update(rawBody)
//          .digest("hex");
//
//   3. Compare with the aggregator's signature header (name varies, e.g.
//      "x-signature", "x-callback-signature") using a timing-safe comparison:
//        import { timingSafeEqual } from "crypto";
//        const actual = req.headers.get("x-signature") ?? "";
//        const match = timingSafeEqual(
//          Buffer.from(expected),
//          Buffer.from(actual.padEnd(expected.length, "\0").slice(0, expected.length))
//        );
//        if (!match) return NextResponse.json({ error: "Signature tidak valid" }, { status: 401 });
//
//   4. Replace QRIS_WEBHOOK_SECRET in .env with QRIS_WEBHOOK_HMAC_SECRET
//      (already added to .env.example).
//
// ── Payload ─────────────────────────────────────────────────────────────────
// webhookSchema below uses a generic shape.
//
// TODO (when aggregator credentials are available):
//   Replace sessionId / amount / itemLabel with the aggregator's actual field
//   names.  Common patterns:
//     - Midtrans: { order_id, gross_amount, transaction_status }
//     - Xendit:   { id, amount, status, reference_id }
//     - Duitku:   { merchantOrderId, amount, resultCode }
//   Map those fields to the Transaction model's sessionId and amount before
//   calling db.transaction.create.  The qrisTransactionId field enables
//   idempotency regardless of which aggregator is used.

const webhookSchema = z.object({
  /** Maps to Transaction.sessionId — the currently OPEN session for this merchant. */
  sessionId: z.string().min(1),

  /** Payment amount in Rupiah (full integer, no decimals). */
  amount: z.number().int().positive(),

  /** Human-readable item label forwarded by the aggregator, if any. */
  itemLabel: z.string().optional(),

  /**
   * Unique transaction ID from the aggregator (for idempotency).
   * TODO: make this required once a real aggregator is wired in.
   * Aggregator field names: Midtrans → transaction_id, Xendit → id, Duitku → reference.
   */
  qrisTransactionId: z.string().optional(),

  /**
   * ISO-8601 timestamp of when the payment was confirmed by the aggregator.
   * Optional for now; will be useful for audit trails once logging is added.
   */
  paymentTimestamp: z.string().datetime().optional(),
});

export async function POST(req: NextRequest) {
  // ── 1. Authentication ──────────────────────────────────────────────────────
  // Shared-secret check.  Replace this block with HMAC-SHA256 verification
  // once a real aggregator is connected (see TODO above).
  const secret = req.headers.get("x-qris-webhook-secret");
  if (!secret || secret !== process.env.QRIS_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Signature tidak valid" }, { status: 401 });
  }

  // ── 2. Body parsing ────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body bukan JSON yang valid" },
      { status: 400 }
    );
  }

  // ── 3. Schema validation ───────────────────────────────────────────────────
  const parsed = webhookSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload tidak valid", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { sessionId, amount, itemLabel, qrisTransactionId } = parsed.data;

  // ── 4. Session guard ───────────────────────────────────────────────────────
  const session = await db.session.findUnique({ where: { id: sessionId } });
  if (!session) {
    return NextResponse.json({ error: "Sesi tidak ditemukan" }, { status: 404 });
  }
  if (session.status !== "OPEN") {
    return NextResponse.json(
      { error: "Sesi sudah ditutup — transaksi tidak dapat dicatat" },
      { status: 409 }
    );
  }

  // ── 5. Idempotency ─────────────────────────────────────────────────────────
  // If the aggregator retries the webhook (network hiccup, timeout), we must
  // not double-count the payment.  When qrisTransactionId is present, return
  // the existing transaction instead of inserting a duplicate.
  if (qrisTransactionId) {
    const existing = await db.transaction.findFirst({
      where: { qrisTransactionId },
    });
    if (existing) {
      // 200 (not 201) signals "already processed, no action taken"
      return NextResponse.json(existing, { status: 200 });
    }
  }

  // ── 6. Persist transaction ─────────────────────────────────────────────────
  try {
    const transaction = await db.transaction.create({
      data: {
        sessionId,
        source: "qris",
        amount,
        itemLabel,
        qrisTransactionId,
      },
    });
    return NextResponse.json(transaction, { status: 201 });
  } catch (err) {
    console.error("[webhook/qris] DB error while creating transaction:", err);
    return NextResponse.json(
      { error: "Terjadi kesalahan internal — coba lagi" },
      { status: 500 }
    );
  }
}

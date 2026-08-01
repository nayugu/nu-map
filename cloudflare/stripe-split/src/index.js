// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// ═══════════════════════════════════════════════════════════════════
// AUTHOR REVENUE SPLIT — Stripe webhook.
//
// Implements §3 of docs/co-ownership-agreement.md: of what NU Map brings in,
// net of what the payment processor takes, the recipient gets SHARE_BPS and
// the platform keeps the rest.
//
// Flow:
//   donation succeeds
//     → charge.succeeded fires here
//     → read the charge's balance transaction for the NET (gross minus
//       Stripe's cut — §3 says net, and the gross never fully arrives)
//     → transfer SHARE_BPS of that net to the connected account
//     → Stripe pays that balance out to their bank on their own schedule
//
// The platform's own share needs no transfer: it simply stays in the platform
// balance. The platform is not a connected account of itself.
//
// Two details that make this safe rather than merely working:
//
//   source_transaction — ties the transfer to the originating charge, so it is
//   created against pending funds and settles when the charge does. Without
//   it, transfers fail with "insufficient available balance" because donation
//   money has not cleared yet.
//
//   Idempotency-Key — Stripe retries webhooks on any non-2xx, and will happily
//   deliver the same event twice. Keyed on the charge id, a retry is a no-op
//   instead of paying twice.
// ═══════════════════════════════════════════════════════════════════

const STRIPE_API = "https://api.stripe.com/v1";
const SIG_TOLERANCE_SECONDS = 300; // reject replays older than 5 minutes

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// ── Stripe REST helper ──────────────────────────────────────────────
// Form-encoded, as the Stripe API expects. No SDK: the official library pulls
// in Node built-ins and this worker needs three endpoints.

async function stripe(env, method, path, { body, idempotencyKey } = {}) {
  // No Stripe-Version pin: without one, Stripe uses the account's default, which
  // is also the version the webhook payload arrives in — so the request and the
  // event stay consistent with each other for free. A hardcoded version here is
  // worse than none, because a wrong string fails every call outright, and the
  // handful of fields this worker reads have been stable for years.
  const headers = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (body) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Stripe ${method} ${path}: ${msg}`);
  }
  return data;
}

// ── Signature verification ──────────────────────────────────────────
// Stripe signs `${timestamp}.${rawBody}` with the endpoint secret. Verified by
// hand with Web Crypto; the SDK's synchronous constructEvent needs Node crypto.

async function hmacHex(secret, payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent comparison, so a mismatch leaks no timing signal. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(rawBody, header, secret) {
  if (!header) return { ok: false, reason: "missing Stripe-Signature" };

  let timestamp = null;
  const provided = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") timestamp = v?.trim();
    if (k?.trim() === "v1") provided.push(v?.trim());
  }
  if (!timestamp || provided.length === 0) return { ok: false, reason: "malformed Stripe-Signature" };

  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > SIG_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  // Stripe may send several v1 signatures during a secret rotation.
  if (!provided.some(sig => sig && timingSafeEqual(sig, expected))) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

// ── The split itself ────────────────────────────────────────────────

/**
 * The balance transaction for a charge — the record carrying the settled NET.
 *
 * `charge.succeeded` fires BEFORE Stripe attaches the balance transaction, so
 * `charge.balance_transaction` is routinely null on the event payload. Treating
 * that as "nothing to do" silently skips every donation, so fall back to
 * looking the record up by source, which finds it even when the id is not yet
 * on the charge object.
 *
 * If it genuinely does not exist yet, throw rather than skip: a non-2xx makes
 * Stripe retry with backoff, and the idempotency key on the transfer makes that
 * retry safe. Skipping would lose the payment permanently.
 */
async function balanceTransactionFor(env, charge) {
  if (charge.balance_transaction) {
    return stripe(env, "GET", `/balance_transactions/${charge.balance_transaction}`);
  }

  // The record appears a beat after the event fires, not at the same instant, so
  // the first lookup reliably misses. Wait it out rather than failing: throwing
  // does get the delivery retried, but it would mark EVERY donation as failed,
  // and Stripe disables endpoints with a sustained failure rate. Roughly 6.5s
  // total, comfortably inside Stripe's delivery timeout.
  const backoffMs = [400, 800, 1500, 1800, 2000];
  for (let attempt = 0; ; attempt++) {
    const { data } = await stripe(env, "GET",
      `/balance_transactions?source=${encodeURIComponent(charge.id)}&limit=1`);
    if (data?.[0]) return data[0];
    if (attempt >= backoffMs.length) break;
    await new Promise(resolve => setTimeout(resolve, backoffMs[attempt]));
  }

  // Still nothing: now a retry is the right answer. The idempotency key and the
  // duplicate check both make that safe.
  throw new Error(`no balance transaction for ${charge.id} yet — retrying`);
}

/**
 * The transfer already created for a charge, if any.
 *
 * Every transfer is tagged with `transfer_group = <charge id>`, so the charge id
 * is enough to find it again without storing any state of our own. Used both to
 * avoid double-paying and to find what to reverse on a refund.
 */
async function transferForCharge(env, chargeId) {
  const { data } = await stripe(env, "GET",
    `/transfers?transfer_group=${encodeURIComponent(chargeId)}&limit=1`);
  return data?.[0] ?? null;
}

/**
 * Transfer the recipient's share of a settled charge.
 *
 * Returns a short status string for the response body — useful when replaying
 * an event from the Stripe dashboard to see what happened.
 */
async function splitCharge(env, charge) {
  if (!charge?.id) return "ignored: no charge id";
  if (charge.amount === 0) return "ignored: zero-amount charge";

  // Has this charge already been split? The Idempotency-Key below only protects
  // for 24 hours, but Stripe retries a failing webhook for up to three days — so
  // a transfer that succeeded just before the worker errored could be repeated
  // on day two, once the key has been pruned. Checking for the transfer we would
  // be about to create closes that window permanently. Costs one GET.
  const prior = await transferForCharge(env, charge.id);
  if (prior) return `ignored: already split by ${prior.id}`;

  // NET, not gross: §3 divides what actually arrives. The balance transaction
  // carries the settled amount and is denominated in the account's settlement
  // currency, which is also the currency the transfer must use.
  const bt = await balanceTransactionFor(env, charge);
  const net = bt.net;
  if (!Number.isFinite(net) || net <= 0) return `ignored: net is ${net}`;

  const shareBps = Number(env.SHARE_BPS);
  if (!Number.isFinite(shareBps) || shareBps <= 0 || shareBps >= 10000) {
    throw new Error(`SHARE_BPS is not a sane basis-point value: ${env.SHARE_BPS}`);
  }

  const amount = Math.round((net * shareBps) / 10000);
  if (amount <= 0) return `ignored: share of ${net} rounds to zero`;

  const ceiling = Number(env.MAX_TRANSFER_MINOR);
  if (Number.isFinite(ceiling) && amount > ceiling) {
    // Loud failure, not a silent large transfer. Stripe will retry, and the
    // event stays visible in the dashboard until someone looks.
    throw new Error(`refusing to transfer ${amount} (> MAX_TRANSFER_MINOR ${ceiling})`);
  }

  const transfer = await stripe(env, "POST", "/transfers", {
    idempotencyKey: `numap-split:${charge.id}`,
    body: {
      amount: String(amount),
      currency: bt.currency,
      destination: env.CONNECTED_ACCOUNT_ID,
      // Draw against the charge so this settles with it rather than failing on
      // an unsettled platform balance.
      source_transaction: charge.id,
      // Lets the refund path find this transfer again without storing state.
      transfer_group: charge.id,
      description: `NU Map author split (${shareBps / 100}% of net)`,
      "metadata[charge]": charge.id,
      "metadata[net_minor]": String(net),
      "metadata[share_bps]": String(shareBps),
    },
  });

  return `transferred ${amount} ${bt.currency} (${transfer.id}) of net ${net}`;
}

/**
 * Claw back the recipient's share of a refunded charge.
 *
 * The platform is liable for refunds under the Connect agreement, so without
 * this the platform absorbs the whole refund having already paid out a share
 * of it. Reversal is proportional: a partial refund reverses that proportion.
 */
async function reverseSplit(env, charge) {
  if (!charge?.id) return "ignored: no charge id";

  const transfer = await transferForCharge(env, charge.id);
  if (!transfer) return "ignored: no transfer found for this charge";

  const refunded = charge.amount_refunded ?? 0;
  if (refunded <= 0) return "ignored: nothing refunded";

  const proportion = Math.min(1, refunded / charge.amount);
  const target = Math.round(transfer.amount * proportion);
  const already = transfer.amount_reversed ?? 0;
  const amount = target - already;
  if (amount <= 0) return `ignored: already reversed ${already} of ${target}`;

  const reversal = await stripe(env, "POST", `/transfers/${transfer.id}/reversals`, {
    idempotencyKey: `numap-reverse:${charge.id}:${refunded}`,
    body: { amount: String(amount), "metadata[charge]": charge.id },
  });

  return `reversed ${amount} (${reversal.id}) of transfer ${transfer.id}`;
}

// ── Worker ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      return json({
        ok: true,
        destination: env.CONNECTED_ACCOUNT_ID,
        shareBps: Number(env.SHARE_BPS),
        configured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
      });
    }

    if (pathname !== "/stripe/webhook") return json({ error: "Not found" }, 404);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
      return json({ error: "Worker is missing its Stripe secrets" }, 500);
    }

    // Raw text, before any parsing: the signature covers the exact bytes.
    const rawBody = await request.text();
    const check = await verifySignature(rawBody, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET);
    if (!check.ok) return json({ error: `Signature rejected: ${check.reason}` }, 400);

    let event;
    try { event = JSON.parse(rawBody); } catch { return json({ error: "Body is not JSON" }, 400); }

    // Events forwarded from a connected account carry `account`. Only the
    // platform's own charges are ours to split; ignoring these also prevents a
    // loop if the recipient account ever gains charging ability.
    if (event.account) return json({ received: true, status: "ignored: connected-account event" });

    const charge = event.data?.object;
    try {
      let status;
      switch (event.type) {
        case "charge.succeeded":
          status = await splitCharge(env, charge);
          break;
        case "charge.refunded":
          status = await reverseSplit(env, charge);
          break;
        default:
          status = `ignored: ${event.type} is not handled`;
      }
      return json({ received: true, status });
    } catch (err) {
      // Non-2xx so Stripe retries. Combined with the idempotency keys, a retry
      // after a partial failure cannot double-pay.
      console.error(`[split] ${event.type} ${charge?.id}: ${err.message}`);
      return json({ error: err.message }, 500);
    }
  },
};

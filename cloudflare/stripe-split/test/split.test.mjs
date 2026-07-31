// UNIT · cloudflare/stripe-split — the author revenue split.
//
// This is the only code in the project that moves money, so the tests cover the
// two ways it could go wrong expensively: paying the wrong amount, and paying on
// a request that did not really come from Stripe. Stripe's API is faked; nothing
// here touches the network.
//
// Run: node --test  (from this directory)

import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const SECRET = "whsec_test_secret";
const ENV = {
  STRIPE_SECRET_KEY: "rk_test_x",
  STRIPE_WEBHOOK_SECRET: SECRET,
  CONNECTED_ACCOUNT_ID: "acct_recipient",
  SHARE_BPS: "3500",
  MAX_TRANSFER_MINOR: "50000",
};

// ── fake Stripe ─────────────────────────────────────────────────────
let calls, balanceTx, transfersList;

function installFakeStripe() {
  calls = [];
  balanceTx = { net: 970, currency: "usd" }; // $10.00 gross less 2.9% + 30¢
  transfersList = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
    calls.push({
      method: init.method, path: u.pathname + (u.search || ""),
      body, idem: init.headers?.["Idempotency-Key"],
    });
    const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (u.pathname.startsWith("/v1/balance_transactions/")) return ok(balanceTx);
    if (u.pathname === "/v1/transfers" && init.method === "POST") return ok({ id: "tr_1", amount: Number(body.amount) });
    if (u.pathname === "/v1/transfers") return ok({ data: transfersList });
    if (/\/v1\/transfers\/.*\/reversals/.test(u.pathname)) return ok({ id: "trr_1", amount: Number(body.amount) });
    return new Response(JSON.stringify({ error: { message: "unexpected " + u.pathname } }), { status: 400 });
  };
}

async function sign(payload, secret, t = Math.floor(Date.now() / 1000)) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${payload}`));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

async function post(event, { secret = SECRET, t, sigOverride, env = ENV, mutate, net, transfers } = {}) {
  installFakeStripe();
  // Set after installing the fake, which resets these to their defaults.
  if (net !== undefined) balanceTx = { net, currency: "usd" };
  if (transfers !== undefined) transfersList = transfers;
  const raw = JSON.stringify(event);
  const sig = sigOverride ?? await sign(raw, secret, t);
  const res = await worker.fetch(new Request("https://w/stripe/webhook", {
    method: "POST",
    body: mutate ? mutate(raw) : raw,
    headers: { "Stripe-Signature": sig },
  }), env);
  return { status: res.status, body: await res.json(), calls };
}

const reversalPost = (c) => c.find(x => /reversals/.test(x.path));

const charge = (over = {}) => ({
  id: "ch_1", amount: 1000, currency: "usd", balance_transaction: "txn_1",
  amount_refunded: 0, ...over,
});
const ev = (type, obj, over = {}) => ({ type, data: { object: obj }, ...over });
const transferPost = (c) => c.find(x => x.path === "/v1/transfers" && x.method === "POST");

// ── signature verification ──────────────────────────────────────────
// Without this, anyone who learns the URL can make us pay out.

test("signature › a correctly signed event is accepted", async () => {
  const r = await post(ev("charge.succeeded", charge()));
  assert.equal(r.status, 200);
});

test("signature › an event signed with the wrong secret is rejected", async () => {
  const r = await post(ev("charge.succeeded", charge()), { secret: "whsec_wrong" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /mismatch/);
});

test("signature › a stale timestamp is rejected, so captured requests cannot be replayed", async () => {
  const r = await post(ev("charge.succeeded", charge()), { t: Math.floor(Date.now() / 1000) - 4000 });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /tolerance/);
});

test("signature › a body altered after signing is rejected", async () => {
  const r = await post(ev("charge.succeeded", charge()), {
    mutate: raw => raw.replace('"amount":1000', '"amount":999999'),
  });
  assert.equal(r.status, 400);
});

test("signature › a malformed header is rejected rather than throwing", async () => {
  const r = await post(ev("charge.succeeded", charge()), { sigOverride: "garbage" });
  assert.equal(r.status, 400);
});

// ── the arithmetic ──────────────────────────────────────────────────
// §3 of the agreement divides NET, not gross. Splitting gross would overpay on
// every single donation.

test("split › transfers the share of NET, not of gross", async () => {
  const r = await post(ev("charge.succeeded", charge()));
  // gross 1000, net 970, 35% of net = 339.5 -> 340. 35% of gross would be 350.
  assert.equal(transferPost(r.calls).body.amount, "340");
});

test("split › ties the transfer to the charge so it settles with it", async () => {
  const t = transferPost((await post(ev("charge.succeeded", charge()))).calls);
  assert.equal(t.body.source_transaction, "ch_1");
  assert.equal(t.body.transfer_group, "ch_1");
  assert.equal(t.body.destination, "acct_recipient");
  assert.equal(t.body.currency, "usd");
});

test("split › is idempotent on the charge id, so a webhook retry cannot pay twice", async () => {
  const t = transferPost((await post(ev("charge.succeeded", charge()))).calls);
  assert.equal(t.idem, "numap-split:ch_1");
});

test("split › a share that rounds below one cent is skipped", async () => {
  // 35% of 1 cent is 0.35, which rounds to 0 — transferring 0 would error.
  const r = await post(ev("charge.succeeded", charge({ amount: 2 })), { net: 1 });
  assert.equal(r.status, 200);
  assert.match(r.body.status, /rounds to zero/);
  assert.equal(transferPost(r.calls), undefined);
});

test("split › a negative net (fees exceeded the charge) is skipped", async () => {
  const r = await post(ev("charge.succeeded", charge()), { net: -50 });
  assert.match(r.body.status, /net is -50/);
  assert.equal(transferPost(r.calls), undefined);
});

test("split › a charge with no settled balance transaction is skipped, not crashed", async () => {
  const r = await post(ev("charge.succeeded", charge({ balance_transaction: null })));
  assert.equal(r.status, 200);
  assert.match(r.body.status, /no balance transaction/);
});

test("split › a zero-amount charge is skipped", async () => {
  const r = await post(ev("charge.succeeded", charge({ amount: 0 })));
  assert.match(r.body.status, /zero-amount/);
});

test("split › an implausibly large share fails loudly and moves nothing", async () => {
  const r = await post(ev("charge.succeeded", charge({ amount: 210000 })), { net: 200000 });
  assert.equal(r.status, 500);
  assert.equal(transferPost(r.calls), undefined, "must not transfer above the ceiling");
});

// ── scoping ─────────────────────────────────────────────────────────

test("scope › events forwarded from a connected account are ignored", async () => {
  const r = await post(ev("charge.succeeded", charge(), { account: "acct_recipient" }));
  assert.match(r.body.status, /connected-account/);
  assert.equal(r.calls.length, 0, "must not call Stripe at all");
});

test("scope › an unhandled event type returns 200 so Stripe stops retrying", async () => {
  const r = await post(ev("payment_intent.succeeded", charge()));
  assert.equal(r.status, 200);
  assert.match(r.body.status, /not handled/);
});

// ── refunds ─────────────────────────────────────────────────────────
// The platform is liable for refunds, so an un-reversed share means absorbing
// the whole refund having already paid part of it out.

const TRANSFERRED = [{ id: "tr_1", amount: 340, amount_reversed: 0 }];

test("refund › a full refund reverses the whole share", async () => {
  const r = await post(ev("charge.refunded", charge({ amount_refunded: 1000 })), { transfers: TRANSFERRED });
  assert.equal(reversalPost(r.calls).body.amount, "340");
});

test("refund › a partial refund reverses proportionally", async () => {
  const r = await post(ev("charge.refunded", charge({ amount_refunded: 500 })), { transfers: TRANSFERRED });
  assert.equal(reversalPost(r.calls).body.amount, "170");
});

test("refund › reversal is idempotent on the refunded amount", async () => {
  const r = await post(ev("charge.refunded", charge({ amount_refunded: 500 })), { transfers: TRANSFERRED });
  assert.equal(reversalPost(r.calls).idem, "numap-reverse:ch_1:500");
});

test("refund › an already-reversed transfer is not reversed again", async () => {
  const r = await post(ev("charge.refunded", charge({ amount_refunded: 1000 })), {
    transfers: [{ id: "tr_1", amount: 340, amount_reversed: 340 }],
  });
  assert.equal(r.status, 200);
  assert.equal(reversalPost(r.calls), undefined);
});

test("refund › a refund with no matching transfer is skipped", async () => {
  const r = await post(ev("charge.refunded", charge({ amount_refunded: 1000 })), { transfers: [] });
  assert.match(r.body.status, /no transfer found/);
});

// ── routing and config ──────────────────────────────────────────────

test("routing › /health reports the destination and share", async () => {
  installFakeStripe();
  const body = await (await worker.fetch(new Request("https://w/health"), ENV)).json();
  assert.equal(body.ok, true);
  assert.equal(body.shareBps, 3500);
  assert.equal(body.configured, true);
});

test("routing › unknown paths 404 and GET on the webhook 405", async () => {
  installFakeStripe();
  assert.equal((await worker.fetch(new Request("https://w/nope"), ENV)).status, 404);
  assert.equal((await worker.fetch(new Request("https://w/stripe/webhook"), ENV)).status, 405);
});

test("config › missing secrets refuse the request instead of half-working", async () => {
  installFakeStripe();
  const res = await worker.fetch(
    new Request("https://w/stripe/webhook", { method: "POST", body: "{}" }),
    { ...ENV, STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "" });
  assert.equal(res.status, 500);
});

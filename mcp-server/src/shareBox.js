// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// Share-by-code relay — the coat-check model.
//
// A sender parks an encoded plan snapshot under a short random code; the
// first claim returns it AND deletes it (one use), and anything unclaimed
// expires after SHARE_TTL_MS. Nothing is ever stored longer than that, so
// there is no per-user server state and no accumulation.
//
// The payload is the SAME artifact as a snapshot link (planShare v2):
// its _KEYS allowlist strips grades client-side before anything leaves
// the tab, and validateSharePayload re-rejects grades server-side as
// defense in depth. Size + shape validation double as the anti-abuse
// wall — an opaque blob store this is not.
//
// Consumers: the Node dev server (createMemoryShareBox) and the worker's
// ShareBoxDO (which reuses the validators/helpers against DO storage).

import { decodePlan } from "../../src/core/planShare.js";

export const SHARE_TTL_MS = 10 * 60 * 1000;
export const MAX_PAYLOAD_CHARS = 4096;   // generous for a v2 plan, useless as a pastebin
export const MAX_OUTSTANDING = 2000;     // global peak-concurrency cap (~2 MB of DO storage)
export const MAX_LIVE_PER_IP = 25;       // a classroom behind one NAT IP, not one person

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const CODE_LENGTH = 6;

// Token buckets per IP — sized for campus NAT, where one public IP can
// front a whole lecture hall: "per IP" must fit a crowd's honest burst,
// not one person's. Scan defense doesn't come from these numbers anyway
// (it's the ~30-bit code space, one-use burn, and the small live set);
// the buckets only cap what a single address can sustain forever. Every
// refusal carries retryAfterSeconds so the UI can say when the block
// lifts instead of looking broken.
const RATE = {
  create: { capacity: 30,  refillMs: 10_000 }, // 30 burst, then 6/min
  claim:  { capacity: 100, refillMs: 5_000 },  // 100 burst, then 12/min
  status: { capacity: 120, refillMs: 2_000 },  // sender-side pickup polling (~1 per 5 s)
};

/** Crypto-random code, rejection-sampled so every character is uniform. */
export function randomCode(len = CODE_LENGTH) {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < len) {
    const buf = new Uint8Array(len);
    globalThis.crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit && code.length < len) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

/** Uppercase and drop anything outside the alphabet's character class. */
export function normalizeCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * A share must be exactly what the client produces: a base64url gzip of a
 * planShare v2 compact plan, within size, carrying no grades. Anything
 * else is refused — the relay only ferries plans.
 */
export async function validateSharePayload(payload) {
  if (typeof payload !== "string" || payload.length === 0) return { ok: false, reason: "bad_payload" };
  if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: "too_large" };
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return { ok: false, reason: "bad_payload" };
  let plan;
  try { plan = await decodePlan(payload); }
  catch { return { ok: false, reason: "bad_payload" }; }
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { ok: false, reason: "bad_payload" };
  // v1 passthrough would accept arbitrary JSON — the client only ever
  // shares v2, so only v2 rides the relay.
  if (plan.version !== 2) return { ok: false, reason: "bad_payload" };
  // The client's allowlist can't emit grades, but the server doesn't
  // trust clients: a crafted payload smuggling a grades key is refused.
  if ("grades" in plan) return { ok: false, reason: "bad_payload" };
  return { ok: true };
}

/**
 * Per-IP token buckets. In-memory on purpose: losing them (restart,
 * DO eviction) merely resets a budget that honest users never exhaust.
 * Returns { ok: true } or { ok: false, retryAfterSeconds } — the seconds
 * until the next token accrues.
 */
export function createRateLimiter(now = Date.now) {
  const buckets = new Map(); // `${ip}|${kind}` → { tokens, at }

  const take = (ip, kind) => {
    const { capacity, refillMs } = RATE[kind];
    const key = `${ip}|${kind}`;
    const t = now();
    let b = buckets.get(key);
    if (!b) { b = { tokens: capacity, at: t }; buckets.set(key, b); }
    if (buckets.size > 20_000) buckets.clear(); // memory guard; forfeits budgets, keeps the process
    const refilled = Math.floor((t - b.at) / refillMs);
    if (refilled > 0) {
      b.tokens = Math.min(capacity, b.tokens + refilled);
      b.at = b.tokens === capacity ? t : b.at + refilled * refillMs;
    }
    if (b.tokens >= 1) { b.tokens -= 1; return { ok: true }; }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.at + refillMs - t) / 1000)) };
  };

  // Give a token back (never past capacity). Used when an action turns
  // out to be a no-op on the world — canceling your own code.
  const refund = (ip, kind) => {
    const b = buckets.get(`${ip}|${kind}`);
    if (b) b.tokens = Math.min(RATE[kind].capacity, b.tokens + 1);
  };

  return { take, refund };
}

/**
 * In-memory share box for the Node dev server. `now` is injectable for
 * tests. API mirrors ShareBoxDO: { create(payload, ip), claim(code, ip) }.
 */
export function createMemoryShareBox({ now = Date.now } = {}) {
  const shares = new Map();   // code → { payload, expiresAt, ip }
  const watchers = new Map(); // code → Set<ws> (sender tabs awaiting pickup)
  const rate = createRateLimiter(now);

  // The "interrupt": tell every watching sender tab the code is gone,
  // then hang up. Mirrors ShareBoxDO's hibernation-socket notify.
  const burnNotify = (code, msg) => {
    const set = watchers.get(code);
    if (!set) return;
    for (const ws of set) { try { ws.send(msg); ws.close(1000, msg); } catch { /* already gone */ } }
    watchers.delete(code);
  };

  const purge = () => {
    const t = now();
    for (const [code, s] of shares) {
      if (s.expiresAt <= t) { shares.delete(code); burnNotify(code, 'expired'); }
    }
  };

  return {
    async create(payload, ip) {
      const gate = rate.take(ip, "create");
      if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
      const valid = await validateSharePayload(payload);
      if (!valid.ok) return valid;
      purge();
      // Concurrency cap: claimed/canceled/expired shares free their slot
      // immediately, so sequential use is never limited — only hogging.
      let mine = 0, earliest = null;
      for (const s of shares.values()) {
        if (s.ip !== ip) continue;
        mine += 1;
        if (earliest === null || s.expiresAt < earliest) earliest = s.expiresAt;
      }
      if (mine >= MAX_LIVE_PER_IP) {
        return { ok: false, reason: "too_many_live",
                 retryAfterSeconds: Math.max(1, Math.ceil((earliest - now()) / 1000)) };
      }
      if (shares.size >= MAX_OUTSTANDING) return { ok: false, reason: "busy" };
      let code = randomCode();
      while (shares.has(code)) code = randomCode();
      shares.set(code, { payload, expiresAt: now() + SHARE_TTL_MS, ip });
      return { ok: true, code, expiresInSeconds: SHARE_TTL_MS / 1000 };
    },

    // Pickup feedback for the sender's tab: is my code still parked?
    // Only the creator's IP learns anything — everyone else gets a flat
    // "not yours" whether the code exists or not, so status can never be
    // used to scan for codes silently (claims stay the only probe, and
    // they burn).
    async status(rawCode, ip) {
      const gate = rate.take(ip, "status");
      if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
      purge();
      const share = shares.get(normalizeCode(rawCode));
      return { ok: true, live: !!(share && share.ip === ip) };
    },

    async claim(rawCode, ip) {
      const gate = rate.take(ip, "claim");
      if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
      purge();
      const share = shares.get(normalizeCode(rawCode));
      if (!share) return { ok: false, reason: "not_found" };
      shares.delete(normalizeCode(rawCode)); // one use — gone on first claim
      burnNotify(normalizeCode(rawCode), 'claimed');
      // Self-cancel is a no-op on the world, so it's free: taking back
      // your own code refunds both tokens. Claims of OTHER people's
      // codes stay budgeted — that's the scan defense.
      if (share.ip === ip) {
        rate.refund(ip, "claim");
        rate.refund(ip, "create");
      }
      return { ok: true, payload: share.payload };
    },

    /**
     * Attach a sender tab's WebSocket to its code (Node `ws` socket).
     * Creator-IP only, same rule as status(); anyone else is hung up on
     * without learning whether the code exists.
     */
    watch(rawCode, ip, ws) {
      const code = normalizeCode(rawCode);
      const share = shares.get(code);
      if (!share || share.ip !== ip || share.expiresAt <= now()) {
        try { ws.close(1000, 'gone'); } catch { /* already gone */ }
        return;
      }
      let set = watchers.get(code);
      if (!set) watchers.set(code, set = new Set());
      set.add(ws);
      ws.on('message', (m) => { if (String(m) === 'ping') { try { ws.send('pong'); } catch { /* closing */ } } });
      ws.on('close', () => { set.delete(ws); if (set.size === 0) watchers.delete(code); });
    },
  };
}

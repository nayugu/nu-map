// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// Share-by-code relay — the coat-check model, now holding sealed bags.
//
// A sender parks a plan; the first claim returns it AND deletes it (one
// use), and anything unclaimed expires after SHARE_TTL_MS. Nothing is
// ever stored longer than that, so there is no per-user server state and
// no accumulation.
//
// ── What changed when shares became encrypted ───────────────────────
// The relay used to receive a readable plan: it generated the code, held
// the encoded plan under it, and decoded it to validate. It therefore
// COULD read every plan that passed through, and "we don't" was a promise.
//
// Now the client generates the code, derives a storage id and an AES key
// from it in one slow KDF pass (src/core/shareCrypto.js), and uploads only
// ciphertext under the id. This module never sees a code, so it cannot
// derive a key, so it cannot read a plan. The promise became an inability.
//
// The deliberate cost: content validation is GONE. This module can no
// longer confirm a payload is a planShare v2 plan, and — the one that
// mattered — can no longer reject a hostile client smuggling a `grades`
// key. That invariant now rests entirely on the client's _KEYS allowlist,
// which cannot express grades and is pinned by test/unit/plan-share-
// privacy.test.js. A hostile client can therefore store arbitrary bytes
// here, but only bytes it can retrieve itself, bounded by:
//   • MAX_PAYLOAD_CHARS, so it is not a file host
//   • SHARE_TTL_MS, so nothing lingers
//   • the per-IP token buckets and live-share cap below
// which is what keeps an opaque blob store from being a useful one.
//
// Consumers: the Node dev server (createMemoryShareBox) and the worker's
// ShareBoxDO (which reuses these validators/helpers against DO storage).

import { ID_PATTERN } from "../../src/core/shareCrypto.js";

export const SHARE_TTL_MS = 10 * 60 * 1000;
// A 4 KB plan becomes ~5.5 KB once the IV and GCM tag are added and the
// whole thing is base64url'd (4/3 expansion). 6 KB preserves the previous
// plan capacity exactly; it is still useless as a pastebin.
export const MAX_PAYLOAD_CHARS = 6144;
export const MAX_OUTSTANDING = 2000;     // global peak-concurrency cap
export const MAX_LIVE_PER_IP = 25;       // a classroom behind one NAT IP, not one person

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

/**
 * The id is the only handle the relay gets: hex of the first 16 bytes of
 * the client's key derivation. Shape is all that can be checked — by
 * construction the server cannot verify it corresponds to any code.
 */
export function validateShareId(id) {
  return typeof id === "string" && ID_PATTERN.test(id);
}

/**
 * A share must look like ciphertext this client produces: non-empty,
 * within size, base64url only. Content is unreadable here by design —
 * see the header note on what that gives up and what bounds it instead.
 */
export function validateSharePayload(payload) {
  if (typeof payload !== "string" || payload.length === 0) return { ok: false, reason: "bad_payload" };
  if (payload.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: "too_large" };
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return { ok: false, reason: "bad_payload" };
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
  // out to be a no-op on the world — canceling your own share.
  const refund = (ip, kind) => {
    const b = buckets.get(`${ip}|${kind}`);
    if (b) b.tokens = Math.min(RATE[kind].capacity, b.tokens + 1);
  };

  return { take, refund };
}

/**
 * In-memory share box for the Node dev server. `now` is injectable for
 * tests. API mirrors ShareBoxDO: { create(id, payload, ip), claim(id, ip) }.
 */
export function createMemoryShareBox({ now = Date.now } = {}) {
  const shares = new Map();   // id → { payload, expiresAt, ip }
  const watchers = new Map(); // id → Set<ws> (sender tabs awaiting pickup)
  const rate = createRateLimiter(now);

  // The "interrupt": tell every watching sender tab the share is gone,
  // then hang up. Mirrors ShareBoxDO's hibernation-socket notify.
  const burnNotify = (id, msg) => {
    const set = watchers.get(id);
    if (!set) return;
    for (const ws of set) { try { ws.send(msg); ws.close(1000, msg); } catch { /* already gone */ } }
    watchers.delete(id);
  };

  const purge = () => {
    const t = now();
    for (const [id, s] of shares) {
      if (s.expiresAt <= t) { shares.delete(id); burnNotify(id, 'expired'); }
    }
  };

  return {
    async create(id, payload, ip) {
      const gate = rate.take(ip, "create");
      if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
      if (!validateShareId(id)) return { ok: false, reason: "bad_id" };
      const valid = validateSharePayload(payload);
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
      // The client picks the code, so two senders can in principle pick the
      // same one (~1 in 887 million against a live set of at most 2,000).
      // Refuse rather than overwrite: the incumbent's share must survive,
      // and the client simply generates another code.
      if (shares.has(id)) return { ok: false, reason: "collision" };
      shares.set(id, { payload, expiresAt: now() + SHARE_TTL_MS, ip });
      return { ok: true, expiresInSeconds: SHARE_TTL_MS / 1000 };
    },

    // Pickup feedback for the sender's tab: is my share still parked?
    // Only the creator's IP learns anything — everyone else gets a flat
    // "not yours" whether the share exists or not, so status can never be
    // used to scan silently (claims stay the only probe, and they burn).
    async status(id, ip) {
      const gate = rate.take(ip, "status");
      if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
      purge();
      const share = shares.get(String(id ?? ""));
      return { ok: true, live: !!(share && share.ip === ip) };
    },

    async claim(id, ip) {
      const gate = rate.take(ip, "claim");
      if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
      purge();
      const key = String(id ?? "");
      const share = shares.get(key);
      if (!share) return { ok: false, reason: "not_found" };
      shares.delete(key); // one use — gone on first claim
      burnNotify(key, 'claimed');
      // Self-cancel is a no-op on the world, so it's free: taking back
      // your own share refunds both tokens. Claims of OTHER people's
      // shares stay budgeted — that's the scan defense.
      if (share.ip === ip) {
        rate.refund(ip, "claim");
        rate.refund(ip, "create");
      }
      return { ok: true, payload: share.payload };
    },

    /**
     * Attach a sender tab's WebSocket to its share (Node `ws` socket).
     * Creator-IP only, same rule as status(); anyone else is hung up on
     * without learning whether the share exists.
     */
    watch(id, ip, ws) {
      const key = String(id ?? "");
      const share = shares.get(key);
      if (!share || share.ip !== ip || share.expiresAt <= now()) {
        try { ws.close(1000, 'gone'); } catch { /* already gone */ }
        return;
      }
      let set = watchers.get(key);
      if (!set) watchers.set(key, set = new Set());
      set.add(ws);
      ws.on('message', (m) => { if (String(m) === 'ping') { try { ws.send('pong'); } catch { /* closing */ } } });
      ws.on('close', () => { set.delete(ws); if (set.size === 0) watchers.delete(key); });
    },
  };
}

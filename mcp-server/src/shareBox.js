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
export const MAX_OUTSTANDING = 500;      // hard cap on simultaneously parked shares

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L
export const CODE_LENGTH = 6;

// Per-IP budget within a rolling window: enough for any human retrying,
// hopeless for scanning a ~30-bit code space.
export const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = { create: 10, claim: 30 };

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
 * Rolling per-IP counters. In-memory on purpose: losing them (restart,
 * DO eviction) merely resets a budget that honest users never exhaust.
 */
export function createRateLimiter(now = Date.now) {
  const hits = new Map(); // ip → { windowStart, create, claim }
  return function allow(ip, kind) {
    const t = now();
    let entry = hits.get(ip);
    if (!entry || t - entry.windowStart > RATE_WINDOW_MS) {
      entry = { windowStart: t, create: 0, claim: 0 };
      hits.set(ip, entry);
    }
    if (hits.size > 10_000) hits.clear(); // memory guard; forfeits budgets, keeps the process
    entry[kind] += 1;
    return entry[kind] <= RATE_MAX[kind];
  };
}

/**
 * In-memory share box for the Node dev server. `now` is injectable for
 * tests. API mirrors ShareBoxDO: { create(payload, ip), claim(code, ip) }.
 */
export function createMemoryShareBox({ now = Date.now } = {}) {
  const shares = new Map(); // code → { payload, expiresAt }
  const allow = createRateLimiter(now);

  const purge = () => {
    const t = now();
    for (const [code, s] of shares) if (s.expiresAt <= t) shares.delete(code);
  };

  return {
    async create(payload, ip) {
      if (!allow(ip, "create")) return { ok: false, reason: "rate_limited" };
      const valid = await validateSharePayload(payload);
      if (!valid.ok) return valid;
      purge();
      if (shares.size >= MAX_OUTSTANDING) return { ok: false, reason: "busy" };
      let code = randomCode();
      while (shares.has(code)) code = randomCode();
      shares.set(code, { payload, expiresAt: now() + SHARE_TTL_MS });
      return { ok: true, code, expiresInSeconds: SHARE_TTL_MS / 1000 };
    },

    async claim(rawCode, ip) {
      if (!allow(ip, "claim")) return { ok: false, reason: "rate_limited" };
      purge();
      const share = shares.get(normalizeCode(rawCode));
      if (!share) return { ok: false, reason: "not_found" };
      shares.delete(normalizeCode(rawCode)); // one use — gone on first claim
      return { ok: true, payload: share.payload };
    },
  };
}

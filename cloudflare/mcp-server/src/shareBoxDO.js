// ShareBoxDO — the one coat-check counter for share-by-code.
//
// A single instance (idFromName("global")) holds every parked share as
// its own storage key (`share:<code>` → { payload, expiresAt }), because
// volume is tiny and one instance makes claim-once atomic and the
// outstanding-shares cap trivial. Validation, code generation, and the
// per-IP rate budget come from the dev server's shareBox module — same
// reuse pattern as SessionDO ↔ planState.
//
// Lifecycle: create parks a share and arms an alarm at its expiry;
// claim returns the payload once and deletes it; the alarm sweeps
// expired leftovers and re-arms for the next-soonest expiry. Nothing
// outlives SHARE_TTL_MS, so steady-state storage is a few kilobytes.

import {
  validateSharePayload, randomCode, normalizeCode, createRateLimiter,
  SHARE_TTL_MS, MAX_OUTSTANDING,
} from "../../../mcp-server/src/shareBox.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export class ShareBoxDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    // In-memory on purpose — eviction resets budgets honest users never
    // exhaust, and a scanner keeping the DO hot keeps its budget alive.
    this.allow = createRateLimiter();
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const seg = pathname.split("/").filter(Boolean);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    try {
      if (seg[0] === "share" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const result = await this.create(body?.payload, ip);
        return json(result, result.ok ? 200 : 400);
      }
      if (seg[0] === "claim" && seg[1] && request.method === "POST") {
        const result = await this.claim(seg[1], ip);
        return json(result, result.ok ? 200 : 404);
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: `Internal error: ${err.message}` }, 500);
    }
  }

  async create(payload, ip) {
    if (!this.allow(ip, "create")) return { ok: false, reason: "rate_limited" };
    const valid = await validateSharePayload(payload);
    if (!valid.ok) return valid;

    // Sweep + count in one pass; at ≤ MAX_OUTSTANDING keys this is cheap.
    const all = await this.ctx.storage.list({ prefix: "share:" });
    const now = Date.now();
    let live = 0;
    for (const [key, share] of all) {
      if (share.expiresAt <= now) await this.ctx.storage.delete(key);
      else live += 1;
    }
    if (live >= MAX_OUTSTANDING) return { ok: false, reason: "busy" };

    let code = randomCode();
    while (all.has(`share:${code}`)) code = randomCode();
    const expiresAt = now + SHARE_TTL_MS;
    await this.ctx.storage.put(`share:${code}`, { payload, expiresAt });

    // Arm the sweep for this expiry unless an earlier one is already set.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > expiresAt) await this.ctx.storage.setAlarm(expiresAt + 1000);

    return { ok: true, code, expiresInSeconds: SHARE_TTL_MS / 1000 };
  }

  async claim(rawCode, ip) {
    if (!this.allow(ip, "claim")) return { ok: false, reason: "rate_limited" };
    const key = `share:${normalizeCode(rawCode)}`;
    const share = await this.ctx.storage.get(key);
    if (!share || share.expiresAt <= Date.now()) return { ok: false, reason: "not_found" };
    await this.ctx.storage.delete(key); // one use — gone on first claim
    return { ok: true, payload: share.payload };
  }

  async alarm() {
    const all = await this.ctx.storage.list({ prefix: "share:" });
    const now = Date.now();
    let nextExpiry = null;
    for (const [key, share] of all) {
      if (share.expiresAt <= now) await this.ctx.storage.delete(key);
      else if (nextExpiry === null || share.expiresAt < nextExpiry) nextExpiry = share.expiresAt;
    }
    if (nextExpiry !== null) await this.ctx.storage.setAlarm(nextExpiry + 1000);
  }
}

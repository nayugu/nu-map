// ShareBoxDO — the one coat-check counter for share-by-code.
//
// A single instance (idFromName("global")) holds every parked share as
// its own storage key (`share:<id>` → { payload, expiresAt }), because
// volume is tiny and one instance makes claim-once atomic and the
// outstanding-shares cap trivial. Validation and the per-IP rate budget
// come from the dev server's shareBox module — same reuse pattern as
// SessionDO ↔ planState.
//
// Shares are ENCRYPTED by the client (src/core/shareCrypto.js). This
// object receives an opaque id and opaque ciphertext and never learns the
// code, so it cannot derive the key and cannot read a plan. Codes are
// generated client-side, which is why nothing here mints one.
//
// Lifecycle: create parks a share and arms an alarm at its expiry;
// claim returns the payload once and deletes it; the alarm sweeps
// expired leftovers and re-arms for the next-soonest expiry. Nothing
// outlives SHARE_TTL_MS, so steady-state storage is a few kilobytes.

import {
  validateSharePayload, validateShareId, createRateLimiter,
  SHARE_TTL_MS, MAX_OUTSTANDING, MAX_LIVE_PER_IP,
} from "../../../mcp-server/src/shareBox.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    this.rate = createRateLimiter();
    // Sender-tab pickup sockets hibernate between events; the runtime
    // answers their keepalive pings without waking this DO.
    try { this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch { /* older runtime */ }
  }

  // The "interrupt": push the burn to every hibernating sender socket
  // tagged with this code, then hang up.
  burnNotify(code, msg) {
    for (const ws of this.ctx.getWebSockets(code)) {
      try { ws.send(msg); ws.close(1000, msg); } catch { /* already gone */ }
    }
  }

  // Hibernation handlers — pings are auto-answered above; anything else
  // is ignored, and closed sockets clean themselves up.
  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}

  /** 200 ok · 429 rate/concurrency · 404 unknown code · 400 the rest. */
  static statusOf(result) {
    if (result.ok) return 200;
    if (result.reason === "rate_limited" || result.reason === "too_many_live") return 429;
    if (result.reason === "not_found") return 404;
    if (result.reason === "collision") return 409;
    return 400;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const seg = pathname.split("/").filter(Boolean);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

    try {
      if (seg[0] === "share" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const result = await this.create(body?.id, body?.payload, ip);
        return json(result, ShareBoxDO.statusOf(result));
      }
      if (seg[0] === "claim" && seg[1] && request.method === "POST") {
        const result = await this.claim(seg[1], ip);
        return json(result, ShareBoxDO.statusOf(result));
      }
      if (seg[0] === "share-status" && seg[1] && request.method === "GET") {
        const result = await this.status(seg[1], ip);
        return json(result, ShareBoxDO.statusOf(result));
      }
      // Pickup interrupt: the sender tab parks a hibernating socket on
      // its code and is pushed 'claimed' the instant the code burns.
      // Creator-IP only — anyone else gets a flat 404 whether or not the
      // code exists, same rule as status().
      if (seg[0] === "share-ws" && seg[1] && request.headers.get("Upgrade") === "websocket") {
        const id = seg[1];
        const share = validateShareId(id) ? await this.ctx.storage.get("share:" + id) : null;
        if (!share || share.expiresAt <= Date.now() || share.ip !== ip) {
          return json({ error: "Not found" }, 404);
        }
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1], [id]);
        return new Response(null, { status: 101, webSocket: pair[0] });
      }
      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: `Internal error: ${err.message}` }, 500);
    }
  }

  async create(id, payload, ip) {
    const gate = this.rate.take(ip, "create");
    if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
    if (!validateShareId(id)) return { ok: false, reason: "bad_id" };
    const valid = validateSharePayload(payload);
    if (!valid.ok) return valid;

    // Sweep + count (global and this IP's) in one pass; at
    // ≤ MAX_OUTSTANDING keys this is cheap.
    const all = await this.ctx.storage.list({ prefix: "share:" });
    const now = Date.now();
    let live = 0, mine = 0, earliestMine = null;
    for (const [key, share] of all) {
      if (share.expiresAt <= now) { await this.ctx.storage.delete(key); continue; }
      live += 1;
      if (share.ip === ip) {
        mine += 1;
        if (earliestMine === null || share.expiresAt < earliestMine) earliestMine = share.expiresAt;
      }
    }
    // Concurrency cap: claimed/canceled/expired shares free their slot
    // immediately, so sequential use is never limited — only hogging.
    if (mine >= MAX_LIVE_PER_IP) {
      return { ok: false, reason: "too_many_live",
               retryAfterSeconds: Math.max(1, Math.ceil((earliestMine - now) / 1000)) };
    }
    if (live >= MAX_OUTSTANDING) return { ok: false, reason: "busy" };

    // The client picks the code, so two senders can in principle pick the
    // same one (~1 in 887 million against a live set of at most 2,000).
    // Refuse rather than overwrite: the incumbent's share must survive,
    // and the client simply generates another code.
    if (all.has(`share:${id}`)) return { ok: false, reason: "collision" };
    const expiresAt = now + SHARE_TTL_MS;
    await this.ctx.storage.put(`share:${id}`, { payload, expiresAt, ip });

    // Arm the sweep for this expiry unless an earlier one is already set.
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > expiresAt) await this.ctx.storage.setAlarm(expiresAt + 1000);

    return { ok: true, expiresInSeconds: SHARE_TTL_MS / 1000 };
  }

  // Pickup feedback for the sender's tab. Only the creator's IP learns
  // anything — everyone else gets a flat "not yours" whether the code
  // exists or not, so status can never scan for codes silently.
  async status(id, ip) {
    const gate = this.rate.take(ip, "status");
    if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
    const share = validateShareId(id) ? await this.ctx.storage.get(`share:${id}`) : null;
    return { ok: true, live: !!(share && share.expiresAt > Date.now() && share.ip === ip) };
  }

  async claim(id, ip) {
    const gate = this.rate.take(ip, "claim");
    if (!gate.ok) return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds };
    if (!validateShareId(id)) return { ok: false, reason: "not_found" };
    const key = `share:${id}`;
    const share = await this.ctx.storage.get(key);
    if (!share || share.expiresAt <= Date.now()) return { ok: false, reason: "not_found" };
    await this.ctx.storage.delete(key); // one use — gone on first claim
    this.burnNotify(id, "claimed");
    // Self-cancel is a no-op on the world, so it's free: taking back
    // your own code refunds both tokens. Claims of OTHER people's codes
    // stay budgeted — that's the scan defense.
    if (share.ip === ip) {
      this.rate.refund(ip, "claim");
      this.rate.refund(ip, "create");
    }
    return { ok: true, payload: share.payload };
  }

  async alarm() {
    const all = await this.ctx.storage.list({ prefix: "share:" });
    const now = Date.now();
    let nextExpiry = null;
    for (const [key, share] of all) {
      if (share.expiresAt <= now) {
        await this.ctx.storage.delete(key);
        this.burnNotify(key.slice("share:".length), "expired");
      }
      else if (nextExpiry === null || share.expiresAt < nextExpiry) nextExpiry = share.expiresAt;
    }
    if (nextExpiry !== null) await this.ctx.storage.setAlarm(nextExpiry + 1000);
  }
}

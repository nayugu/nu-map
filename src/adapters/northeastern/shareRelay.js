// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/shareRelay  (implements IShareRelay)
//
// Share-by-code against the MCP server's one-shot relay:
//   POST /share            { id, payload }  →  { ok, expiresInSeconds }
//   POST /claim/:id                         →  { ok, payload }
//
// The plan is ENCRYPTED here, under the share code itself, before it
// leaves the tab (src/core/shareCrypto.js). The code is generated on this
// side and never sent: one slow KDF pass over it yields both the storage
// id the server files the share under and the AES key that opens it. The
// relay therefore holds an opaque id and opaque bytes and cannot read a
// plan even if it wanted to — see shareCrypto's header for the honest
// limits of a six-character secret.
//
// PlannerContext still hands in / receives the plain planShare payload;
// encryption is entirely contained in this adapter.
//
// Same server as the Claude integration but a separate, session-free
// surface: no session id is sent, nothing persists past one claim or the
// server-side TTL.
//
// Server URL: VITE_MCP_SERVER_URL (default: http://localhost:27182).
// ═══════════════════════════════════════════════════════════════════

import {
  randomCode, normalizeCode, deriveShareId, encryptForCode, decryptWithCode,
} from "../../core/shareCrypto.js";

const SERVER = (import.meta.env.VITE_MCP_SERVER_URL ?? "http://localhost:27182")
  .replace(/\/$/, "");
const WS_SERVER = SERVER.replace(/^http/, "ws");

/**
 * code → id for shares THIS tab created. Every sender-side operation
 * (status, watch, cancel) needs the id, and deriving it costs a
 * deliberately slow KDF pass — unacceptable inside `pagehide`, where
 * sendBeacon must be called synchronously or not at all. Creating the
 * share already paid for the derivation, so keep it.
 */
const idCache = new Map();

/** How many fresh codes to try before giving up on a storage collision. */
const COLLISION_RETRIES = 3;

async function post(path, body) {
  let res;
  try {
    res = await fetch(`${SERVER}${path}`, {
      method: "POST",
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new Error("network");
  }
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    const err = new Error(json?.reason ?? "network");
    // Rate/concurrency refusals say when the block lifts — the UI counts
    // it down instead of showing a dead-end error.
    if (typeof json?.retryAfterSeconds === "number") err.retryAfterSeconds = json.retryAfterSeconds;
    throw err;
  }
  return json;
}

/** @type {import('../../ports/IShareRelay.js').IShareRelay} */
export default {
  async createShareCode(payload) {
    let lastErr;
    // A collision means another live share already derives to this id
    // (~1 in 887 million). A different code is the whole fix.
    for (let attempt = 0; attempt < COLLISION_RETRIES; attempt++) {
      const code = randomCode();
      const { id, blob } = await encryptForCode(code, payload);
      try {
        const { expiresInSeconds } = await post("/share", { id, payload: blob });
        idCache.set(code, id);
        return { code, expiresInSeconds };
      } catch (err) {
        if (err.message !== "collision") throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("collision");
  },

  async claimShareCode(code) {
    const id = await deriveShareId(code);
    const { payload } = await post(`/claim/${id}`);
    // A wrong code cannot reach here — it derives a different id and the
    // server answers not_found. Decryption failing therefore means the
    // stored bytes were not what this code sealed.
    return decryptWithCode(code, payload);
  },

  /**
   * Farewell cancel: revoke a share while the tab is unloading. Claiming
   * your own share burns it, and sendBeacon is the one request browsers
   * guarantee to attempt during pagehide — fetch would be dropped, and so
   * would anything awaiting a key derivation, which is why the id comes
   * from the cache rather than being recomputed here.
   */
  abandonShareCode(code) {
    const id = idCache.get(normalizeCode(code)) ?? idCache.get(code);
    if (!id) return;
    try { navigator.sendBeacon?.(`${SERVER}/claim/${id}`); } catch {}
  },

  /**
   * Pickup polling: true while the share is still parked (unclaimed and
   * unexpired). The server answers honestly only to the share's creator.
   * Used as the slow backstop under watchShareCode.
   */
  async shareCodeStatus(code) {
    const id = idCache.get(normalizeCode(code)) ?? await deriveShareId(code);
    const res = await fetch(`${SERVER}/share-status/${id}`);
    const json = await res.json().catch(() => null);
    if (!json?.ok) throw new Error(json?.reason ?? "network");
    return !!json.live;
  },

  /**
   * The pickup interrupt: a WebSocket parked on the share (hibernating
   * server-side, so it costs nothing while idle) that is pushed 'claimed'
   * the instant it burns. Returns an unwatch function, or null when
   * sockets aren't available (the poll backstop covers it).
   *
   * Synchronous by contract, so it uses the cached id: only the creator
   * may watch, and the creator always has one.
   */
  watchShareCode(code, onPickedUp) {
    const id = idCache.get(normalizeCode(code)) ?? idCache.get(code);
    if (!id) return null;
    let ws;
    try { ws = new WebSocket(`${WS_SERVER}/share-ws/${id}`); } catch { return null; }
    let ping = null;
    const stop = () => { if (ping) { clearInterval(ping); ping = null; } };
    ws.onopen = () => {
      // Keepalive well inside Cloudflare's ~100 s idle cutoff; answered
      // by the runtime without waking the DO.
      ping = setInterval(() => { try { ws.send("ping"); } catch { /* closing */ } }, 30_000);
    };
    ws.onmessage = (e) => { if (e.data === "claimed") onPickedUp(); };
    ws.onclose = stop;
    ws.onerror = stop;
    return () => { stop(); try { ws.close(1000); } catch { /* already closed */ } };
  },
};

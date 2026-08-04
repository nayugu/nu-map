// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/shareRelay  (implements IShareRelay)
//
// Share-by-code against the MCP server's one-shot relay:
//   POST /share        { payload }  →  { ok, code, expiresInSeconds }
//   POST /claim/:code               →  { ok, payload }
//
// The payload is opaque here — PlannerContext encodes/decodes with
// planShare. Same server as the Claude integration but a separate,
// session-free surface: no session id is sent, nothing persists past
// one claim or the server-side TTL.
//
// Server URL: VITE_MCP_SERVER_URL (default: http://localhost:27182).
// ═══════════════════════════════════════════════════════════════════

const SERVER = (import.meta.env.VITE_MCP_SERVER_URL ?? "http://localhost:27182")
  .replace(/\/$/, "");
const WS_SERVER = SERVER.replace(/^http/, "ws");

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
    const { code, expiresInSeconds } = await post("/share", { payload });
    return { code, expiresInSeconds };
  },

  async claimShareCode(code) {
    const { payload } = await post(`/claim/${encodeURIComponent(code)}`);
    return payload;
  },

  /**
   * Farewell cancel: revoke a code while the tab is unloading. Claiming
   * your own code burns it, and sendBeacon is the one request browsers
   * guarantee to attempt during pagehide — fetch would be dropped.
   */
  abandonShareCode(code) {
    try { navigator.sendBeacon?.(`${SERVER}/claim/${encodeURIComponent(code)}`); } catch {}
  },

  /**
   * Pickup polling: true while the code is still parked (unclaimed and
   * unexpired). The server answers honestly only to the code's creator.
   * Used as the slow backstop under watchShareCode.
   */
  async shareCodeStatus(code) {
    const res = await fetch(`${SERVER}/share-status/${encodeURIComponent(code)}`);
    const json = await res.json().catch(() => null);
    if (!json?.ok) throw new Error(json?.reason ?? "network");
    return !!json.live;
  },

  /**
   * The pickup interrupt: a WebSocket parked on the code (hibernating
   * server-side, so it costs nothing while idle) that is pushed
   * 'claimed' the instant the code burns. Returns an unwatch function,
   * or null when sockets aren't available (the poll backstop covers it).
   */
  watchShareCode(code, onPickedUp) {
    let ws;
    try { ws = new WebSocket(`${WS_SERVER}/share-ws/${encodeURIComponent(code)}`); } catch { return null; }
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

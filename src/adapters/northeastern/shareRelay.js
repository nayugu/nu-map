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
};

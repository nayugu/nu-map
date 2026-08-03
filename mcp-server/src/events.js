// Browser channel: MCP server → browser (NU Map app), keyed by session ID.
// Used to push proposals, apply-immediately changesets, and UI commands
// to whatever browser tab has NU Map open.
//
// Two transports, one frame format (a JSON event per message):
//   • WebSocket  /ws/:sessionId      — what the current client uses
//   • SSE        /events/:sessionId  — kept for already-deployed clients
//
// Keepalive is an app-level text frame: the browser sends PING_FRAME, the
// server answers PONG_FRAME. The frames mirror the Cloudflare worker's
// setWebSocketAutoResponse pair, so the browser adapter is transport-host
// agnostic — do not change one side without the other.

export const PING_FRAME = "ping";
export const PONG_FRAME = "pong";

const _sessions = new Map(); // sessionId → Set<res>  (SSE)
const _sockets  = new Map(); // sessionId → Set<ws>   (WebSocket)

function bucket(map, sessionId) {
  if (!map.has(sessionId)) map.set(sessionId, new Set());
  return map.get(sessionId);
}

/**
 * Register a new SSE response stream for a given session.
 * Keeps the connection alive with a heartbeat every 25 s.
 */
export function addClient(sessionId, res) {
  res.writeHead(200, {
    "Content-Type":  "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection":    "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write("retry: 3000\n\n");
  const clients = bucket(_sessions, sessionId);
  clients.add(res);

  const hb = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(hb); clients.delete(res); }
  }, 25_000);

  res.on("close", () => { clearInterval(hb); clients.delete(res); });
}

/**
 * Register a WebSocket for a given session. Works with any ws-like object
 * exposing on("message"/"close"/"error") and send() — the `ws` package in
 * production, a plain fake in tests.
 */
export function addSocket(sessionId, ws) {
  const sockets = bucket(_sockets, sessionId);
  sockets.add(ws);
  ws.on("message", (data) => {
    // App-level keepalive; everything else on this channel is server→browser.
    if (data.toString() === PING_FRAME) {
      try { ws.send(PONG_FRAME); } catch { sockets.delete(ws); }
    }
  });
  ws.on("close", () => sockets.delete(ws));
  ws.on("error", () => { sockets.delete(ws); try { ws.close(); } catch {} });
}

/** Number of browser tabs connected for a given session (both transports). */
export function clientCount(sessionId) {
  return bucket(_sessions, sessionId).size + bucket(_sockets, sessionId).size;
}

/**
 * Broadcast a JSON event to all browser tabs connected for a given session.
 * @param {string} sessionId
 * @param {{ type: string, [key: string]: unknown }} event
 */
export function broadcast(sessionId, event) {
  const frame = JSON.stringify(event);
  for (const res of bucket(_sessions, sessionId)) {
    try { res.write(`data: ${frame}\n\n`); } catch { _sessions.get(sessionId).delete(res); }
  }
  for (const ws of bucket(_sockets, sessionId)) {
    try { ws.send(frame); } catch { _sockets.get(sessionId).delete(ws); }
  }
}

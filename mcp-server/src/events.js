// SSE channel: MCP server → browser (NU Map app), keyed by session ID.
// Used to push proposals, apply-immediately changesets, and UI commands
// to whatever browser tab has NU Map open and is connected to /events/:sessionId.

const _sessions = new Map(); // sessionId → Set<res>

function getClients(sessionId) {
  if (!_sessions.has(sessionId)) _sessions.set(sessionId, new Set());
  return _sessions.get(sessionId);
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
  const clients = getClients(sessionId);
  clients.add(res);

  const hb = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(hb); clients.delete(res); }
  }, 25_000);

  res.on("close", () => { clearInterval(hb); clients.delete(res); });
}

/** Number of browser tabs connected for a given session. */
export function clientCount(sessionId) { return getClients(sessionId).size; }

/**
 * Broadcast a JSON event to all browser tabs connected for a given session.
 * @param {string} sessionId
 * @param {{ type: string, [key: string]: unknown }} event
 */
export function broadcast(sessionId, event) {
  const data    = `data: ${JSON.stringify(event)}\n\n`;
  const clients = getClients(sessionId);
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}

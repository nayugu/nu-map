// Minimal MCP Streamable-HTTP transport for a single request/response
// cycle (JSON mode). The spec allows a server to answer a POST with
// application/json instead of an SSE stream; since our server is
// stateless per request (same as the Node dev server), every POST gets
// a fresh McpServer + one of these.

const RESPONSE_TIMEOUT_MS = 30_000;

export class SingleRequestTransport {
  constructor() {
    this._responses = [];
    this._pendingIds = new Set();
    this._resolve = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }

  async start() {}
  async close() { this.onclose?.(); }

  async send(message) {
    // Collect responses to the requests in flight; drop server-initiated
    // notifications (nothing is listening in JSON mode).
    if (message.id !== undefined && this._pendingIds.has(message.id)) {
      this._responses.push(message);
      this._pendingIds.delete(message.id);
      if (this._pendingIds.size === 0) this._resolve?.();
    }
  }

  /**
   * Feed the POSTed JSON-RPC payload (message or batch) to the server and
   * await the matching response(s).
   * @returns {object|object[]|null} null when the payload was notifications-only
   */
  async handle(body) {
    const messages = Array.isArray(body) ? body : [body];
    for (const m of messages) {
      if (m && m.id !== undefined && m.method !== undefined) this._pendingIds.add(m.id);
    }

    const done = this._pendingIds.size > 0
      ? new Promise(r => { this._resolve = r; })
      : null;

    for (const m of messages) this.onmessage?.(m);

    if (!done) return null;
    await Promise.race([
      done,
      new Promise(r => setTimeout(r, RESPONSE_TIMEOUT_MS)),
    ]);
    return Array.isArray(body) ? this._responses : this._responses[0] ?? null;
  }
}

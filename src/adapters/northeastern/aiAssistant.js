// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/aiAssistant  (implements IAIAssistant)
//
// STATUS: Built but not active — not wired in src/config.js until the
// MCP server is deployed and VITE_MCP_SERVER_URL is set.
//
// Each browser gets a stable UUID (persisted in localStorage) that
// scopes all MCP communication to that user's session.
//
// Outbound: POSTs live plan state to POST /sync-plan/:sessionId.
//
// Inbound:  Subscribes to GET /events/:sessionId SSE stream.
//           Dispatches PROPOSAL, APPLY, COMMAND, PROPOSAL_RESOLVED to
//           any handlers registered with onEvent().
//           PlannerContext registers a handler on mount.
//
// getMCPUrl(): returns the MCP endpoint URL the user pastes into
//              claude.ai → Settings → Integrations.
//
// Server URL: set VITE_MCP_SERVER_URL env var (default: http://localhost:27182).
// ═══════════════════════════════════════════════════════════════════

const SERVER = (import.meta.env.VITE_MCP_SERVER_URL ?? "http://localhost:27182")
  .replace(/\/$/, "");

// ── Session ID ────────────────────────────────────────────────────

function getSessionId() {
  try {
    let id = localStorage.getItem("nu-map-mcp-session");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("nu-map-mcp-session", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

const SESSION_ID = getSessionId();

// ── Event subscription ────────────────────────────────────────────

const _handlers = new Set();

function dispatch(event) {
  for (const h of _handlers) {
    try { h(event); } catch (err) {
      console.warn("[aiAssistant] event handler error:", err);
    }
  }
}

// ── SSE connection ────────────────────────────────────────────────

let _sse = null;
let _connected = false;
let _reconnectTimer = null;

function connect() {
  if (_sse) return;
  try {
    _sse = new EventSource(`${SERVER}/events/${SESSION_ID}`);
  } catch {
    scheduleReconnect();
    return;
  }

  _sse.onopen = () => { _connected = true; };

  _sse.onerror = () => {
    _connected = false;
    _sse?.close();
    _sse = null;
    scheduleReconnect();
  };

  _sse.onmessage = (e) => {
    try { dispatch(JSON.parse(e.data)); } catch { /* malformed event — skip */ }
  };
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    connect();
  }, 5_000);
}

// Connect as soon as the module loads (non-blocking — SSE connects async)
connect();

// ── Adapter ───────────────────────────────────────────────────────

/** @type {import('../../ports/IAIAssistant.js').IAIAssistant} */
export default {
  isAvailable() { return _connected; },

  /**
   * Push the current plan state to the MCP server.
   * Fire-and-forget; never throws.
   */
  notifyChange(context) {
    fetch(`${SERVER}/sync-plan/${SESSION_ID}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(context),
    }).catch(() => {});
  },

  /**
   * Confirm or reject a pending proposal.
   * Fire-and-forget; never throws.
   */
  confirmProposal(proposalId, accepted) {
    fetch(`${SERVER}/confirm-proposal/${SESSION_ID}/${proposalId}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ accepted }),
    }).catch(() => {});
  },

  /**
   * The MCP endpoint URL for this session — users paste this into
   * claude.ai → Settings → Integrations to connect Claude to their plan.
   */
  getMCPUrl() {
    return `${SERVER}/session/${SESSION_ID}/mcp`;
  },

  /**
   * Subscribe to incoming MCP events (PROPOSAL, APPLY, COMMAND, PROPOSAL_RESOLVED).
   * Returns an unsubscribe function — call it from the effect cleanup.
   *
   * @param {(event: object) => void} handler
   * @returns {() => void} unsubscribe
   */
  onEvent(handler) {
    _handlers.add(handler);
    return () => _handlers.delete(handler);
  },

  getSources() {
    return [{
      id:      "nu-map-mcp",
      label:   "NU Map MCP Server",
      url:     SERVER,
      usedFor: "AI assistant (Claude) integration",
    }];
  },
};

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

  _sse.onopen = () => {
    _connected = true;
    // Re-assert pairing/consent — covers server restarts that wiped the
    // in-memory session state.
    if (_consent.paired) pushConsent();
  };

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

// ── Consent (pairing + kill switch) ───────────────────────────────
// DEFAULT OFF. Nothing syncs and no plan tool works until the user has
// LINKED their Claude to this NU Map: Claude shows a 6-character code
// in the chat (request_pairing tool), the user types it into the Claude
// panel here, and only that confirms the link. `enabled` is the pause
// switch on top of pairing; `autoApply` is the review-free opt-in.
// Enforcement is server-side; these local flags are defense in depth
// (no data leaves the tab while unpaired/paused) and survive reloads.

const CONSENT_KEY = "nu-map-claude-consent";

function readConsentState() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONSENT_KEY) || "{}");
    return {
      paired:    raw.paired    === true,
      enabled:   raw.paired === true && raw.enabled === true,
      autoApply: raw.autoApply === true,
    };
  } catch {
    return { paired: false, enabled: false, autoApply: false };
  }
}

let _consent = readConsentState();

function saveConsentState() {
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(_consent)); } catch {}
}

// Restore server-side consent (e.g. after a server restart). The browser
// owns the session secret, so it is authoritative for its own pairing.
function pushConsent() {
  fetch(`${SERVER}/consent/${SESSION_ID}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(_consent),
  }).catch(() => {});
}

/** Version envelope for the sync payload — see mcp-server tolerant reader. */
const SYNC_PAYLOAD_VERSION = 1;

/** @type {import('../../ports/IAIAssistant.js').IAIAssistant} */
export default {
  isAvailable() { return _connected; },

  /**
   * Push the current plan state to the MCP server.
   * Fire-and-forget; never throws. No-ops until paired + enabled.
   * If the server lost the pairing (restart), restores consent and
   * retries once.
   */
  notifyChange(context) {
    if (!_consent.paired || !_consent.enabled) return;
    const body = JSON.stringify({ v: SYNC_PAYLOAD_VERSION, plan: context });
    const send = () => fetch(`${SERVER}/sync-plan/${SESSION_ID}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body,
    });
    send()
      .then(r => r.json())
      .then(j => {
        if (j?.ok === false && j.reason === "not_paired") {
          pushConsent();
          setTimeout(() => send().catch(() => {}), 300);
        }
      })
      .catch(() => {});
  },

  /** Whether this browser is linked to a Claude conversation. */
  isPaired() { return _consent.paired; },

  /** Whether plan access for Claude is currently enabled (paired + not paused). */
  isConsentEnabled() { return _consent.paired && _consent.enabled; },

  /**
   * Confirm a pairing code the user got from Claude in their chat.
   * Resolves true on success. This is the ONLY way plan access turns on.
   */
  async confirmPairing(code) {
    try {
      const res = await fetch(`${SERVER}/pair/${SESSION_ID}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code }),
      });
      const json = await res.json();
      if (json?.ok) {
        _consent = { ..._consent, paired: true, enabled: true };
        saveConsentState();
        return true;
      }
    } catch {}
    return false;
  },

  /** Sever the link entirely — requires a fresh pairing code to reconnect. */
  disconnect() {
    _consent = { paired: false, enabled: false, autoApply: false };
    saveConsentState();
    fetch(`${SERVER}/consent/${SESSION_ID}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ unpair: true }),
    }).catch(() => {});
  },

  /**
   * Pause/resume plan access without unpairing (the kill switch).
   * Only meaningful while paired.
   */
  setConsent(enabled) {
    _consent = { ..._consent, enabled: _consent.paired && !!enabled };
    saveConsentState();
    pushConsent();
  },

  /** Whether apply-without-review is enabled (off by default). */
  isAutoApplyEnabled() { return _consent.autoApply; },

  /**
   * Opt in/out of automatic apply. While off (the default), the server
   * rejects apply_changes and Claude can only propose changes for review.
   */
  setAutoApply(enabled) {
    _consent = { ..._consent, autoApply: !!enabled };
    saveConsentState();
    pushConsent();
  },

  /**
   * Answer a REQUEST_PLAN event with a saved plan's contents (or null).
   * Fire-and-forget; never throws.
   */
  respondPlanContents(requestId, contents) {
    fetch(`${SERVER}/plan-contents/${SESSION_ID}/${requestId}`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(contents ?? null),
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

// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE, worker edition — the same schedule, read from the same file.
//
// The Pages front door returns 503 during an `offline` window (functions/
// index.js). This worker deploys separately, so without this file it would keep
// happily answering Claude while the site it belongs to is deliberately down —
// which is wrong in exactly the case the shutdown exists for: "a bug bad enough
// that the site comes off for safety". Safety that the MCP surface ignores is
// not safety.
//
// ── One source of truth, not a copy ────────────────────────────────
//
// The policy is `resolveMaintenance` from src/core/maintenance.js, imported.
// This worker has always reached across that boundary (see loadData.js), so
// there is no reason to reimplement caps, phases or demotion here — and every
// reason not to.
//
// The schedule is read from `DATA_ORIGIN`, which is the deployed site and is
// already where this worker gets its catalog. Note that this keeps working
// during an `offline` window: only `/` is gated at the edge, never the JSON
// assets. That is deliberate on both sides.
//
// ── What `degraded` finally means ──────────────────────────────────
//
// Until this file existed, `severity: "degraded"` with `features: ["claude"]`
// only PRINTED a warning in the app — it was a label, not a switch, and the
// docs had to say so. Now the named feature is actually refused here: `claude`
// closes /mcp and the session channel, `share` closes the code relay. The
// vocabulary was already closed (FEATURES in the core), so this is the
// mechanism the label was always describing.
//
// ── Fail open, and never block observability ───────────────────────
//
// Same rule as the edge: any failure to read the schedule means "no
// maintenance". And `/health` is never gated — it is how we find out what state
// everything is in, so taking it down during an incident would remove the one
// instrument that matters. Same reasoning as leaving the health beacon up.
// ═══════════════════════════════════════════════════════════════════

import { resolveMaintenance } from "../../../src/core/maintenance.js";

/** Isolates are reused, so one fetch serves many requests. */
let _cache = { at: 0, state: null };
const TTL_MS = 60e3;

/** Paths that must answer no matter what. */
const ALWAYS_UP = ["/health"];

/**
 * Resolved maintenance state, cached for a minute.
 * @param {any} env
 * @returns {Promise<ReturnType<typeof resolveMaintenance>|null>}
 */
async function state(env) {
  const now = Date.now();
  if (_cache.state && now - _cache.at < TTL_MS) return _cache.state;
  try {
    const origin = (env?.DATA_ORIGIN ?? "https://numap.app").replace(/\/$/, "");
    const res = await fetch(`${origin}/maintenance.json?t=${now}`, { cache: "no-store" });
    if (!res.ok) { _cache = { at: now, state: null }; return null; }
    const text = await res.text();
    // A missing file answers with the SPA shell at 200 (see public/_headers),
    // so the body decides, not the status.
    if (!text || text.trimStart().startsWith("<")) { _cache = { at: now, state: null }; return null; }
    const resolved = resolveMaintenance(JSON.parse(text), Date.now());
    _cache = { at: now, state: resolved };
    return resolved;
  } catch {
    // Cache the failure too, briefly: an unreachable origin must not turn into
    // a fetch on every single request.
    _cache = { at: now, state: null };
    return null;
  }
}

/**
 * Should this request be refused, and with what?
 *
 * @param {Request} request
 * @param {any} env
 * @returns {Promise<Response|null>} a 503 to return, or null to carry on
 */
export async function maintenanceGate(request, env) {
  try {
    const { pathname } = new URL(request.url);
    if (ALWAYS_UP.includes(pathname)) return null;
    if (request.method === "OPTIONS") return null;   // preflight is not a request for data

    const m = await state(env);
    if (!m) return null;

    // An `offline` window closes everything. A `degraded` one closes only what
    // it names, and the two feature ids that reach this worker are `claude`
    // (the MCP surface and its browser channel) and `share` (the code relay).
    let closed = m.blocking;
    if (!closed && m.featuresDown.length) {
      const isShare = pathname === "/share" || pathname.startsWith("/claim/") || pathname.startsWith("/share-status/");
      if (isShare) closed = m.featuresDown.includes("share");
      else closed = m.featuresDown.includes("claude");
    }
    if (!closed) return null;

    const retryAt = m.overrunning
      ? m.window.end
      : (m.window.expectedEnd ?? m.window.end);
    return new Response(
      JSON.stringify({
        error: "maintenance",
        // Written to be READ ALOUD: whatever surfaces this — Claude, a log line,
        // a curl — should be able to tell the user something true and useful
        // rather than "the connection failed".
        message: m.overrunning
          ? "NU Map is under maintenance and is taking longer than expected. Plans are stored in the user's own browser and are unaffected."
          : `NU Map is under maintenance until about ${new Date(retryAt).toISOString()}. Plans are stored in the user's own browser and are unaffected.`,
        until: new Date(retryAt).toISOString(),
        kind: m.kind,
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "retry-after": String(Math.max(30, Math.ceil((retryAt - Date.now()) / 1000))),
          "cache-control": "no-store",
          "access-control-allow-origin": "*",
        },
      },
    );
  } catch {
    // See the header: a schedule we cannot read is not a maintenance window,
    // and this must never be why the worker fails.
    return null;
  }
}

/** Test seam — drops the cached verdict. */
export function _resetMaintenanceCache() {
  _cache = { at: 0, state: null };
}

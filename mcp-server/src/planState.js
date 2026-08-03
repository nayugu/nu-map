// Per-session server state: the live plan snapshot (with revision + diff
// history), pending proposals, consent (the in-app kill switch), and
// in-flight plan-contents requests.
//
// Writes come from the browser (POST /sync-plan, /confirm-proposal,
// /plan-contents, /consent) and from optimistic applies after
// apply_changes. Reads come from MCP tools.

import { randomCode } from "./shareBox.js";

const CHANGE_BUFFER_MAX = 50;

const _sessions = new Map();

function sess(id) {
  if (!_sessions.has(id)) {
    _sessions.set(id, {
      plan: null,
      rev: 0,
      lastSyncedAt: null,
      changeSeq: 0,           // monotonic id for change entries
      lastReadSeq: 0,         // highest seq Claude has seen (via envelope)
      changes: [],            // ring buffer of { seq, rev, at, origin, summary[] }
      proposals: new Map(),
      nextId: 1,
      // paired:   the user has linked this Claude conversation to their
      //           NU Map by entering a pairing code IN the app. Without
      //           it there is no plan access at all — default off.
      // enabled:  the kill switch — pauses access without unpairing.
      // autoApply: apply-without-review opt-in — OFF by default.
      consent: { paired: false, enabled: false, autoApply: false },
      pendingPairCodes: new Map(), // code → expiresAt (ms epoch)
      pendingPlanRequests: new Map(), // requestId → { resolve, timer }
      nextRequestId: 1,
    });
  }
  return _sessions.get(id);
}

// ── Plan diffing ────────────────────────────────────────────────────
// Human-readable summaries of what changed between consecutive syncs —
// piggybacked on tool responses so Claude learns what the user did
// without polling.

const SCALAR_FIELDS = [
  "major", "major2", "concentration", "minor1", "minor2",
  "studentType", "currentSemId", "bonusSH",
  "entSem", "entYear", "gradSem", "gradYear", "planId",
];

function diffPlans(prev, next) {
  if (!prev) return [`plan synced (${Object.keys(next.placements ?? {}).length} placements)`];
  const out = [];

  const pPl = prev.placements ?? {}, nPl = next.placements ?? {};
  for (const [id, sem] of Object.entries(nPl)) {
    if (!(id in pPl))          out.push(`${id} placed in ${sem}`);
    else if (pPl[id] !== sem)  out.push(`${id} moved ${pPl[id]} → ${sem}`);
  }
  for (const id of Object.keys(pPl)) {
    if (!(id in nPl)) out.push(`${id} removed from ${pPl[id]}`);
  }

  for (const f of SCALAR_FIELDS) {
    if ((prev[f] ?? "") !== (next[f] ?? "")) out.push(`${f}: ${prev[f] ?? "∅"} → ${next[f] ?? "∅"}`);
  }

  const pWt = Object.keys(prev.workExperience ?? {}).length;
  const nWt = Object.keys(next.workExperience ?? {}).length;
  if (pWt !== nWt) out.push(`work terms: ${pWt} → ${nWt}`);

  const pPo = (prev.placedOut ?? []).length, nPo = (next.placedOut ?? []).length;
  if (pPo !== nPo) out.push(`placed-out courses: ${pPo} → ${nPo}`);
  const pSu = (prev.substitutions ?? []).length, nSu = (next.substitutions ?? []).length;
  if (pSu !== nSu) out.push(`substitutions: ${pSu} → ${nSu}`);

  return out;
}

// ── Plan snapshot ───────────────────────────────────────────────────

export function getPlan(sessionId) { return sess(sessionId).plan; }

/**
 * Store a new snapshot, bump the revision, and record a diff entry.
 * origin: "browser" (sync) | "claude" (optimistic apply).
 */
export function setPlan(sessionId, plan, origin = "browser") {
  const s = sess(sessionId);
  const summary = diffPlans(s.plan, plan);
  s.plan = plan;
  s.rev += 1;
  s.lastSyncedAt = new Date().toISOString();
  if (summary.length) {
    s.changes.push({ seq: ++s.changeSeq, rev: s.rev, at: s.lastSyncedAt, origin, summary });
    if (s.changes.length > CHANGE_BUFFER_MAX) s.changes.splice(0, s.changes.length - CHANGE_BUFFER_MAX);
  }
  return s.rev;
}

/**
 * Envelope info attached to every tool response (`_plan`). Marks the
 * current revision as read, so `changedSinceLastRead` and
 * `recentChanges` cover exactly the span since Claude's previous call.
 */
export function planEnvelope(sessionId) {
  const s = sess(sessionId);
  if (!s.plan) return { connected: false };
  // Unread = user/browser-side changes since Claude's last call: plan
  // edits plus proposal decisions. Claude's own optimistic applies are
  // excluded — it already knows about those.
  const unread = s.changes.filter(c => c.origin !== "claude" && c.seq > s.lastReadSeq);
  const changed = unread.length > 0;
  const pendingProposals = [...s.proposals.values()].filter(p => p.status === "pending").length;
  const envelope = {
    connected: true,
    rev: s.rev,
    lastSyncedAt: s.lastSyncedAt,
    changedSinceLastRead: changed,
    // Signal that the user has opted into direct edits — Claude should
    // use apply_changes for unambiguous requests instead of proposing.
    ...(s.consent.autoApply && { autoApplyEnabled: true }),
    ...(pendingProposals > 0 && { pendingProposals }),
    ...(changed && { recentChanges: unread.flatMap(c => c.summary).slice(-20) }),
  };
  s.lastReadSeq = s.changeSeq;
  return envelope;
}

/** Full change buffer (for get_plan include:"changes"). */
export function getChanges(sessionId) { return sess(sessionId).changes; }

// ── Consent (kill switch) ───────────────────────────────────────────

export function getConsent(sessionId) { return sess(sessionId).consent; }

/**
 * Merge-patch the consent flags ({ paired?, enabled?, autoApply?, unpair? }).
 * Called only from browser-originated HTTP routes — the browser owns the
 * session (it holds the session secret), so it may restore `paired` after
 * a server restart; MCP tools can never reach this.
 * `enabled` can only be true while paired.
 */
export function setConsent(sessionId, patch = {}) {
  const s = sess(sessionId);
  if (patch.unpair) {
    // Disconnect = deletion, not just gating: the plan snapshot, change
    // history, and pending proposals are all dropped (the privacy policy
    // promises exactly this).
    s.consent = { paired: false, enabled: false, autoApply: false, updatedAt: new Date().toISOString() };
    s.plan = null;
    s.changes = [];
    s.proposals.clear();
    return;
  }
  const next = {
    ...s.consent,
    ...(patch.paired    !== undefined && { paired:    !!patch.paired }),
    ...(patch.enabled   !== undefined && { enabled:   !!patch.enabled }),
    ...(patch.autoApply !== undefined && { autoApply: !!patch.autoApply }),
    updatedAt: new Date().toISOString(),
  };
  if (!next.paired) { next.enabled = false; next.autoApply = false; }
  s.consent = next;
}

// ── Pairing (Claude conversation ↔ NU Map browser) ──────────────────
// Claude calls the request_pairing tool → gets a short code → shows it
// to the user → the user enters it in the NU Map Claude panel → the
// browser POSTs /pair. Approval always happens IN the app.

const PAIR_CODE_TTL_MS = 10 * 60 * 1000;

export function createPairingCode(sessionId) {
  const s = sess(sessionId);
  const code = randomCode(); // crypto-random, no 0/O/1/I/L (shareBox alphabet)
  // Drop expired codes; keep at most 3 outstanding.
  const now = Date.now();
  for (const [c, exp] of s.pendingPairCodes) if (exp < now) s.pendingPairCodes.delete(c);
  while (s.pendingPairCodes.size >= 3) {
    s.pendingPairCodes.delete(s.pendingPairCodes.keys().next().value);
  }
  s.pendingPairCodes.set(code, now + PAIR_CODE_TTL_MS);
  return { code, expiresInMinutes: PAIR_CODE_TTL_MS / 60000 };
}

export function confirmPairing(sessionId, code) {
  const s = sess(sessionId);
  const norm = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const exp  = s.pendingPairCodes.get(norm);
  if (!exp || exp < Date.now()) return false;
  s.pendingPairCodes.clear();
  setConsent(sessionId, { paired: true, enabled: true });
  return true;
}

// ── Proposals ───────────────────────────────────────────────────────
// Records persist after resolution (status pending → approved/rejected)
// so Claude can learn the outcome: resolutions are written to the change
// feed (surfaced in every tool response's _plan envelope) and the full
// list is readable via get_plan include:"proposals".

const PROPOSALS_MAX = 20;

export function addProposal(sessionId, changeset, meta = {}) {
  const s  = sess(sessionId);
  const id = `proposal_${s.nextId++}`;
  s.proposals.set(id, {
    changeset, meta,
    status: "pending",
    baseRev: s.rev,
    createdAt: new Date().toISOString(),
  });
  while (s.proposals.size > PROPOSALS_MAX) {
    s.proposals.delete(s.proposals.keys().next().value);
  }
  return id;
}

export function getProposal(sessionId, id) { return sess(sessionId).proposals.get(id) ?? null; }

export function resolveProposal(sessionId, id, accepted) {
  const s = sess(sessionId);
  const p = s.proposals.get(id);
  if (!p) return;
  p.status     = accepted ? "approved" : "rejected";
  p.resolvedAt = new Date().toISOString();
  // Surface the user's decision in the change feed → _plan envelope.
  s.changes.push({
    seq: ++s.changeSeq, rev: s.rev, at: p.resolvedAt, origin: "user",
    summary: [`${id} ${p.status} by user${accepted ? ` (${(p.changeset.actions ?? []).length} actions applied)` : ""}`],
  });
  if (s.changes.length > CHANGE_BUFFER_MAX) s.changes.splice(0, s.changes.length - CHANGE_BUFFER_MAX);
}

export function listProposals(sessionId) {
  return [...sess(sessionId).proposals.entries()].map(([id, p]) => ({ id, ...p }));
}

// ── Plan-contents round-trip (read a non-active plan) ───────────────
// Server → browser: REQUEST_PLAN over SSE; browser → server: POST
// /plan-contents/:sid/:requestId with the plan JSON.

export function createPlanRequest(sessionId, timeoutMs = 5000) {
  const s = sess(sessionId);
  const requestId = `req_${s.nextRequestId++}`;
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.pendingPlanRequests.delete(requestId);
      resolve(null);
    }, timeoutMs);
    s.pendingPlanRequests.set(requestId, { resolve, timer });
  });
  return { requestId, promise };
}

export function resolvePlanRequest(sessionId, requestId, contents) {
  const s = sess(sessionId);
  const pending = s.pendingPlanRequests.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  s.pendingPlanRequests.delete(requestId);
  pending.resolve(contents);
  return true;
}

// In-memory state shared across all MCP tool call handlers, keyed by session ID.
// All writes come from the browser (POST /sync-plan/:sid, POST /confirm-proposal/:sid/:id).
// All reads come from MCP tools (via /session/:sid/mcp).

const _sessions = new Map(); // sessionId → { plan, proposals, nextId }

function sess(id) {
  if (!_sessions.has(id)) _sessions.set(id, { plan: null, proposals: new Map(), nextId: 1 });
  return _sessions.get(id);
}

export function getPlan(sessionId)       { return sess(sessionId).plan; }
export function setPlan(sessionId, plan) { sess(sessionId).plan = plan; }

export function addProposal(sessionId, changeset) {
  const s  = sess(sessionId);
  const id = `proposal_${s.nextId++}`;
  s.proposals.set(id, { changeset, createdAt: Date.now() });
  return id;
}

export function getProposal(sessionId, id)    { return sess(sessionId).proposals.get(id) ?? null; }
export function resolveProposal(sessionId, id) { sess(sessionId).proposals.delete(id); }

export function listProposals(sessionId) {
  return [...sess(sessionId).proposals.entries()].map(([id, p]) => ({ id, ...p }));
}

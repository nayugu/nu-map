// ═══════════════════════════════════════════════════════════════════
// PORT: IShareRelay
//
// Driven (secondary) port — one-shot plan sharing through a short code
// instead of a long snapshot URL ("share by code").
//
// The relay is a coat check, not a store: the app parks an encoded plan
// snapshot (the SAME planShare v2 artifact a snapshot link carries, so
// grades structurally cannot travel), gets back a short human-speakable
// code, and the first claim of that code returns the payload once and
// deletes it. Unclaimed shares expire server-side after ~10 minutes.
//
// Encoding/decoding stays in the app (src/core/planShare.js) — the
// adapter only ferries the opaque payload string. No session, pairing,
// or account is involved; this port is independent of IAIAssistant even
// though the default adapter happens to talk to the same server.
//
// Who implements this?
//   - src/adapters/northeastern/shareRelay.js (MCP server's /share + /claim)
//   - Absent entirely when no server URL is configured — the UI hides
//     the feature rather than pointing at nothing.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IShareRelay = "shareRelay";

/**
 * @typedef {Object} IShareRelay
 *
 * @property {(payload: string) => Promise<{ code: string, expiresInSeconds: number }>} createShareCode
 *   Park an encoded plan payload and resolve with the claim code.
 *   Rejects with Error(reason) — reason ∈ "rate_limited" | "too_large" |
 *   "bad_payload" | "busy" | "disabled" | "network".
 *
 * @property {(code: string) => Promise<string>} claimShareCode
 *   Redeem a code for its payload (single use). Rejects with
 *   Error(reason) — reason ∈ "not_found" | "rate_limited" | "disabled" |
 *   "network".
 */

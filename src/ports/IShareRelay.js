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
 *
 * @property {(code: string) => void} [abandonShareCode]
 *   Fire-and-forget revoke that survives tab unload (sendBeacon). A code
 *   lives only while its sender's tab does; the server TTL is merely the
 *   backstop for crashes and clients that never say goodbye.
 *
 * @property {(code: string) => Promise<boolean>} [shareCodeStatus]
 *   Whether the code is still parked (unclaimed, unexpired). Only the
 *   creator's IP gets an honest answer — for anyone else it reports
 *   false regardless, so it can't be used to scan the code space.
 *
 * @property {(code: string, onPickedUp: () => void) => (() => void) | null} [watchShareCode]
 *   Push-based pickup feedback: parks a WebSocket on the code (creator
 *   IP only; hibernates server-side) and calls onPickedUp the moment
 *   the code is claimed. Returns an unwatch function, or null when
 *   sockets are unavailable — callers keep shareCodeStatus as backstop.
 */

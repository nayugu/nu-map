// ═══════════════════════════════════════════════════════════════════
// PORT: IAIAssistant
//
// Driven (secondary) port — the application calls this to push plan
// state to an AI assistant whenever the plan changes.
//
// This is the outbound half of two-way AI communication:
//   App  ──notifyChange()──▶ IAIAssistant adapter ──▶ MCP resource
//   AI   ──tool call──────▶ IPlannerQuery adapter ──▶ catalog / audit
//   AI   ──tool call──────▶ IPlannerAction adapter ──▶ plan mutations
//
// The port only handles the app's outbound push.  The AI drives all
// reads through IPlannerQuery and all writes through IPlannerAction.
// Keeping them separate means this port creates no dependency on either.
//
// "Two-way" at the MCP protocol level:
//   - notifyChange() updates an MCP resource (numap://plan).
//   - Claude.ai subscribes to that resource.
//   - When the user changes their plan in NU Map, the resource updates
//     and Claude is notified automatically — no user action needed.
//
// Authentication and session management are adapter concerns.
//
// Who implements this?
//   - src/adapters/mcp/aiAssistantAdapter.js  (POSTs plan to MCP server)
//   - A no-op stub for institutions with no AI integration
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IAIAssistant = "aiAssistant";

/**
 * @typedef {Object} IAIAssistant
 *
 * @property {() => boolean} isAvailable
 *   Returns true if the adapter is configured and an AI client is connected.
 *   The app uses this to decide whether to show the "linked to Claude" indicator
 *   and whether calling notifyChange() is worth the network round-trip.
 *
 * @property {(context: import('./IPlannerQuery.js').PlanContext) => void} notifyChange
 *   Push the current plan state to the AI assistant.
 *   Called by PlannerContext whenever a meaningful plan change occurs:
 *   course placed / moved / removed, program changed, co-op added, etc.
 *   Fire-and-forget — the app does not await a response.
 *   The adapter must never throw — swallow and log internally so a broken
 *   AI connection never disrupts the planner.
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External systems this adapter communicates with.  See IAttributable.
 */

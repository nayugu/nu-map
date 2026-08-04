# MCP API Design — extensibility & backward compatibility

Companion to `PARITY.md` (what to expose). This doc is *how* to expose it so new app
features slot in without breaking older clients or bloating the tool list.

## The one structural decision that matters

**The MCP server is an adapter over the existing ports, and the ports are the
compatibility boundary.** `IPlannerQuery` and `IPlannerAction` already define the read and
write contracts; the app UI is one consumer, the MCP server is a second. Adding a feature
means extending the port once — the UI and Claude both pick it up, and the server never
grows private logic that can drift from the app (the `deriveTerms` birth-filter drift is
the cautionary tale). Concretely:

- All derivations (offering probability, seat math, completed-vs-planned, audits) are
  **imported from `src/core` + adapters**, never re-implemented in `mcp-server/`.
- Data files (`offering-summary.json`, `term-details.json`, …) are read **as-is from the
  scrape outputs** — the scrapers stay the single place data gets fixed.

## Why MCP versioning ≠ REST versioning

There are two very different consumers, and they need different compatibility treatment:

1. **Claude (LLM)** reads tool descriptions + JSON at call time. It has no compiled-in
   schema, so *additive* change is free: new fields, new enum values, new optional params
   are picked up automatically and unknown ones are ignored. The only breaking changes are
   **renaming/removing/repurposing** — so those are simply banned.
2. **The browser ↔ server sync protocol** is machine-to-machine, and users sit on stale
   tabs of a static site for weeks. This is where real version skew happens, so this is
   where the version envelope lives — not in the tool names.

There is no `/v2/` anywhere. Compatibility is carried by rules, not URL versions.

## Rule set (the whole policy fits here)

1. **Additive only.** New capability = new optional field / new enum value / new optional
   tool param. Never rename, remove, or change the meaning of anything shipped.
2. **Tolerant readers everywhere.** Server ignores unknown fields in synced plans; browser
   ignores unknown SSE event fields; `applyChangeset` returns
   `{unsupported: ["SET_FOO"]}` for unknown action types instead of erroring the batch.
   This makes *skew safe in both directions* (new browser + old server, and vice versa).
3. **Version envelope on machine contracts only.** Sync payload becomes
   `{v: 1, plan: {...}}`; SSE events carry `v`. Bump `v` only for semantic changes,
   which rule 1 makes rare.
4. **Capabilities are discoverable, not assumed.** `get_meta` returns supported action
   types, supported ui_commands, data-file freshness, and payload version. Claude checks
   capabilities instead of guessing; a browser tab that hasn't reloaded since an update
   still works because the server advertises only what that session's sync provided.
5. **Deprecate by description.** If a tool must be superseded, keep it working, prefix its
   description with "Deprecated — use X". The LLM follows descriptions; nothing breaks.

## Tool surface: few tools, growing objects

Feature growth should widen *objects*, not multiply *tools* (tool-list bloat measurably
degrades LLM tool selection). The pattern: domain tools with an `include` param whose enum
grows additively.

### Reads

| Tool | Params (initial) | Notes |
|---|---|---|
| `search_courses` | query, subject, attributes, level, college, campus, format, meetsOn, term, minSH, maxSH, openSeats, limit, cursor | new filters = new optional params; results are summary records (id, code, title, sh, attributes) |
| `get_course` | `ids[]` (batch!), `include: ["offerings", "patterns", "history", "relationships", "links"]` | base record always; facets opt-in. New data facet = new include value |
| `list_programs` | type (major/minor), level (undergrad/grad), college, year, query | summary records with metadata (verified, totalCreditsRequired, newerVersion) |
| `get_program` | programId, `include: ["tree", "concentrations"]` | raw requirement tree + concentration options/minOptions |
| `audit_program` | programId, concentration?, plan? | uses live plan + its selections by default; returns tree annotated done/planned/missing |
| `get_plan` | `include: ["schedule", "semesters", "violations", "nupath", "conflicts", "scratchpad"]` | base = identity, cohort (incl. studentType), selections w/ resolved labels, placements, work terms, overrides, totals. `schedule` = per-semester view exactly as rendered; `semesters` = grid vocabulary |
| `list_plans` | — | id, name, studentType, active |
| `get_plan_contents` | planId | read a *non-active* plan without switching the user's screen |
| `check_prereqs` | courseId, completedIds? (defaults from live plan) | unchanged |
| `get_meta` | — | data freshness per file, sources/attribution, change-log tail, capabilities (rule 4) |

### Writes (unchanged trio + registry)

`validate_changeset` → `propose_changes` → `apply_changes`, all taking `{actions[]}`.
Actions stay an **open registry** of `{type, ...}` objects — the zod passthrough already
allows this; the fix is making both `applyChangeset`s (server dry-run, browser live)
data-driven maps instead of switches, sharing one action-definition module so a new action
is added in exactly one place. Initial additions per PARITY: `SET_MAJOR2`,
`SET_STUDENT_TYPE`, `STAR_COURSE`/`UNSTAR_COURSE`, `ADD_TO_PALETTE`/`REMOVE_FROM_PALETTE`.

`ui_command` keeps its own registry: `FOCUS_COURSE`, `OPEN_SEARCH`, `SET_BANK_TAB`,
+ `EXPORT_PDF`, `EXPORT_JSON`, `COPY_SHARE_LINK` (browser-side features exposed as
commands — the PDF renders client-side, so this is the natural home).

### Resources

`numap://plan` (kept), `numap://semesters`, `numap://meta` — cheap bulk context Claude can
attach without burning tool calls.

## Sync payload changes

Browser → server payload gains: `v`, `studentType`, `starredIds`, `palette`, `locale`,
resolved `majorLabel`/`minor*Label`, `coopGradConflicts`, violation detail maps, and
(name+id+studentType) for all plans. Contents of inactive plans served on demand via a
`REQUEST_PLAN` SSE round-trip rather than syncing everything always (payload stays small;
`get_plan_contents` awaits the response with a timeout).

## Sessions, identity & consent

Model: **any Claude chat with the nu-map connector enabled can reach your plan, iff you
have consented on the nu-map side.** Identity and authorization are deliberately split:

- **Identity (who is asking)** comes from the connector's OAuth — on the NU Enterprise
  org every chat is authenticated as a specific user, so the server knows "this is
  student@northeastern.edu's chat" with no pairing codes typed into conversations.
- **Authorization (may they see/change this plan)** is granted in the app, not the chat,
  and is **OFF by default**. The link is created by a pairing handshake: a plan tool call
  while unlinked tells Claude to call `request_pairing`, which returns a 6-character code
  (10-minute expiry) that Claude shows the user; the user types that code into the NU Map
  Claude panel and presses Connect. That confirms the person in the chat and the person at
  the planner are the same, with the approval action performed inside nu-map. Until then,
  the browser sends nothing and the server stores nothing (`/sync-plan` refuses unpaired
  sessions). Pairing is durable until disconnected; with hosted OAuth the code confirm
  binds `claudeUserId ↔ browser session` instead of just the session.
- **Read-first by design.** The API's primary purpose is understanding: giving Claude the
  full picture fast so it can help *plan*. Writes are secondary and default to
  **propose-only**: every change goes through the in-app review UI for approval.
  `apply_changes` (no per-change review) works only when the user has intentionally
  enabled auto-apply in settings — off by default, enforced server-side.
- **ClaudePanel becomes the consent manager**: connection status, what's linked, a revoke
  button, and the auto-apply toggle. Catalog and program tools need no consent — they're
  public data.
- **Tab closed?** With consent on file the server can answer from the last synced
  snapshot, clearly marked with its sync timestamp (`_plan.rev` + `lastSyncedAt`); write
  tools and ui_commands report "no tab connected". This requires persisting snapshots
  server-side (Durable Object storage), which the consent screen should say plainly.
- **Kill switch (settings, instant).** A "Claude access" toggle in nu-map settings turns
  plan access off at ANY time, mid-conversation included. Enforcement is **server-side**:
  flipping it off POSTs the consent state to the server, which from that moment refuses
  every plan-scoped tool (reads, writes, ui_commands) with "access disabled by user" and
  stops serving the stored snapshot; the browser also stops syncing. Catalog and program
  tools keep working — that's the public database, not your data. Flipping back on
  restores access without re-pairing (the durable link is kept; it's a pause).
- **Revocation** (the stronger action, in ClaudePanel) deletes the link *and* the stored
  snapshot — re-enabling requires consenting again.
- Defense in depth: if the server is unreachable when the user flips the switch, the
  browser's sync stop still guarantees no *new* data leaves the tab; the server-side gate
  catches up on reconnect.

## Live changes: how Claude stays current

Hard limit first: **an MCP server cannot start a model turn.** Claude speaks only when the
user does; no push mechanism can make it react to a drag-and-drop unprompted. So the
design target is not "Claude reacts live" — it's "Claude is *never stale at the moment it
acts*, and always knows what changed since it last looked."

Four mechanisms, layered:

1. **Pull-on-demand (baseline, already works).** The browser syncs 400 ms after every
   change, so the server snapshot is always current; every tool call reads it fresh. Any
   user question that triggers a tool call is answered from live state.
2. **Revision + piggybacked change feed.** The server stamps each synced snapshot with a
   monotonic `rev` and keeps a small ring buffer of diffs (computed server-side between
   consecutive snapshots: "CS3500 moved fall2026→spr2027", "minor2 set"). Every tool
   response carries an envelope field `_plan: {rev, changedSinceLastRead, recentChanges}`.
   Claude doesn't have to poll — *any* call it makes for any reason also tells it what the
   user did meanwhile. A `changes` include on `get_plan` returns the full buffer.
3. **Closing the write-read race.** After `apply_changes`, the browser applies and
   re-syncs (~0.5–1 s); a naive immediate read returns pre-apply state. Fix: the server
   optimistically applies the changeset to its own snapshot (it already computes
   `resultingPlan` in dry-run with the same shared `applyChangeset`) and reconciles on the
   next browser sync. `apply_changes` responses include the new `rev`.
4. **Resource subscription (progressive enhancement).** MCP supports
   `resources/subscribe` + `notifications/resources/updated` on `numap://plan`. Where the
   client honors it this invalidates stale context, but it still doesn't wake the model —
   treat it as a cache hint, never a dependency.

Net effect in practice: user drags courses around mid-conversation, then asks "does this
still work?" — Claude's first tool call returns both the fresh state and the list of what
moved, so its answer accounts for edits it was never explicitly told about.

## Worked example: "we add professor ratings next semester"

1. Scraper writes `professor-ratings.json` (scrape-routine rule).
2. Loader attaches `ratings` to course records.
3. `get_course` gains `include: "ratings"` — one enum value.
4. Nothing else changes: no new tool, no version bump, old conversations and stale browser
   tabs unaffected, and the UI can adopt the same data through the port whenever it wants.

That's the test any future change should pass: *one enum value or one registry entry, zero
renames, zero version bumps.*

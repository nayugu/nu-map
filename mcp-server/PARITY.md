# MCP Data Parity — everything the user sees vs. what Claude gets

Goal: Claude connected via MCP has **the same information as a user looking at the app**.
Compiled 2026-07-22 from a full walk of `src/ui/`, `src/core/`, the adapters, the scrapers,
and `mcp-server/`. Status legend: ✅ exposed today · ⚠️ partial/drifted · ❌ missing.

## A. Course catalog (static, server-loaded)

| # | Information (where the user sees it) | Source | Status |
|---|---|---|---|
| A1 | Course identity: id, subject, number, code, title | `catalog-courses.json` | ✅ `search_courses` / `get_course` |
| A2 | Description (restriction-boilerplate sanitized) | same | ✅ |
| A3 | Credits incl. variable ranges `sh`/`shMin`/`shMax` (editable credit badge) | same | ✅ |
| A4 | Schedule type badge (Lecture/Lab/…) | same | ✅ |
| A5 | Prereq/coreq expression trees incl. `concurrent` flags (prereq chips + tooltips) | same | ✅ |
| A6 | NUPath attribute badges | `nuPath` + supplement back-fill | ✅ verified 2026-07-22: 0 courses rely on the supplement today; keep `data.js` matching `courseCatalog.normalizeCourse` |
| A7 | CPS marker (`· CPS` suffix) + subject→college | `subject-colleges.json` (college `PS`) | ❌ file never loaded |
| A8 | `birthTermCode` (existence anchor; all offering stats are post-birth) | derived in `courseCatalog.js` | ❌ **server's `deriveTerms` skips the birth filter → its `terms` differ from the app's** |
| A9 | Relationship graph: what a course unlocks, coreq links (Relationships column, SVG lines) | `extractEdges` over all courses | ❌ no reverse-prereq/unlocks query |
| A10 | Catalog deep link ("catalog ↗") | `courseCatalog.courseUrl` | ❌ trivial add |
| A11 | Course count + "updated {date}" (header) | `dataMeta.lastUpdated`, `change-log.json` | ❌ no freshness tool |

## B. Offering / scheduling data (the redesign data)

| # | Information | Source | Status |
|---|---|---|---|
| B1 | Offered-in history, true/false per term (offered-in grid) | `term-history.json` | ✅ `get_offered_in` |
| B2 | **Offering probability per semester type** (label dimming, ⚠ not-offered badges): post-birth `#offered/#total`, null if <2 entries, threshold ≤0.5 | client-derived | ❌ must be exposed or exactly documented; server's 50% rule ignores birth filter (see A8) |
| B3 | Enrolment / capacity / sections per completed term (gauge height = fill%) | `offering-summary.json` `e/c/s` | ❌ file never loaded |
| B4 | Open seats = `c−e`, open-per-section = `open/s` (gauge color, hover stats) | derived from B3 | ❌ |
| B5 | Weekday distribution `dow` (typical-schedule strip; tooltip shows real %) | `offering-summary.json` | ❌ |
| B6 | Meeting-pattern breakdown `pat`, enrolment-weighted, +"other" remainder (hover chart) | `offering-summary.json` | ❌ |
| B7 | Linked-lab flag `lab` | `offering-summary.json` | ❌ |
| B8 | Formats `fmt` + campuses `cmp` (in data; **not yet rendered in UI**) | `offering-summary.json` | ❌ — exceeds strict parity; include for "full access" |
| B9 | Per-term pattern detail `days{pattern:{n,e}}`, per-term formats/campuses | `term-details.json` | ❌ superset (app doesn't read it either); ideal for "which pattern ran when" |
| B10 | NOT in any data (scraper drops it): meeting times-of-day, instructors, rooms, per-section rows | Banner (dropped) | n/a — needs scraper change first (fixes live in scrape scripts) |

## C. Programs & requirements

| # | Information | Source | Status |
|---|---|---|---|
| C1 | Undergrad majors + minors list (label, location, college, year) | `src/data/majors/` (522) | ✅ `list_programs` |
| C2 | **Graduate programs** (485) | `src/data/grad-majors/` | ❌ not scanned |
| C3 | Concentrations per major: options + `minOptions` ("concentration required" warning) | major JSON `concentrations` | ❌ not listed, and… |
| C4 | **Concentration audit** (selected conc's section merged into allocation, shared used-set) | `allocateMajorWithElectives` 4th arg | ❌ server hard-codes `null` (`server.js:163`) |
| C5 | Requirement tree audit: sat/satCount/satSh/matched/warnings, one-course-used-once, coreq consumption, substitution virtual placements, General Electives | `gradRequirements.js` (imported from src — no drift) | ✅ |
| C6 | **Completed vs planned split** in every progress number/bar (green vs blue) | doneSet = semesters before `currentSemId` | ❌ audit has no doneKeys → Claude can't tell taken from planned |
| C7 | `totalCreditsRequired`, `metadata.verified` badge, `yearVersion` | program JSON | ⚠️ in `majorData` but not surfaced in list/audit output |
| C8 | "Newer version available" banner | `findNewerMajorVersion` | ❌ |
| C9 | Stale-path resolution (tiered newest-year fallback) | `resolveInMap` | ⚠️ server only normalizes path shape |
| C10 | NUPath grid: 3×4 codes+labels, coverage incl. co-op EX grant, count | `attributeSystem` | ✅ `get_nupath_coverage` (⚠️ hardcodes `typeId==="coop"` instead of reading `attributeGrants` — drift risk) |

## D. Live plan (browser-synced)

| # | Information | Sync payload field | Status |
|---|---|---|---|
| D1 | Plan identity + all saved plans (switcher, grouped by type) | `planId/planName/allPlans` | ✅ (⚠️ per-plan `studentType` grouping not in `allPlans`) |
| D2 | Cohort: entry/grad sem+year, currentSemId | `entSem/entYear/gradSem/gradYear/currentSemId` | ✅ |
| D3 | **Student type (undergrad/graduate)** — drives program tree, slot counts, NUPath visibility | in app state, **not in payload** | ❌ |
| D4 | Program selections: major, **major2**, concentration, minors | synced | ⚠️ `major2` undocumented in PlanContext typedef; no `SET_MAJOR2` server action |
| D5 | Resolved program labels | `majorLabel` etc. | ❌ sent as `null`; server should resolve from `majorData` |
| D6 | Placements incl. `"incoming"` slot; semester display order | `placements/semOrders` | ✅ |
| D7 | Work experience: type, semester, duration, company(+domain), role; occurrence numbering; spans | `workExperience` | ✅ data ⚠️ semantics (spans/numbering) not exposed |
| D8 | Special-term **placement validity rules** (4-mo co-op fall/spring…, 2-mo intern summer-only) | `specialTerms.validateDrop` | ❌ server can't validate work-term moves |
| D9 | Placed-out, substitutions, bonusSH, shOverrides, offeredOverrides | synced | ✅ |
| D10 | Credit totals: done + placed (header badges) | `totalSHDone/totalSHPlaced` | ✅ |
| D11 | Per-semester SH + load flags (red > max, warn < full-time min) | `getSemSH` + `creditSystem` limits | ❌ limits not exposed |
| D12 | **Semester grid vocabulary**: valid semIds, labels, status (completed/NOW/future), slot capacity, summer pairing | `buildCohortSemesters` | ❌ Claude must guess semId format ("fall2025" vs "spr2026") — needs a `get_semesters` read |
| D13 | Violation **details**: per-course prereq order-vs-missing, coreq alone/sep (badges, red lines) | `prereqViolations/coreqViolations` maps | ⚠️ only counts synced; details derivable via dry-run |
| D14 | Co-op ↔ graduation conflict warnings (header) | `coopGradConflicts` | ❌ not synced |
| D15 | Starred courses (bank ★ tab) and palette/scratch-pad | localStorage only (`PlannerContext.jsx:182,202`) | ❌ not synced, no read, no actions — yet `SET_BANK_TAB` can switch to the starred tab Claude can't see |
| D16 | Selected/focused course | `selectedCourseId` | ✅ |
| D17 | Share/export formats (JSON v1, share-link v2 compact keys) | `planShare.js` | ❌ optional: a `get_share_link` tool would round out parity with the ⇅ menu |
| D18 | **Contents of inactive plans** (user can switch and look; compare plans) | per-plan localStorage | ❌ only the active plan syncs; other plans expose name+id only — cross-plan comparison impossible without SWITCH_PLAN round-trips |
| D19 | Semester-grid schedule view exactly as rendered (per semester: label, status, ordered courses, SH + load flag, work-term blocks incl. continuations) | derivable from D6+D7+D12 | ⚠️ raw data synced; a `get_schedule` convenience read would eliminate reconstruction errors |

## E. Write-path parity (user can do it → Claude should too)

| # | Action | Status |
|---|---|---|
| E1 | Place/remove/move courses, placed-out, substitutions, work terms, minors, bonusSH, sh/offered overrides, entry/grad/current-sem, plan mgmt | ✅ actions exist |
| E2 | `SET_MAJOR2` (browser handles it; server `applyChangeset` rejects → dry-run fails) | ❌ |
| E3 | `SET_STUDENT_TYPE` | ❌ |
| E4 | Star/unstar, palette add/remove | ❌ |
| E5 | **Bug:** `guardChangeset` references out-of-scope `sessionId` (`server.js:412`) → every `propose_changes`/`apply_changes` throws | ❌ must fix |

## F. Out of scope (cosmetic / deliberate)

Subject colors, theme, legend styling, translation engine state, dev clock, migration banner,
company favicons — presentation-only; Claude doesn't need them for information parity.
`locale` may be worth syncing so Claude answers in the user's language.

---

### Reading order for implementation

1. Fix E5 (write path is dead), add E2/E3 actions, add D3 to the sync payload.
2. Server data layer: load `offering-summary.json`, `term-details.json`, `subject-colleges.json`, scan `grad-majors/` (B3–B9, C2, A7).
3. Port the exact client derivations (B2 probability incl. birth filter, B4, C6 doneKeys, C4 concentration) — reuse/extract from `src/` instead of re-implementing (the A8 drift shows why).
4. New reads: `get_semesters` (D12), offering history v2, `get_schedule_patterns`, `list_concentrations`, `get_data_freshness`, unlocks/edges (A9).

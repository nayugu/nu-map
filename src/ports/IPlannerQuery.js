// ═══════════════════════════════════════════════════════════════════
// PORT: IPlannerQuery
//
// Driving (primary) port — external actors (Claude via MCP, CLI tools,
// test harnesses) use this to read everything in the planner.
//
// Read surface mirrors the full PlannerContext state: every field a
// human can see on screen, plus deeper research queries (Offered In
// history, NUPath coverage, requirement audit, dry-run validation)
// that the UI doesn't surface directly.
//
// All methods are pure with respect to the plan: they either accept
// an explicit plan argument, or read from a single live snapshot
// provided by the adapter at construction time.  No side effects.
//
// PlanContext is defined here because IPlannerQuery produces it.
// IAIAssistant imports it from here to keep one canonical definition.
//
// Naming convention: type and method names match the labels the user
// sees on screen.  Internal PlannerContext state names (e.g. specialTermPl,
// termHistory) are noted in comments but not used as public identifiers.
//
// Who implements this?
//   - src/adapters/mcp/plannerQueryAdapter.js  (Node.js, for Claude)
//   - Any in-app adapter (command palette, test harness, export tool)
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IPlannerQuery = "plannerQuery";

// ─── Shared plan snapshot ────────────────────────────────────────
// Used as input to audit and validation methods.
// Identical to PlanSnapshot in IMajorRequirements but extended with
// all the fields Claude needs for reasoning.

/**
 * A complete, serializable snapshot of one plan's state.
 * Passed into audit and validation methods; also returned by getPlan().
 * Does not include UI-only state (drag, hover, panel visibility).
 *
 * @typedef {Object} PlanContext
 *
 * Identity
 * @property {string}   planId        - Active plan id.
 * @property {string}   planName      - Active plan display name.
 *
 * Program selections (raw path IDs — pass to auditRequirements)
 * @property {string}   major         - Major program path id, e.g. "2026/khoury/computer-science".
 *                                      Empty string if not selected.
 * @property {string}   major2        - Second major path id (double major). Empty if none.
 * @property {string}   concentration - Concentration label, e.g. "Data Science". Empty if none.
 * @property {string}   minor1        - First minor path id.  Empty if none.
 * @property {string}   minor2        - Second minor path id.  Empty if none.
 *
 * Program labels (human-readable; resolved by the adapter from path ids)
 * @property {string|null} majorLabel        - Resolved major label, e.g. "Computer Science, BS".
 * @property {string|null} major2Label       - Resolved second-major label.
 * @property {string|null} minor1Label       - Resolved first minor label.
 * @property {string|null} minor2Label       - Resolved second minor label.
 *
 * Cohort & timeline
 * @property {string}   studentType   - "undergrad" | "graduate". Drives program tree,
 *                                      slot counts, and NUPath visibility.
 * @property {string}   currentSemId  - Semester the user considers "now", e.g. "fall2025".
 * @property {string}   entSem        - Entry semester type id, e.g. "fall".
 * @property {number}   entYear       - Entry year.
 * @property {string}   gradSem       - Graduation semester type id.
 * @property {number}   gradYear      - Graduation year.
 *
 * Placements — { courseId → semId }
 * Special semId values: "incoming" = Incoming Credit section (AP/transfer, no semester slot).
 * @property {Object.<string, string>} placements
 *
 * Semester order — { semId → courseId[] } display order within each semester
 * @property {Object.<string, string[]>} semOrders
 *
 * Work Experience (co-ops, internships) — { instanceId → WorkTermEntry }
 * Labelled "WORK EXPERIENCE" in the UI.  Internally stored as `specialTermPl` in PlannerContext.
 * @property {Object.<string, WorkTermEntry>} workExperience
 *
 * Placed Out — courses that satisfy prerequisites but earn no degree credit.
 * Labelled "↪ PLACED OUT" in the UI.
 * @property {string[]} placedOut
 *
 * Substitutions — placing `from` also satisfies requirements of `to`.
 * Labelled "⇄ SUBSTITUTIONS" in the UI.
 * @property {{ from: string, to: string }[]} substitutions
 *
 * Bonus / general credits (AP, transfer, test-out — not tied to a specific course).
 * Shown as "general SH" in the Incoming Credit section.  Internally `bonusSH`.
 * @property {number}   bonusSH
 *
 * Credit overrides — { courseId → number } per-plan overrides for variable-credit courses
 * @property {Object.<string, number>} shOverrides
 *
 * Offering overrides the user has manually set.
 * Shape: { courseId → { semTypeId → true | false } }
 *   true  = user forced this course to show as offered in that semester type
 *   false = user forced this course to show as NOT offered in that semester type
 * A course absent from this object has no overrides (availability is auto / probability-based).
 * A semTypeId absent from a course's inner object is also unoverridden.
 * Example: { "CS3500": { "fall": true, "spring": false } } means the user forced
 * CS3500 to show as offered every fall and not offered every spring, overriding
 * whatever the scraped Offered In data would normally predict.
 * @property {Object.<string, Object.<string, boolean>>} offeredOverrides
 *
 * Derived totals (computed by the adapter, not stored)
 * @property {number}   totalSHPlaced - All placed credits + bonusSH.
 * @property {number}   totalSHDone   - Credits in completed semesters + bonusSH.
 *
 * Violations
 * @property {number}   prereqViolationCount  - Courses placed before their prerequisites.
 * @property {number}   coreqViolationCount   - Courses not co-placed with their corequisites.
 * @property {Object.<string, string>} [prereqViolations] - { courseId → "order" | "missing" },
 *                                      the same per-course detail behind the red card badges.
 * @property {Object.<string, string>} [coreqViolations]  - { courseId → "alone" | "sep" }.
 *
 * Bank & scratch pad
 * @property {string[]} [starredIds]  - Courses starred in the bank (★ tab).
 * @property {string[]} [palette]     - Course ids on the scratch-pad palette.
 *
 * Environment
 * @property {string}   [locale]      - The user's UI locale, e.g. "en", "ko". Lets external
 *                                      actors answer in the user's language.
 * @property {{label: string, gradSem: string, gradYear: number}[]} [coopGradConflicts]
 *                                      Co-op ↔ graduation conflicts shown in the header.
 *
 * UI focus (what the user has selected/is looking at right now)
 * @property {string|null} selectedCourseId  - Currently highlighted course, or null.
 */

/**
 * One Work Experience entry (co-op, internship, etc.) as stored in the plan.
 * Labelled "WORK EXPERIENCE" in the UI.  Internally `specialTermPl[instanceId]` in PlannerContext.
 *
 * @typedef {Object} WorkTermEntry
 * @property {string}   typeId          - Type id, e.g. "coop", "intern".
 * @property {string}   semId           - First semester this term occupies, e.g. "fall2025".
 * @property {number}   duration        - Duration in months.
 * @property {string}   [company]       - Employer name, if entered by the user.
 * @property {string}   [companyDomain] - Employer domain, if entered.
 * @property {string}   [subline]       - Role / subtitle, if entered.
 */

// ─── Course search ───────────────────────────────────────────────

/**
 * Options for searching the course catalog.
 * All fields are optional — omitting all returns the full catalog.
 *
 * @typedef {Object} CourseSearchOptions
 * @property {string}   [query]      - Free-text search across code, title, and description.
 *                                     Case-insensitive substring match.
 * @property {string}   [subject]    - Restrict to one subject code, e.g. "CS", "MATH".
 * @property {string[]} [attributes] - Only return courses carrying ALL listed attribute codes,
 *                                     e.g. ["ND", "FQ"] for NUPath.
 * @property {number}   [minSH]      - Minimum credit hours (inclusive).
 * @property {number}   [maxSH]      - Maximum credit hours (inclusive).
 * @property {string}   [term]       - Only return courses offered in this semester type id,
 *                                     e.g. "fall", "spring", "sumA".
 * @property {number}   [limit]      - Maximum results to return.  Defaults to 20.
 */

// ─── Prerequisite checking ───────────────────────────────────────

/**
 * Result of a prerequisite check for one course.
 *
 * @typedef {Object} PrereqCheckResult
 * @property {boolean}  satisfied   - True if every prerequisite is met.
 * @property {string[]} missing     - Course IDs of prerequisites not in completedIds
 *                                    and not eligible for concurrent placement.
 * @property {string[]} concurrent  - Course IDs that may be taken the same semester
 *                                    (catalog: "may be taken concurrently").
 *                                    Not counted as missing.
 * @property {{note: string, kind: string, satisfied: boolean}[]} [conditions]
 *                                  - Non-course prerequisites ("graduate program
 *                                    admission", "permission of instructor") with
 *                                    their classification and whether the plan
 *                                    already meets them. Present only when the
 *                                    course has any. A condition can satisfy a
 *                                    branch but never fails one — see
 *                                    src/core/prereqConditions.js.
 */

// ─── Offered In ──────────────────────────────────────────────────

/**
 * One semester in a course's offering history — the data shown in the
 * "OFFERED IN" section of the course info panel.
 *
 * Covers every past term that was scraped, not just the terms where the
 * course ran.  A `false` entry is as informative as a `true` one: it means
 * the course was confirmed absent that semester (e.g. CS 4992 was not
 * offered Spring 2024), which is useful for predicting future availability.
 *
 * Source: Course.termHistory — { [rawTermCode]: boolean } on the Course object.
 * Populated by the scrape-availability script and bundled into all-courses.json.
 *
 * @typedef {Object} OfferedInEntry
 * @property {string}   termCode  - Raw registrar term code, e.g. "202430".
 * @property {string}   label     - Human-readable label, e.g. "Spring 2025", "FA24".
 * @property {string}   semTypeId - Decoded semester type id, e.g. "spring", "fall", "sumA".
 * @property {number}   year      - Calendar year this term ran in.
 * @property {boolean}  offered   - true  = course was offered this term.
 *                                  false = course was confirmed NOT offered this term.
 */

// ─── NUPath / attribute coverage ────────────────────────────────

/**
 * Coverage status of one attribute code.
 *
 * @typedef {Object} AttributeCoverage
 * @property {string}   code        - Attribute code, e.g. "ND", "EX", "FQ".
 * @property {string}   label       - Full label, e.g. "Natural and Designed World".
 * @property {boolean}  satisfied   - True if the current plan satisfies this attribute.
 * @property {string[]} satisfiedBy - Course IDs in the plan that carry this attribute,
 *                                    plus any work term IDs that grant it (e.g. co-op → "EX").
 */

// ─── Changeset dry-run ───────────────────────────────────────────

/**
 * Result of a dry-run validation of a proposed changeset.
 * Does not mutate any state — the adapter applies the actions to a copy of the plan.
 *
 * @typedef {Object} ChangesetValidation
 * @property {boolean}         valid         - True if the changeset can be applied without errors.
 * @property {ViolationInfo[]} violations    - Prereq/coreq/availability problems in the
 *                                             resulting plan (after applying the changeset).
 * @property {PlanContext}     resultingPlan - Full plan state after the changeset is applied.
 *                                             Use this to reason about the outcome before proposing.
 */

/**
 * One violation in a plan.
 *
 * @typedef {Object} ViolationInfo
 * @property {'prereq'|'coreq'|'availability'|'conflict'} type
 * @property {string}   courseId  - Course that has the violation.
 * @property {string}   message   - Human-readable description.
 * @property {string[]} [related] - Other course IDs involved (e.g. the missing prereq).
 */

// ─── Plan list ───────────────────────────────────────────────────

/**
 * One entry in the plan list.
 *
 * @typedef {Object} PlanListEntry
 * @property {string}  id     - Stable plan id.
 * @property {string}  name   - Display name.
 * @property {boolean} active - True if this is the currently loaded plan.
 */

// ─── Port interface ──────────────────────────────────────────────

/**
 * @typedef {Object} IPlannerQuery
 *
 * ── Course catalog ─────────────────────────────────────────────
 *
 * @property {(opts?: CourseSearchOptions) => import('./ICourseCatalog.js').Course[]} searchCourses
 *   Search the course catalog.  Returns a ranked list.
 *   Ranking: exact code match → code prefix → title prefix → substring.
 *   Operates on the in-memory course map — no I/O.
 *
 * @property {(courseId: string) => import('./ICourseCatalog.js').Course|null} getCourse
 *   Look up one course by stable id (e.g. "CS3500").  Returns null if not found.
 *
 * @property {(courseId: string) => OfferedInEntry[]} getOfferedIn
 *   Return the complete "OFFERED IN" history for a course, ordered newest-first.
 *   Includes every scraped semester — both offered (true) and confirmed-absent (false).
 *   This is the exact data shown in the course info panel's "OFFERED IN" section.
 *   Returns an empty array if no history has been scraped for this course.
 *
 * ── Programs (majors, minors, concentrations) ──────────────────
 *
 * @property {() => import('./IMajorRequirements.js').ProgramOption[]} listPrograms
 *   Return all available majors, minors, and concentrations as a flat list.
 *   Suitable for enumeration before calling auditRequirements.
 *
 * @property {(programId: string, plan: PlanContext) => Promise<import('./IMajorRequirements.js').Program>} auditRequirements
 *   Audit a plan against one program's requirements.
 *   Returns the full requirement tree annotated with satisfaction status,
 *   creditsNeeded, and creditsDone at each node.
 *   Throws if programId is not recognized.
 *
 * ── Active plan ────────────────────────────────────────────────
 *
 * @property {() => PlanContext} getPlan
 *   Return a complete snapshot of the currently active plan.
 *   Includes placements, work experience, program selections, substitutions,
 *   placed-out courses, bonusSH, credit totals, violation counts, offering
 *   overrides, and the currently focused course.
 *   The adapter reads live React state from PlannerContext.
 *
 * @property {() => PlanListEntry[]} listPlans
 *   Return all saved plans (active plan first).
 *   Use SWITCH_PLAN in IPlannerAction to change the active plan.
 *
 * ── Derived reads ─────────────────────────────────────────────
 *
 * @property {(plan?: PlanContext) => AttributeCoverage[]} getNUPathCoverage
 *   Return NUPath attribute coverage for a plan.
 *   If plan is omitted, uses the currently active plan (via getPlan()).
 *   Returns one entry per attribute code in the institution's grid,
 *   ordered to match the grid layout.
 *
 * @property {(courseId: string, completedIds: string[], plan?: PlanContext, studentType?: string) => PrereqCheckResult} checkPrereqs
 *   Check whether a course's prerequisites are met.
 *   completedIds should include all placed, placed-out, and incoming courses.
 *   studentType ("undergrad" | "graduate") resolves non-course conditions when
 *   no plan is passed; a graduate plan satisfies "graduate program admission".
 *   Pure function — does not read live plan state.
 *
 * ── Dry-run ────────────────────────────────────────────────────
 *
 * @property {(actions: import('./IPlannerAction.js').Action[], plan?: PlanContext) => ChangesetValidation} validateChangeset
 *   Apply a sequence of actions to a copy of the plan and return the
 *   resulting state plus any violations — without touching real plan state.
 *   If plan is omitted, starts from the currently active plan.
 *   Use this before calling IPlannerAction.propose() to self-check a
 *   changeset and surface problems in Claude's reasoning before the user sees them.
 *
 * ── Attribution ────────────────────────────────────────────────
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External data sources this adapter draws from.  See IAttributable.
 */

// ═══════════════════════════════════════════════════════════════════
// PORT: IMajorRequirements
// Major, concentration, and minor program data for the graduation panel.
//
// The core needs to know: what programs exist, and which requirements
// does the current plan satisfy?  The adapter is responsible for fetching
// requirement definitions and running the audit logic.
//
// Vite implementation note:
//   import.meta.glob() requires string literals at the call site.
//   The NU adapter's getMajorOptions() and auditMajor() are thin wrappers
//   around majorLoader.js / minorLoader.js, which own the glob calls.
//   This is an adapter-internal constraint — the port interface is the
//   same regardless of how the adapter loads its data.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IMajorRequirements = "majorRequirements";

/**
 * One entry in the major or minor search dropdown.
 *
 * @typedef {Object} ProgramOption
 * @property {string}  id         - Unique stable key passed back to auditMajor/auditMinor.
 *                                  Can be a file path, slug, UUID, or any stable string.
 * @property {string}  label      - Display name shown in the search dropdown and panel header,
 *                                  e.g. "Computer Science", "Data Science"
 * @property {string}  [location] - Secondary qualifier shown next to the label,
 *                                  e.g. "Boston", "Silicon Valley", "Online".
 *                                  Useful when the same program has multiple campus variants.
 *                                  Omit if not applicable.
 * @property {string}  [type]     - Program category: "major" | "concentration" | "minor" | "certificate".
 *                                  Used to filter the dropdown if the UI separates them.
 */

/**
 * A course reference as it appears inside a requirement (leaf node of the req tree).
 *
 * @typedef {Object} CourseRef
 * @property {string} subject
 * @property {string} number
 */

/**
 * One node in a requirement tree, as returned by auditMajor/auditMinor.
 * Trees can be nested arbitrarily; each node either has children (a group)
 * or a courses list (a leaf listing eligible courses).
 *
 * @typedef {Object} Requirement
 * @property {string}        name          - Display name for this requirement block,
 *                                           e.g. "Fundamentals", "Capstone", "Electives (pick 2)"
 * @property {boolean}       satisfied     - True if the current plan fully satisfies this block.
 * @property {number}        [creditsNeeded] - Total credits required for this block.
 *                                             Omit for flag-only requirements.
 * @property {number}        [creditsDone]   - Credits in the plan that count toward this block.
 * @property {Requirement[]} [children]    - Nested sub-requirements (group node).
 *                                           Mutually exclusive with courses.
 * @property {CourseRef[]}   [courses]     - Courses eligible to satisfy this requirement (leaf node).
 *                                           Which courses in the plan ARE satisfying it is
 *                                           derivable by intersecting with plan placements.
 */

/**
 * A snapshot of the current plan state passed to the audit functions.
 * This is the minimum information the auditor needs — adapters must not
 * require full PlannerContext state.
 *
 * @typedef {Object} PlanSnapshot
 * @property {Object.<string, string>} placements   - { courseId → semId } for all placed courses
 * @property {Set<string>}             placedOut     - Course IDs that are placed out (no credit,
 *                                                     but count as completed for prerequisite purposes)
 * @property {{ from: string, to: string }[]} substitutions
 *                                                  - Course substitutions: placing `from` also
 *                                                    satisfies the requirements of `to`.
 *                                                    from/to are both courseIds.
 */

/**
 * A fully audited program with its requirement tree populated.
 *
 * @typedef {Object} Program
 * @property {string}        id            - Same id as the ProgramOption used to load this
 * @property {string}        label         - Display name
 * @property {Requirement[]} requirements  - Top-level requirement blocks with satisfaction computed
 * @property {number}        totalCredits  - Total credit hours required to complete this program
 */

/**
 * @typedef {Object} IMajorRequirements
 *
 * @property {() => ProgramOption[]} getMajorOptions
 *   Return all available major options (flat list).
 *
 * @property {() => ProgramOption[]} getMinorOptions
 *   Return all available minor options (flat list).
 *
 * @property {() => Map<string, ProgramOption[]>} getMajorOptionGroups
 *   Return major options grouped by year/college for use in search dropdowns.
 *   Keys are group labels (e.g. "2025 — Khoury College"); values are option arrays.
 *
 * @property {() => Map<string, ProgramOption[]>} getMinorOptionGroups
 *   Same as getMajorOptionGroups but for minors.
 *
 * @property {(path: string) => Promise<object>} loadMajor
 *   Load the raw program definition JSON for a given option id/path.
 *   The returned shape is adapter-specific; GradPanel consumes it via gradRequirements.js.
 *
 * @property {(path: string) => Promise<object>} loadMinor
 *   Same as loadMajor but for a minor.
 *
 * @property {(id: string, plan: PlanSnapshot, courseMap: Object) => Promise<Program>} auditMajor
 *   Load a major by id and audit its requirements against the given plan.
 *   courseMap is { [courseId]: Course } — needed to look up course credit values during audit.
 *   Returns the Program with the requirements tree fully populated (satisfied, credits, etc.).
 *   Throws if the id is not found.
 *
 * @property {(id: string, plan: PlanSnapshot, courseMap: Object) => Promise<Program>} auditMinor
 *   Same as auditMajor but for a minor or certificate program.
 */

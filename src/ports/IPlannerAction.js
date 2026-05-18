// ═══════════════════════════════════════════════════════════════════
// PORT: IPlannerAction
//
// Driving (primary) port — external actors propose and apply changes
// to the plan.  Pairs with IPlannerQuery (reads).
//
// Two execution modes:
//
//   propose(changeset)  — Queues a named, reviewable set of changes
//                         in the UI.  The user sees each action, can
//                         approve or reject individual items, and applies
//                         the batch.  Nothing changes until the user
//                         confirms.  Use this for substantive plan
//                         restructuring Claude is suggesting.
//
//   apply(changeset)    — Applies a changeset immediately, exactly as
//                         if the user had done each action by hand.
//                         Pushes one entry to the undo stack so the
//                         user can Ctrl+Z the entire batch at once.
//                         Use this for low-risk, unambiguous actions
//                         (e.g. "move CS3500 to the semester the user
//                         just asked about").
//
//   command(uiAction)   — Fires an immediate UI-only action: select a
//                         course, open search, switch bank tab, scroll.
//                         No plan data changes, no undo entry.  Use this
//                         to orient the user's attention.
//
// All write methods validate the changeset before execution and return
// a result that includes any violations.  The adapter must never throw
// on validation failure — return a rejected result instead.
//
// DELETE_PLAN is the one action that requires an explicit confirmation
// flag (requiresConfirmation: true in the result) before applying.
// The adapter enforces this regardless of execution mode.
//
// Who implements this?
//   - src/adapters/mcp/plannerActionAdapter.js  (Node.js, for Claude)
//   - Any in-app adapter (automation scripts, test harness)
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IPlannerAction = "plannerAction";

// ─── Action types ────────────────────────────────────────────────
// All actions are plain objects with a `type` discriminant.
// Types are grouped by concern below.

/**
 * Place a course in a semester.
 * If the course is currently placed-out, removes the placed-out flag.
 * Corequisites are moved with it automatically (same behavior as drag-drop).
 * @typedef {{ type: 'ADD_COURSE', courseId: string, semId: string }} AddCourseAction
 */

/**
 * Remove a course from the plan entirely.
 * If the course has corequisites that are only placed because of it, they are
 * also removed (same behavior as Delete key in the UI).
 * @typedef {{ type: 'REMOVE_COURSE', courseId: string }} RemoveCourseAction
 */

/**
 * Move a placed course to a different semester.
 * Corequisites move with it.
 * @typedef {{ type: 'MOVE_COURSE', courseId: string, toSemId: string }} MoveCourseAction
 */

/**
 * Mark a course as placed-out: satisfies prerequisites but earns no credit.
 * If the course is currently placed in a semester, removes it from that semester.
 * @typedef {{ type: 'ADD_PLACED_OUT', courseId: string }} AddPlacedOutAction
 */

/**
 * Remove placed-out status from a course.
 * Does not automatically re-place the course in any semester.
 * @typedef {{ type: 'REMOVE_PLACED_OUT', courseId: string }} RemovePlacedOutAction
 */

/**
 * Add a course substitution: placing `fromId` also satisfies requirements of `toId`.
 * Credits count only once (from the actual placed `fromId` course).
 * @typedef {{ type: 'ADD_SUBSTITUTION', fromId: string, toId: string }} AddSubstitutionAction
 */

/**
 * Remove a substitution by its from/to pair.
 * @typedef {{ type: 'REMOVE_SUBSTITUTION', fromId: string, toId: string }} RemoveSubstitutionAction
 */

/**
 * Add a Work Experience term (co-op, internship, etc.) at a semester.
 * Labelled "WORK EXPERIENCE" in the UI; internally stored in `specialTermPl`.
 * The adapter validates placement rules (duration fit, no slot conflict)
 * using ISpecialTerms.validateDrop().
 * @typedef {{ type: 'ADD_WORK_TERM', typeId: string, semId: string, duration: number, company?: string, companyDomain?: string, subline?: string }} AddWorkTermAction
 */

/**
 * Remove a Work Experience term by its instance id.
 * instanceId matches the key in PlanContext.workExperience.
 * @typedef {{ type: 'REMOVE_WORK_TERM', instanceId: string }} RemoveWorkTermAction
 */

/**
 * Move a Work Experience term to a different starting semester.
 * The adapter re-validates placement rules at the new location.
 * @typedef {{ type: 'MOVE_WORK_TERM', instanceId: string, toSemId: string }} MoveWorkTermAction
 */

/**
 * Update metadata on a Work Experience term (company, role) without moving it.
 * @typedef {{ type: 'UPDATE_WORK_TERM', instanceId: string, company?: string, companyDomain?: string, subline?: string }} UpdateWorkTermAction
 */

/**
 * Set the active major.  Pass an empty string to clear.
 * programId must match a ProgramOption.id from IMajorRequirements.getMajorOptions().
 * @typedef {{ type: 'SET_MAJOR', programId: string }} SetMajorAction
 */

/**
 * Set the concentration label.  Pass an empty string to clear.
 * Concentration labels are freeform strings, not path ids.
 * @typedef {{ type: 'SET_CONCENTRATION', label: string }} SetConcentrationAction
 */

/**
 * Set the first minor.  Pass an empty string to clear.
 * programId must match a ProgramOption.id from IMajorRequirements.getMinorOptions().
 * @typedef {{ type: 'SET_MINOR1', programId: string }} SetMinor1Action
 */

/**
 * Set the second minor.  Pass an empty string to clear.
 * @typedef {{ type: 'SET_MINOR2', programId: string }} SetMinor2Action
 */

/**
 * Set bonus / incoming credits (AP, transfer, test-out hours not tied to a course).
 * Replaces the current bonusSH value entirely.
 * @typedef {{ type: 'SET_BONUS_SH', amount: number }} SetBonusSHAction
 */

/**
 * Override the credit hours for a variable-credit course.
 * Pass value: null to clear the override (revert to catalog default).
 * Ignored for fixed-credit courses.
 * @typedef {{ type: 'SET_SH_OVERRIDE', courseId: string, value: number|null }} SetSHOverrideAction
 */

/**
 * Set the offering override for a course in a specific semester type.
 * status: true = force offered, false = force not offered, null = auto (clear override).
 * @typedef {{ type: 'SET_OFFERED_OVERRIDE', courseId: string, semTypeId: string, status: boolean|null }} SetOfferedOverrideAction
 */

/**
 * Set the entry semester and year for the plan's cohort grid.
 * May trigger sticky-course remapping if stickyCourses is enabled.
 * @typedef {{ type: 'SET_ENTRY', sem: string, year: number }} SetEntryAction
 */

/**
 * Set the graduation semester and year.
 * @typedef {{ type: 'SET_GRADUATION', sem: string, year: number }} SetGraduationAction
 */

/**
 * Set which semester is the user's current semester (the "in progress" marker).
 * semId must be a valid id in the plan's SEMESTERS list.
 * @typedef {{ type: 'SET_CURRENT_SEM', semId: string }} SetCurrentSemAction
 */

/**
 * Create a new empty plan.
 * After creation, the new plan becomes active.
 * @typedef {{ type: 'CREATE_PLAN', name: string }} CreatePlanAction
 */

/**
 * Rename an existing plan.
 * @typedef {{ type: 'RENAME_PLAN', planId: string, name: string }} RenamePlanAction
 */

/**
 * Switch the active plan to a different one.
 * The current plan is auto-saved before switching.
 * @typedef {{ type: 'SWITCH_PLAN', planId: string }} SwitchPlanAction
 */

/**
 * Delete a plan.  Cannot delete the last remaining plan.
 * This action REQUIRES the confirm flag to be set on the Changeset
 * (confirmDestructive: true) — the adapter rejects it otherwise.
 * If the deleted plan was active, switches to the first remaining plan.
 * @typedef {{ type: 'DELETE_PLAN', planId: string }} DeletePlanAction
 */

/**
 * Union of all plan-mutating action types.
 *
 * @typedef {AddCourseAction|RemoveCourseAction|MoveCourseAction|
 *           AddPlacedOutAction|RemovePlacedOutAction|
 *           AddSubstitutionAction|RemoveSubstitutionAction|
 *           AddWorkTermAction|RemoveWorkTermAction|MoveWorkTermAction|UpdateWorkTermAction|
 *           SetMajorAction|SetConcentrationAction|SetMinor1Action|SetMinor2Action|
 *           SetBonusSHAction|SetSHOverrideAction|SetOfferedOverrideAction|
 *           SetEntryAction|SetGraduationAction|SetCurrentSemAction|
 *           CreatePlanAction|RenamePlanAction|SwitchPlanAction|DeletePlanAction} Action
 */

// ─── UI commands (no plan mutation, no undo) ─────────────────────

/**
 * Select (highlight) a course, exactly as if the user clicked it.
 * Triggers prereq/coreq line drawing and opens the info panel.
 * Pass courseId: null to deselect.
 * @typedef {{ type: 'FOCUS_COURSE', courseId: string|null }} FocusCourseCommand
 */

/**
 * Open the course bank search with a pre-filled query.
 * Switches to the "all" tab and focuses the search input.
 * @typedef {{ type: 'OPEN_SEARCH', query: string }} OpenSearchCommand
 */

/**
 * Switch the course bank to a specific tab.
 * Valid tabs: "all", "placed", "starred".
 * @typedef {{ type: 'SET_BANK_TAB', tab: string }} SetBankTabCommand
 */

/**
 * Union of all UI command types (no plan mutation).
 * @typedef {FocusCourseCommand|OpenSearchCommand|SetBankTabCommand} UICommand
 */

// ─── Changeset ───────────────────────────────────────────────────

/**
 * A named, ordered batch of plan mutations.
 * All actions in a changeset are validated and applied atomically
 * (either all succeed or the whole batch is rejected on error).
 *
 * @typedef {Object} Changeset
 * @property {Action[]}  actions            - Ordered list of actions to apply.
 * @property {string}    [rationale]        - Why this set of changes is being proposed.
 *                                            Shown to the user in the proposal review UI.
 *                                            Should be plain English, 1–3 sentences.
 * @property {string}    [label]            - Short label for the batch, e.g. "Restructure Fall 2025".
 *                                            Shown as the proposal headline in the UI.
 * @property {boolean}   [confirmDestructive] - Must be explicitly true to include DELETE_PLAN actions.
 *                                            Protects against accidental plan deletion in Claude's output.
 */

// ─── Results ─────────────────────────────────────────────────────

/**
 * Result of propose() — the changeset has been queued for the user to review.
 *
 * @typedef {Object} ProposeResult
 * @property {'queued'|'rejected'} status
 * @property {string}   [proposalId]    - Stable id assigned to this pending proposal.
 *                                        Use to reference it in future calls.
 * @property {string}   [reason]        - Why the changeset was rejected outright
 *                                        (e.g. missing confirmDestructive flag).
 *                                        Distinct from per-action violations, which the user
 *                                        sees in the review UI.
 */

/**
 * Result of apply() — the changeset has been applied (or failed).
 *
 * @typedef {Object} ApplyResult
 * @property {'applied'|'partial'|'rejected'} status
 * @property {number}   appliedCount    - Number of actions that succeeded.
 * @property {number}   totalCount      - Total actions in the changeset.
 * @property {import('./IPlannerQuery.js').ViolationInfo[]} violations
 *   Violations present in the resulting plan after the applied actions.
 *   Non-empty does not necessarily mean the apply failed — a move may be
 *   valid even if it introduces a prereq warning the user will resolve later.
 * @property {string}   [reason]        - Explanation if status is 'rejected'.
 */

// ─── Port interface ──────────────────────────────────────────────

/**
 * @typedef {Object} IPlannerAction
 *
 * @property {(changeset: Changeset) => ProposeResult} propose
 *   Queue a changeset for the user to review in the UI.
 *   The user sees the rationale, each action listed individually,
 *   and can approve or reject each item before anything changes.
 *   Returns immediately — does not wait for the user to decide.
 *   Use this for substantive restructuring: adding a semester of courses,
 *   switching major + updating requirements, building an alternative plan.
 *
 * @property {(changeset: Changeset) => ApplyResult} apply
 *   Apply a changeset immediately, exactly as the user would by hand.
 *   The entire batch is pushed as one undo entry (Ctrl+Z reverses all of it).
 *   Returns after all actions have been applied.
 *   Use this for unambiguous single-step actions the user clearly intended
 *   (e.g. the user said "move CS3500 to spring").
 *
 * @property {(uiAction: UICommand) => void} command
 *   Fire an immediate UI-only action.  No plan data changes, no undo entry.
 *   Use this to orient the user's attention: select a course Claude is
 *   discussing, pre-fill the search with a subject, or show the bank.
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External systems this adapter writes to.  See IAttributable.
 */

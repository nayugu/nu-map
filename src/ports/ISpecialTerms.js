// ═══════════════════════════════════════════════════════════════════
// PORT: ISpecialTerms
// Non-course semester blocks — co-op, internship, exchange, research,
// thesis, study abroad, leave of absence, etc.
//
// These are blocks that occupy semester slots in the planner grid but
// are not academic courses.  They may displace coursework, earn credits,
// and/or automatically satisfy curriculum attributes.
//
// Grid spanning uses the same `weight` scale as ICalendar.SemesterType:
//   weight 1.0  = occupies one full-semester slot
//   weight 2.0  = spans two consecutive full-semester slots
//   weight 0.5  = fits inside a half-semester (e.g. sumA / sumB)
//
// A special term "spans" into the next slot when its weight exceeds the
// weight of the current slot.  This is purely arithmetic — no hardcoded
// duration tables needed.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ISpecialTerms = "specialTerms";

/**
 * One available duration configuration for a special term type.
 * Duration is expressed in two ways:
 *   - `durationMonths` : human-readable length (calendar months), for display labels
 *   - `weight`         : grid units, for spanning logic — this drives the actual behavior
 *
 * @typedef {Object} SpecialTermDuration
 * @property {string} id             - Stable machine-readable ID stored in plan state,
 *                                     e.g. "4mo", "6mo", "1qtr".  Must be unique within
 *                                     a SpecialTermType's durations array.
 * @property {string} label    - Display label for the duration picker,
 *                              e.g. "4-month", "6-month", "1 quarter".
 * @property {number} duration - Length in calendar months.  Used for display labels and
 *                               is the value stored in plan state to identify which
 *                               duration the user selected.  Does NOT drive grid behavior —
 *                               weight does.  Unit is always calendar months.
 * @property {number} weight   - How many grid-weight units this duration occupies.
 *                                     Must be a multiple of the smallest SemesterType weight
 *                                     in the calendar so that spanning arithmetic is exact.
 *                                     Examples: 4-month co-op → 1.0, 6-month co-op → 2.0,
 *                                     2-month internship → 0.5.
 */

/**
 * One type of non-course special block available at this institution.
 *
 * @typedef {Object} SpecialTermType
 * @property {string}                id              - Machine-readable ID stored in plan state,
 *                                                    e.g. "coop", "intern", "exchange", "research".
 * @property {string}                label           - Display name shown in UI and exports,
 *                                                    e.g. "Co-op", "Full-Time Internship",
 *                                                    "Exchange Semester", "Undergraduate Research".
 * @property {string}                color           - CSS hex color for the term chip in the grid,
 *                                                    e.g. "#f87171".
 * @property {SpecialTermDuration[]} durations       - All valid duration options for this type,
 *                                                    ordered shortest to longest.  The planner
 *                                                    shows these as a duration picker when placing.
 * @property {string[]}              attributeGrants - Attribute codes (from IAttributeSystem)
 *                                                    automatically satisfied when any duration of
 *                                                    this type is placed.  Empty array if none.
 *                                                    e.g. NU co-op grants ["EX"] (Integration Experience).
 * @property {boolean}               occupiesSlot    - Whether placing this term prevents regular
 *                                                    courses from being added to the same semester.
 *                                                    true  → full-time block (co-op, exchange)
 *                                                    false → part-time / parallel activity
 *                                                    Used by SemRow to conditionally render course slots.
 * @property {number}                creditValue     - Academic credits awarded for placing this term,
 *                                                    added to the semester and plan credit totals.
 *                                                    0 for unpaid co-ops and non-credit internships.
 *                                                    Use a positive value for thesis, research, or
 *                                                    programs that grant academic credit.
 */

/**
 * Drop validation context — runtime planner state passed to validateDrop.
 *
 * @typedef {Object} DropContext
 * @property {Object[]}                SEMESTERS  - Generated semester list from semGrid.
 * @property {Object.<string,string>}  SEM_PREV   - Maps each semId to the previous semId.
 * @property {Object.<string,string>}  SEM_NEXT   - Maps each semId to the next semId.
 * @property {(semId: string) => boolean} isOccupied - Returns true if the slot is already occupied
 *                                                    by another special term (excluding the term
 *                                                    being dragged, if any — caller's responsibility).
 */

/**
 * @typedef {Object} ISpecialTerms
 *
 * @property {() => SpecialTermType[]} getTypes
 *   All special term types available at this institution.
 *   Returns empty array for institutions with no co-op/internship program.
 *
 * @property {(typeId: string, duration: number, semId: string, ctx: DropContext) => {valid: boolean, startId: string}|null} validateDrop
 *   Determine whether a special term of the given type and duration can be placed
 *   starting at (or snapping to) the given semester slot.
 *
 *   Returns {valid: true, startId} on success — startId is the canonical start semester
 *   (may differ from semId for snap-to-start behavior, e.g. a sumB drop snaps to sumA).
 *   Returns {valid: false} if the placement is not allowed.
 *
 *   The adapter implements all institution-specific rules here:
 *   which semester types allow which term types, span requirements, etc.
 *   For institutions with no special terms, return {valid: false} always.
 */

// ═══════════════════════════════════════════════════════════════════
// PORT: ICalendar
// Academic calendar configuration — semester structure and time weights.
//
// The central abstraction is `weight`: each semester type carries a
// relative duration where 1.0 = one full academic term.  Half-semester
// sessions (NU sumA / sumB) get weight 0.5.  This lets spanning logic
// in semGrid and special terms be expressed as arithmetic rather than
// institution-specific lookup tables.
//
//   span consecutive slots until Σweight ≥ specialTerm.weight
//
// This means a 6-month NU co-op (weight 2.0) automatically spans two
// fall/spring slots without any hardcoded table.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICalendar = "calendar";

/**
 * One regular (non-special) semester type.
 *
 * @typedef {Object} SemesterType
 * @property {string}   id          - Machine-readable ID, e.g. "fall", "spring", "sumA"
 * @property {string}   label       - Display name, e.g. "Fall", "Summer 1"
 * @property {string}   shortLabel  - Abbreviated label for tight UI spaces, e.g. "FA", "S1"
 * @property {number}   weight      - Relative duration (1.0 = full semester, 0.5 = half-term).
 *                                    Semester types within one academic year should sum to a
 *                                    whole number (NU: 1 + 1 + 0.5 + 0.5 = 3.0).
 * @property {boolean}  optional    - If true the slot may be collapsed in a condensed plan view
 *                                    (summer sessions the student didn't enrol in)
 * @property {string}   theme       - CSS theme key for row background.  Must match a key in
 *                                    TYPE_BG: "fall" | "spring" | "summer" | "special"
 * @property {string[]} months      - Calendar months covered, as zero-padded ISO strings
 *                                    ("01"–"12").  Informational — used for display only.
 */

/**
 * @typedef {Object} ICalendar
 * @property {number}            defaultStartYear    - Default first year shown when no saved plan
 *                                                     exists
 * @property {SemesterType[]}    semesterTypes       - Ordered definitions for all regular term
 *                                                     types.  Order determines display order
 *                                                     within each academic year.
 * @property {string}            yearAnchor          - Lowercase month name that begins the
 *                                                     academic year, e.g. "august", "september".
 *                                                     Used to align year labels with the calendar.
 * @property {"single"|"split"}  academicYearFormat  - How year labels render in the planner:
 *                                                     "single" → "2026"
 *                                                     "split"  → "2025–2026"
 *
 * Stage 1 compat exports (present in the northeastern adapter; removed in Stage 2):
 *   DEFAULT_START_YEAR : number    — same value as defaultStartYear
 *   SEMESTER_TYPES     : string[]  — flat ID array, i.e. semesterTypes.map(t => t.id)
 */

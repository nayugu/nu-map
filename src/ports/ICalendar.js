// ═══════════════════════════════════════════════════════════════════
// PORT: ICalendar
// Academic calendar configuration — semester structure and time weights.
//
// The central abstraction is `weight`: each semester type carries a
// relative duration where 1.0 = one full academic term.  Half-semester
// sessions get weight 0.5; quarter systems use ~0.33.  This lets
// spanning logic and credit thresholds be expressed as arithmetic
// rather than institution-specific lookup tables.
//
//   A special term "spans" into the next slot when:
//     specialTerm.weight > currentSlot.weight
//   It continues spanning until Σ(consumed slot weights) ≥ specialTerm.weight.
//
// For a quarter-system institution:
//   getSemesterTypes() would return four entries (fall, winter, spring, summer)
//   each with weight ~0.33, and an annual total of ~1.33.
//   A full-year research block would have weight 1.0 and span ~3 quarters.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICalendar = "calendar";

/**
 * One regular (non-special) semester or term type.
 *
 * @typedef {Object} SemesterType
 * @property {string}   id          - Machine-readable type ID used as `sem.type` on generated
 *                                    semester objects, e.g. "fall", "spring", "q1", "summer".
 *                                    Also the default prefix when building semester IDs (see idPrefix).
 * @property {string}   [idPrefix]  - Prefix used when generating semester IDs: `${idPrefix}${year}`.
 *                                    Defaults to `id` when omitted.  Override this when legacy saved
 *                                    plans used a different prefix (e.g. id="spring", idPrefix="spr"
 *                                    so existing "spr2027" IDs remain valid after a rename).
 *                                    To resolve a semId back to its type: find the SemesterType
 *                                    whose (idPrefix ?? id) is a prefix of the semId string.
 * @property {string}   label       - Full display name, e.g. "Fall", "Winter Quarter", "Summer"
 * @property {string}   shortLabel  - Abbreviated label for tight spaces, e.g. "FA", "Q1", "SU"
 * @property {string}   [sub]       - Date-range subtitle under the semester heading, e.g. "Sep – Dec".
 *                                    If omitted, derived from months[].
 * @property {number}   weight      - Relative duration on a scale where 1.0 = one full academic
 *                                    term.  Used for special-term spanning logic and to determine
 *                                    whether a partial-term session fits inside a slot.
 *                                    Semester types within one academic year should sum to a
 *                                    whole number for clean span arithmetic.
 * @property {boolean}  optional    - If true, this slot can be hidden in a condensed view when
 *                                    the student is not enrolled (e.g. unused summer sessions).
 * @property {string}   theme       - Row background theme key.  Must match a key in the
 *                                    TYPE_BG map in constants.js: "fall" | "spring" | "summer"
 *                                    | "special".  Controls row color in the planner grid.
 * @property {string[]} months      - Calendar months this term covers, as zero-padded strings
 *                                    ("01"–"12").  Informational — used for the subtitle fallback
 *                                    and for display tooltips.
 */

/**
 * @typedef {Object} ICalendar
 *
 * @property {() => SemesterType[]} getSemesterTypes
 *   Ordered definitions for all regular term types.  Order within the array determines
 *   display order within each academic year in the planner grid.
 *
 * @property {() => number} getDefaultStartYear
 *   First year shown when no saved plan exists.  Typically the current or next academic year.
 *
 * @property {() => string} getYearAnchor
 *   Lowercase name of the month that begins the academic year, e.g. "september", "august".
 *   Used when generating academic-year range labels and for aligning year boundaries in
 *   multi-year display modes.
 *
 * @property {() => "single"|"split"} getAcademicYearFormat
 *   Controls how year labels render in the planner:
 *     "single" → "2026"        (calendar-year schools, e.g. most quarter systems)
 *     "split"  → "2025–2026"   (cross-calendar academic years, e.g. NU fall–spring)
 *
 * @property {(code: string) => string|null} decodeTermCode
 *   Decode a raw term code from the course catalog into a SemesterType id.
 *   Returns the matching id (e.g. "spring", "sumA") or null if unrecognized.
 *   This mapping is institution-specific: NU uses a two-digit suffix (10 = fall,
 *   30 = spring, 40 = sumA, 60 = sumB); other registrars use different conventions.
 *   Consumed by courseModel.getOfferedFromTerms and InfoPanel's offering grid.
 *   Example: decodeTermCode("202430") → "spring"
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External data sources this adapter draws from.  See IAttributable.
 */

// ═══════════════════════════════════════════════════════════════════
// PORT: ISpecialTerms
// Non-course semester blocks — co-op, internship, exchange, leave, etc.
//
// Duration is expressed as `weight` on the same scale as
// ICalendar.SemesterType.weight: 1.0 = one full semester slot.
// Spanning logic: consume consecutive semester slots in the grid until
// cumulative slot weight reaches the duration's weight.
//
// Examples (NU):
//   4-month co-op → weight 1.0  (spans one fall or spring slot)
//   6-month co-op → weight 2.0  (spans two consecutive full-semester slots)
//   2-month internship → weight 0.5  (fits inside sumA or sumB)
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ISpecialTerms = "specialTerms";

/**
 * One available duration option for a special term type.
 *
 * @typedef {Object} SpecialTermDuration
 * @property {string} id       - Machine-readable ID, e.g. "4mo", "6mo"
 * @property {string} label    - Display label, e.g. "4-month", "6-month"
 * @property {number} duration - Length in calendar months, e.g. 4 or 6.
 *                               Stored in plan state and used for display labels
 *                               and drag-and-drop identity.
 * @property {number} weight   - Grid weight on the ICalendar scale.
 *                               1.0 = occupies one full-semester slot.
 *                               2.0 = spans two consecutive full-semester slots.
 *                               Used for span logic when placing terms in the grid.
 */

/**
 * @typedef {Object} SpecialTermType
 * @property {string}                id              - Machine-readable ID, e.g. "coop"
 * @property {string}                label           - Display name, e.g. "Co-op"
 * @property {string}                color           - CSS hex color for the term chip
 * @property {SpecialTermDuration[]} durations       - Available duration options for this type
 * @property {string[]}              attributeGrants - Attribute codes automatically satisfied
 *                                                    when this term is placed, e.g. ["EX"]
 * @property {boolean}               occupiesSlot    - True if this term displaces regular
 *                                                    coursework (false for part-time work, etc.)
 * @property {number}                creditValue     - Credits awarded; 0 for unpaid co-ops
 *
 * @typedef {Object} ISpecialTerms
 * @property {SpecialTermType[]} types - All special term types available at this institution
 */

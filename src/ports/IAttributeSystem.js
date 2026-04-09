// ═══════════════════════════════════════════════════════════════════
// PORT: IAttributeSystem
// Course attribute (gen-ed / learning outcome) definitions and coverage.
//
// "Attributes" is the generic name for what NU calls NUpath, what other
// schools call gen-ed, distribution requirements, or learning outcomes.
// The attribute system is intentionally separate from the requirement
// tree (gradRequirements.js) because attributes appear in multiple
// contexts: course chips, the grid panel, PDF exports, and requirement
// validation.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IAttributeSystem = "attributeSystem";

/**
 * One attribute definition.
 *
 * @typedef {Object} Attribute
 * @property {string}  code         - Short code used internally and in course data, e.g. "ND"
 * @property {string}  label        - Display label, e.g. "Natural/Designed World"
 * @property {string}  [description] - Longer description for tooltips or info panels (optional)
 */

/**
 * @typedef {Object} IAttributeSystem
 * @property {string}                   systemName  - Display name for this attribute system,
 *                                                   e.g. "NUPath", "Gen Ed", "GIRs".
 *                                                   Used as the section title in the grad panel.
 *                                                   Empty string if the institution has no
 *                                                   attribute system.
 * @property {Attribute[]}              attributes  - Full list of attribute definitions.
 *                                                   May include legacy codes (e.g. NU's "WF")
 *                                                   that appear in course data and labels but
 *                                                   are excluded from the display grid.
 * @property {string[][]}               gridLayout  - 2-D layout for the attribute grid panel,
 *                                                   e.g. [["ND","EI","IC","FQ"], ...].
 *                                                   Excludes legacy-only codes.
 * @property {string[]}                 gridCodes   - Flat ordered list derived from gridLayout.
 *                                                   Source of truth for grid rendering and
 *                                                   the (covered / total) progress badge.
 * @property {Object.<string,string>}   labels      - Map of code → label for ALL attributes
 *                                                   including legacy codes (used for PDF export
 *                                                   and tooltip lookups).
 * @property {function(Object, Object, Set=): Set<string>} getCoverage
 *   - getCoverage(placements, courseMap, grantedAttrs?) → Set of covered attribute codes
 *   - placements    : { [courseId]: semId }  — courses placed in the plan
 *   - courseMap     : { [courseId]: Course } — full course objects with attribute arrays
 *   - grantedAttrs  : Set<string> — attribute codes already granted by placed special terms
 *                     (compute with computeGrantedAttrs from specialTermUtils)
 *
 * Future fields (Stage 2, when requirement validation is expanded):
 *   canDoubleDipWithMajor : boolean
 *     — whether a course can satisfy both an attribute requirement and a major requirement
 *       simultaneously.  Most US universities allow this; some have restrictions.
 *   maxCoursesPerAttribute : number | null
 *     — cap on how many courses can satisfy any single attribute (null = unlimited).
 *       Used when the institution limits double-counting within the attribute grid.
 */

// ═══════════════════════════════════════════════════════════════════
// PORT: IAttributeSystem
// Course attribute / gen-ed / learning-outcome definitions and coverage.
//
// "Attributes" is the generic term for what different institutions call:
//   NUPath (Northeastern), Gen Ed (many US schools), GIRs (MIT),
//   Distribution Requirements (Harvard, Princeton), CORE (Boston College),
//   Areas of Inquiry (Indiana), Writing Intensive tags, etc.
//
// Attributes appear in four places in the planner:
//   1. Course chips — small badges on each placed course card
//   2. Attribute grid — visual coverage grid in the graduation panel
//   3. Coverage badge — "(n / total) covered" summary statistic
//   4. PDF export — attribute labels in the printed plan
//
// Institutions with no attribute system should implement:
//   getSystemName() → ""   getGridCodes() → []   getGridLayout() → []
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IAttributeSystem = "attributeSystem";

/**
 * One attribute definition.
 *
 * @typedef {Object} Attribute
 * @property {string}  code         - Short machine-readable code stored in course data,
 *                                    e.g. "ND", "FQ", "WI".  This is the primary key.
 * @property {string}  label        - Display label shown in chips and the grid,
 *                                    e.g. "Natural/Designed World", "Writing Intensive".
 * @property {string}  [description] - Longer description for tooltips or info panels.
 *                                    Optional — the UI falls back to label if absent.
 */

/**
 * @typedef {Object} IAttributeSystem
 *
 * @property {() => string} getSystemName
 *   Human-readable name for the entire attribute system, e.g. "NUPath", "Gen Ed",
 *   "Distribution Requirements".  Used as the section title in the graduation panel.
 *   Returns empty string if this institution has no attribute system.
 *
 * @property {() => Attribute[]} getAttributes
 *   Complete list of attribute definitions — every code that can appear in course data
 *   must have an entry here.  This includes legacy codes that no longer appear in the
 *   official requirements grid but may still exist on older courses in the catalog
 *   (they need display labels for the PDF export and tooltip lookups).
 *
 * @property {() => string[][]} getGridLayout
 *   Two-dimensional layout for the visual attribute grid in the graduation panel.
 *   Each inner array is one row; each string is an attribute code.
 *   Only includes codes that are part of the current requirements (excludes legacy-only).
 *   A school with a list-style display can use a single-row layout: [[all, codes, here]].
 *   Returns empty array if getSystemName() is "".
 *
 * @property {() => string[]} getGridCodes
 *   Flat ordered list of all codes appearing in getGridLayout() (i.e. getGridLayout().flat()).
 *   Used as the denominator for the "(n / total) covered" progress badge and as
 *   the iteration source for grid rendering.  Must be consistent with getGridLayout().
 *
 * @property {(code: string) => string} getLabel
 *   Return the display label for an attribute code.
 *   Includes legacy codes excluded from getGridCodes().  Used for lookups in PDF export,
 *   course card chips, and any context where only the code is available.
 *   Falls back to the code itself if no label is found.
 *
 * @property {() => boolean} canDoubleDip
 *   Whether a course can simultaneously satisfy an attribute requirement AND a major
 *   or minor requirement.  Returns true at most institutions (including NU).
 *   Returns false at institutions that require attribute courses to be outside the major.
 *   The graduation auditor uses this to decide whether already-counted courses are
 *   eligible for attribute credit.
 *
 * @property {() => number|null} getMaxPerAttribute
 *   Maximum number of courses that can satisfy any single attribute (null = unlimited).
 *   Some institutions cap double-counting within the attribute grid.  null for most schools.
 *
 * @property {(placements: Object, courseMap: Object, grantedCodes?: Set<string>) => Set<string>} getCoverage
 *   Compute the set of attribute codes covered by the current plan.
 *
 *   placements   : { [courseId: string]: semId: string }  — all placed courses
 *   courseMap    : { [courseId: string]: Course }         — course records with .attributes[]
 *   grantedCodes : Set<string>, optional                  — attribute codes directly granted by
 *                  non-course activities (e.g. placed special terms that carry attributeGrants).
 *                  Pass an empty Set or omit if no special terms are placed.
 *
 *   Returns a Set of attribute codes that are covered.  The UI computes
 *   coverage = returned Set ∩ getGridCodes()  to exclude legacy codes from the progress badge.
 *
 * @property {() => import('./IAttributable.js').SourceInfo[]} getSources
 *   External data sources this adapter draws from.  See IAttributable.
 */

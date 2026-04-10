// ═══════════════════════════════════════════════════════════════════
// PORT: ICreditSystem
// How academic credit is named, counted, and bounded at this institution.
//
// "Credit" means different things at different institutions:
//   NU / most US schools   → Semester Hours (SH), typically 4 per course
//   Many US schools        → Credit Hours, typically 3 per course
//   European institutions  → ECTS credits, typically 5–7.5 per course
//   UC system              → Semester/Quarter Units
//
// The planner uses this port to display labels, apply default credit
// values, and generate enrollment-load warnings.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICreditSystem = "creditSystem";

/**
 * @typedef {Object} ICreditSystem
 *
 * Labeling
 * @property {() => string} getUnitName  - Short label used throughout the UI, e.g. "SH", "ECTS",
 *                                         "units", "credits".  Used in badges, export text, and
 *                                         anywhere a brief credit display is needed.
 * @property {() => string} getUnitLabel - Long label for headers and descriptions,
 *                                         e.g. "Semester Hours", "Credit Hours", "ECTS Credits".
 *
 * Defaults
 * @property {() => number} getStandardValue - Typical credit value for a single standard course.
 *                                         Used when a course record is missing its credit count
 *                                         and as the default in the "add course" UI.
 *                                         e.g. 4 (NU), 3 (many US schools), 6 (ECTS).
 *
 * Enrollment thresholds — used for load warnings and status badges
 * @property {() => number} getFullTimeMin - Minimum credits for full-time enrollment status per term.
 *                                         e.g. 12 SH.  Plans falling below this in any non-coop term
 *                                         receive a "part-time" indicator.
 * @property {() => number} getSemesterMax - Maximum credits registrar allows per term before an
 *                                         overload petition is required.  e.g. 22 SH.
 *                                         Plans exceeding this receive an overload warning.
 */

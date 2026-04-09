// ═══════════════════════════════════════════════════════════════════
// PORT: ICreditSystem
// Credit unit naming and enrollment load thresholds.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICreditSystem = "creditSystem";

/**
 * @typedef {Object} ICreditSystem
 * @property {string} unitName      - Short label shown in UI, e.g. "SH", "ECTS", "units"
 * @property {string} unitLabel     - Long label, e.g. "Semester Hours"
 * @property {number} standardValue - Typical credits for a single course, e.g. 4
 * @property {number} fullTimeMin   - Minimum credits for full-time enrollment status, e.g. 12
 * @property {number} partTimeMax   - Maximum credits still considered part-time; typically
 *                                    fullTimeMin − 1.  Used for enrollment status badges.
 * @property {number} semesterMax   - Hard maximum credits allowed per semester, e.g. 22
 *
 * Future fields (Stage 2):
 *   convertFrom(otherSystem: ICreditSystem, value: number): number
 *     — convert a credit value from another system (e.g. ECTS→SH) to this one
 */

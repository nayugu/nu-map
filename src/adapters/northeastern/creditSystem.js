// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/creditSystem  (implements ICreditSystem)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ICreditSystem.js').ICreditSystem} */
export default {
  unitName:      "SH",
  unitLabel:     "Semester Hours",
  standardValue: 4,
  fullTimeMin:   12,
  partTimeMax:   11,
  semesterMax:   22,
};

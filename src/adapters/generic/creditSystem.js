// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/creditSystem  (implements ICreditSystem)
//
// Default: 3-credit courses, US semester model.
// Covers most US universities and many international programs.
//
// Override when your institution uses:
//   - Semester Hours (4 SH standard, like Northeastern)
//   - ECTS (6 units typical, 60/year)
//   - Quarter units or other non-3-credit systems
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ICreditSystem.js').ICreditSystem} */
export default {
  unitName:      "credits",
  unitLabel:     "Credits",
  standardValue: 3,
  fullTimeMin:   12,
  partTimeMax:   11,
  semesterMax:   21,
};

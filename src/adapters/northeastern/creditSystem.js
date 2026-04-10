// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/creditSystem  (implements ICreditSystem)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ICreditSystem.js').ICreditSystem} */
export default {
  getUnitName()      { return "SH"; },
  getUnitLabel()     { return "Semester Hours"; },
  getStandardValue() { return 4; },
  getFullTimeMin()   { return 12; },
  getSemesterMax()   { return 22; },
};

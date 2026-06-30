// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/creditSystem  (implements ICreditSystem)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ICreditSystem.js').ICreditSystem} */
export default {
  getUnitName()      { return "SH"; },
  getUnitLabel()     { return "Semester Hours"; },
  getStandardValue() { return 4; },
  getFullTimeMin(studentType) { return studentType === "graduate" ?  8 : 12; },
  getSemesterMax(studentType) { return studentType === "graduate" ? 16 : 19; },
  getSources()       { return []; },
};

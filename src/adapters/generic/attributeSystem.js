// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/attributeSystem  (implements IAttributeSystem)
//
// Default: no attribute system.
// The grad panel attribute grid is hidden when getGridCodes() is empty.
//
// Override to add your institution's gen-ed / distribution /
// learning-outcome requirements (NUPath, Gen Ed, GIRs, etc.)
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/IAttributeSystem.js').IAttributeSystem} */
export default {
  getSystemName()         { return ""; },
  getAttributes()         { return []; },
  getGridLayout()         { return []; },
  getGridCodes()          { return []; },
  getLabel(code)          { return code; },
  canDoubleDip()          { return true; },
  getMaxPerAttribute()    { return null; },
  /** @returns {Set<string>} always empty — no attributes to cover */
  getCoverage()           { return new Set(); },
};

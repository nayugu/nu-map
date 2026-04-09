// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/attributeSystem  (implements IAttributeSystem)
//
// Default: no attribute system.
// The grad panel attribute grid is hidden when gridCodes is empty.
//
// Override to add your institution's gen-ed / distribution /
// learning-outcome requirements (NUPath, Gen Ed, GIRs, etc.)
// ═══════════════════════════════════════════════════════════════════

export const systemName  = "";
export const attributes  = [];
export const gridLayout  = [];
export const gridCodes   = [];
export const labels      = {};

/** @returns {Set<string>} always empty — no attributes to cover */
export function getCoverage() { return new Set(); }

/** @type {import('../../ports/IAttributeSystem.js').IAttributeSystem} */
export default { systemName, attributes, gridLayout, gridCodes, labels, getCoverage };

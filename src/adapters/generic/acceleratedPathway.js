// ═══════════════════════════════════════════════════════════════════
// ADAPTER (generic): acceleratedPathway
//
// The baseline: no accelerated pathways exist.
//
// Most institutions do not run a credit-sharing BS/MS scheme, and one that does
// will name it something other than "PlusOne". Returning empty here means every
// consumer can call the port unconditionally — no null checks, no feature flags —
// and the UI simply renders nothing. A fork gets working software without
// implementing this port at all.
//
// See src/ports/IAcceleratedPathway.js for the contract.
// ═══════════════════════════════════════════════════════════════════

const NONE = Object.freeze([]);

export default {
  /** @returns {import("../../ports/IAcceleratedPathway.js").Pathway[]} */
  listPathways() {
    return NONE;
  },

  /** @returns {null} */
  getPathway() {
    return null;
  },
};

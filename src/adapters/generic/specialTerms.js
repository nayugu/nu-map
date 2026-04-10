// ═══════════════════════════════════════════════════════════════════
// ADAPTER: generic/specialTerms  (implements ISpecialTerms)
//
// Default: no special terms.
// Most universities don't have structured co-op or exchange programs
// that occupy entire semester slots in the planner.
//
// Override to add co-op, internship, exchange, leave, or any other
// non-course semester block your institution offers.
// ═══════════════════════════════════════════════════════════════════

/** @type {import('../../ports/ISpecialTerms.js').ISpecialTerms} */
export default {
  getTypes() { return []; },
  validateDrop(_typeId, _duration, _semId, _ctx) { return { valid: false }; },
};

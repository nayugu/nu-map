// ═══════════════════════════════════════════════════════════════════
// SPECIAL TERM UTILITIES  (pure helpers — no React, no I/O)
//
// Institution-agnostic helpers for working with ISpecialTerms data.
// Centralises the resolveTermByDuration lookup that previously was
// copied 8+ times across SemRow, SummerRow, planModel, BankPanel.
// ═══════════════════════════════════════════════════════════════════

/**
 * Find the duration descriptor whose `duration` matches the stored value.
 * Falls back to the first entry so callers always get a valid object.
 *
 * @param {Object[]} durations  - `specialTerms.types[n].durations` array
 * @param {number}   duration   - stored duration value (e.g. 4 or 6 for NU)
 * @returns {Object}
 */
export function resolveTermByDuration(durations, duration) {
  return durations.find(d => d.duration === duration) ?? durations[0];
}

/**
 * Compute the Set of attribute codes granted by all placed special terms.
 *
 * Iterates every entry in specialTermPl, looks up its type's `attributeGrants`,
 * and unions them together.  Only entries with a valid semId (actually placed)
 * contribute grants.
 *
 * This is the institution-agnostic counterpart to the old `workPl`-specific EX
 * check that was hard-coded in northeastern/attributeSystem.getCoverage.
 *
 * @param {Object}   specialTermPl - { [id]: { typeId, semId, ... } }
 * @param {Object[]} types         - specialTerms.types array from ISpecialTerms adapter
 * @returns {Set<string>}
 */
export function computeGrantedAttrs(specialTermPl, types) {
  const granted   = new Set();
  const typeById  = Object.fromEntries((types ?? []).map(t => [t.id, t]));
  for (const data of Object.values(specialTermPl)) {
    if (!data?.semId) continue;
    const type = typeById[data.typeId];
    if (type?.attributeGrants) type.attributeGrants.forEach(a => granted.add(a));
  }
  return granted;
}

/**
 * Returns true when a special term placed in a semester of the given
 * weight would spill into the following semester.
 *
 * Rule: termWeight > semSlotWeight → spans.
 *   6-month coop (weight 2.0) > fall/spring (weight 1.0) → always spans
 *   4-month coop (weight 1.0) > summer slot (weight 0.5) → spans on summer
 *   2-month intern (weight 0.5) > summer slot (weight 0.5) → false
 *
 * @param {number} termWeight    - from the resolved duration descriptor
 * @param {number} semSlotWeight - from calendar.semesterTypes[].weight
 * @returns {boolean}
 */
export function termSpans(termWeight, semSlotWeight) {
  return termWeight > semSlotWeight;
}

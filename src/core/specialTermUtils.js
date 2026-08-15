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
 * @param {Object}   [semIndex]    - SEM_INDEX (semId → ordinal). When given, only
 *                                   terms INSIDE the plan's timeline grant — a
 *                                   co-op parked outside the cohort range must
 *                                   not grant EX (it stays in state, uncounted).
 * @returns {Set<string>}
 */
export function computeGrantedAttrs(specialTermPl, types, semIndex) {
  const granted   = new Set();
  const typeById  = Object.fromEntries((types ?? []).map(t => [t.id, t]));
  for (const data of Object.values(specialTermPl)) {
    if (!data?.semId) continue;
    if (semIndex && semIndex[data.semId] === undefined) continue;
    const type = typeById[data.typeId];
    if (type?.attributeGrants) type.attributeGrants.forEach(a => granted.add(a));
  }
  return granted;
}

/**
 * Compute the Set of COURSE KEYS granted by all placed special terms.
 *
 * The sibling of computeGrantedAttrs, and it exists for the same reason: a
 * work term is not only an attribute, it can be a registration. At NU a co-op
 * block is a real enrolment in COOP 3945, and programs name that course as a
 * requirement — so without this, a plan with two co-ops on the board reported
 * its experiential requirement unmet.
 *
 * The result belongs in `placedSet` ONLY, never `realPlacedSet`: these keys
 * satisfy requirements but are not courses the student dragged onto the grid,
 * so they must not surface as General Electives. That is the same split the
 * virtual substitution targets already use.
 *
 * Same timeline rule as computeGrantedAttrs — a co-op parked outside the
 * cohort range grants nothing.
 *
 * @param {Object}   specialTermPl - { [id]: { typeId, semId, ... } }
 * @param {Object[]} types         - specialTerms.types array from ISpecialTerms
 * @param {Object}   [semIndex]    - SEM_INDEX (semId → ordinal)
 * @returns {Set<string>}
 */
export function computeGrantedCourses(specialTermPl, types, semIndex) {
  const granted  = new Set();
  const typeById = Object.fromEntries((types ?? []).map(t => [t.id, t]));
  for (const data of Object.values(specialTermPl ?? {})) {
    if (!data?.semId) continue;
    if (semIndex && semIndex[data.semId] === undefined) continue;
    const type = typeById[data.typeId];
    if (type?.courseGrants) type.courseGrants.forEach(k => granted.add(k));
  }
  return granted;
}

/**
 * The course keys a plan's work terms grant, split into PLANNED and COMPLETED.
 *
 * ── Why this exists ────────────────────────────────────────────────
 *
 * Three places needed both halves of this and each wrote its own: the printed
 * report (`planModel.derivePlanSets`), the live audit (`GradPanel`) and the MCP
 * query adapter. They agreed only by inspection — and `derivePlanSets` is
 * itself the function whose docstring says it exists so that "two derivations
 * disagree" cannot happen, while two of the three never called it.
 *
 * That was survivable while a grant was one hardcoded string. It stops being
 * survivable the moment the grant depends on the student's PROGRAM, which is
 * what resolving `ENCP 6964` for an engineer and `CS 6964` for a Khoury
 * student requires (see docs/coop-design.md). A rule that has to learn a new
 * input must have exactly one place to learn it.
 *
 * `isCompleted` stays a parameter for the same reason `derivePlanSets` takes
 * one: the callers genuinely disagree about which semesters count as done, and
 * that disagreement is not this function's to settle. Omit it and nothing is
 * reported as completed, which is the conservative direction.
 *
 * @param {Object}   specialTermPl - { [id]: { typeId, semId, ... } }
 * @param {Object[]} types         - specialTerms.types array from ISpecialTerms
 * @param {Object}   [semIndex]    - SEM_INDEX (semId → ordinal)
 * @param {(semId: string) => boolean} [isCompleted]
 * @returns {{ planned: Set<string>, completed: Set<string> }}
 */
export function workTermGrants(specialTermPl, types, semIndex, isCompleted) {
  const planned = computeGrantedCourses(specialTermPl, types, semIndex);
  const finished = Object.fromEntries(
    Object.entries(specialTermPl ?? {}).filter(([, d]) => d?.semId && isCompleted?.(d.semId))
  );
  return { planned, completed: computeGrantedCourses(finished, types, semIndex) };
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

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
export function workTermGrants(specialTermPl, types, semIndex, isCompleted, coopOptions) {
  const planned = resolveGrants(specialTermPl, types, semIndex, coopOptions);
  const finished = Object.fromEntries(
    Object.entries(specialTermPl ?? {}).filter(([, d]) => d?.semId && isCompleted?.(d.semId))
  );
  const completed = resolveGrants(finished, types, semIndex, coopOptions);
  return {
    planned:   new Set(planned.keys()),
    completed: new Set(completed.keys()),
    // key → the work-term instance that registered it. Without this the
    // requirement row shows a checked course that exists nowhere the student
    // can look — and since work-experience courses left the bank, nowhere at
    // all. Provenance is what keeps the audit legible.
    source:    planned,
  };
}

/** No flags set: a full-time, domestic work term. The default a block carries. */
const BASE_VARIANT = { abroad: false, halfTime: false };

/**
 * The work-term course options a set of programs names, with their variants.
 *
 * This is what lets a block resolve to the right course WITHOUT anyone naming
 * one. Graduate co-op registers under the program's own subject — `ENCP 6964`
 * for engineering, `CS 6964` for Khoury, `PPUA 6964` for policy — and only 10
 * of the 86 work-experience courses are in subject `COOP`, so no fixed key and
 * no subject-based lookup can work. But each requirement node already lists
 * exactly the courses its own program accepts, so the program answers the
 * subject question for us and the student is never asked.
 *
 * `courseMap[key].coop` is stamped by the catalog adapter from
 * `coop-courses.json`. A course without it is an ordinary class and is skipped
 * here — which is how the 26 co-op-TITLED seminars stay placeable.
 *
 * @param {Object[]} programs  - loaded major/minor requirement JSON
 * @param {Object}   courseMap - key → Course
 * @returns {{key: string, abroad: boolean, halfTime: boolean}[]} sorted, unique
 */
export function coopOptionsInPrograms(programs, courseMap) {
  const seen = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    if (node.type === "COURSE" && node.subject != null && node.classId != null) {
      const key  = `${node.subject}${node.classId}`;
      const coop = courseMap?.[key]?.coop;
      if (coop && !seen.has(key)) seen.set(key, { key, abroad: !!coop.abroad, halfTime: !!coop.halfTime });
      return;
    }
    Object.values(node).forEach(walk);
  };
  for (const p of programs ?? []) if (p) walk(p);
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Which course keys a set of placed work terms registers.
 *
 * ── Why a block emits the BASE variant when its own is taken ────────
 *
 * The requirement layer is a Set of base course keys — `buildPlacedKeySet`
 * maps every placement through `courseMap` and emits `courseKey(subject,
 * number)` — so `COOP3948#2` is not representable and repeat instances cannot
 * express "two co-ops". Two identically-flagged blocks would collapse onto one
 * key and a program wanting two experiences would see one.
 *
 * Falling back to the base variant prevents that, and it is *true* rather than
 * convenient: a second co-op abroad, with nothing abroad-specific left to
 * claim, is still a co-op. Verified against the real allocator on
 * International Business, whose two experiential sections are both non-shared:
 * one abroad co-op satisfies the international section and NOT the business
 * one; an abroad plus a domestic satisfies both; two abroad also satisfies
 * both. See docs/coop-design.md.
 *
 * Blocks resolve in timeline order so the answer does not depend on the order
 * a student happened to drag them.
 *
 * With no options — no program chosen, a program naming no work-term course,
 * or a catalog missing the `coop` stamps — this degrades to the type's static
 * `courseGrants`, which is exactly the behaviour before any of this existed.
 */
function resolveGrants(specialTermPl, types, semIndex, coopOptions) {
  /** @type {Map<string, string>} course key → the instance id that registered it */
  const granted  = new Map();
  const typeById = Object.fromEntries((types ?? []).map(t => [t.id, t]));

  const eligible = Object.entries(specialTermPl ?? {})
    .filter(([, d]) => d?.semId && !(semIndex && semIndex[d.semId] === undefined))
    .filter(([, d]) => typeById[d.typeId]?.courseGrants?.length)
    .sort(([, a], [, b]) => (semIndex?.[a.semId] ?? 0) - (semIndex?.[b.semId] ?? 0));

  if (!coopOptions?.length) {
    for (const [id, d] of eligible) {
      for (const k of typeById[d.typeId].courseGrants) if (!granted.has(k)) granted.set(k, id);
    }
    return granted;
  }

  for (const [id, d] of eligible) {
    const pick = (f) => coopOptions.find(
      o => o.abroad === f.abroad && o.halfTime === f.halfTime && !granted.has(o.key));
    // No match for this block's own variant AND none for the base variant means
    // the program's options are exhausted. Granting an unrelated key would be
    // worse than granting nothing.
    const hit = pick({ abroad: !!d.abroad, halfTime: !!d.halfTime }) ?? pick(BASE_VARIANT);
    if (hit) granted.set(hit.key, id);
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

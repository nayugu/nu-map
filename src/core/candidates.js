// ═══════════════════════════════════════════════════════════════════
// CANDIDATES  (pure — no React, no I/O)
//
// What an undecided card could be. One object, two sets, N filters.
//
//   requirements  which requirement this card stands for
//   courses       which courses could answer it
//
// Every rule in docs/sample-plan-design.md turns out to be a filter over one of
// these — the flow arithmetic and the wording evidence narrow `requirements`,
// the prereq graph and the plan's own placements narrow `courses`. They were
// written as separate mechanisms and are not; the whole point of this module is
// that a new rule is a function, not a new surface.
//
// ── Monotonicity is structural, not checked ────────────────────────
//
// A filter returns WHAT TO REMOVE. It never returns a new candidate set.
//
// That one choice is why narrowing cannot regress. §11 of the design requires
// that a live re-solve may only intersect with what was already possible — if
// filters returned replacements, every filter would have to be trusted (or
// audited) to honour that, and one that did not would silently hand a card back
// a candidate it had ruled out. Here a filter is not *able* to add: the only
// operations the framework performs are set deletion and `subtractIds`, both of
// which are proven shrinking in test/unit/candidate-spec.test.js.
//
// ── Two sets, one derived from the other ───────────────────────────
//
// `courses` is not stored. It is derived on demand:
//
//     union of what the surviving requirements admit   (or an explicit seed)
//     minus everything a filter has removed
//
// so narrowing `requirements` narrows `courses` for free and the two cannot
// drift. A cell that NAMES its options (`CS 4300 or 4100`) supplies the seed
// instead — which is the whole of §17.2: `options` is a course candidate set the
// catalog pre-seeded, so a named cell and an unnamed one are one code path
// differing only in starting width.
//
// ── "Anything counts" is not the empty set ─────────────────────────
//
// 44% of plan cells bind to `~general`, which admits every course in the
// catalog. An EligibleSpec cannot express that — an empty spec means "names
// nothing", the exact opposite — so unboundedness is tracked separately.
// Conflating the two would turn "any course is fine here" into "no course can
// go here", which is the difference between an open picker and a false warning.
// ═══════════════════════════════════════════════════════════════════

import { specIsEmpty } from "./programEligibility.js";
import { unionAll, subtractIds, materialize, cloneSpec } from "./candidateSpec.js";
import { GENERAL_ELECTIVE, CONCENTRATION } from "./requirementDemand.js";
import { resolveRequirement } from "./reservations.js";

export { GENERAL_ELECTIVE, CONCENTRATION };

/** A target that names no enumerable course set. */
export const isSentinel = (target) => typeof target !== "number";

/**
 * @typedef {Object} Candidates
 * @property {Set<number|string>} requirements
 * @property {import("./programEligibility.js").EligibleSpec|null} seed
 *   an explicit starting course set (a cell that named its options), or null to
 *   derive from `requirements`
 * @property {Map<number|string, string>} droppedRequirements  target → why
 * @property {Map<string, string>} droppedCourses              course id → why
 */

/**
 * Start from everything a card could be.
 *
 * `groups` is the catalog's own shape for a named choice: a list of GROUPS,
 * every member of a group required together. `PSYC 3200 or PT 5410 and PT 5411`
 * is `[["PSYC3200"], ["PT5410","PT5411"]]`, and flattening that to three courses
 * would offer PT 5410 on its own — which does not answer the cell. Design rule 2
 * ("never collapse a choice") exists because an earlier entry model did exactly
 * that, in 36 cells, and the doc classes it as *confidently wrong*.
 *
 * 97.4% of named cells have single-course groups only, so groups and courses
 * coincide almost everywhere. They are still modelled as groups, because the
 * cases where they differ are the ones that matter.
 *
 * The seed is DERIVED from the groups rather than accepted alongside them, so
 * the two cannot be handed in already inconsistent.
 *
 * @param {object} init
 * @param {Iterable<number|string>} [init.requirements]
 * @param {string[][]} [init.groups]  the catalog's named options
 * @param {object} [init.seed]  an explicit EligibleSpec, when there are no groups
 */
export function createCandidates({ requirements = [], seed = null, groups = null } = {}) {
  const cleanGroups = Array.isArray(groups)
    ? groups.filter(g => Array.isArray(g) && g.length).map(g => [...g])
    : null;
  return {
    requirements: new Set(requirements),
    groups: cleanGroups?.length ? cleanGroups : null,
    seed: cleanGroups?.length
      ? { keys: new Set(cleanGroups.flat()), ranges: [] }
      : (seed ? cloneSpec(seed) : null),
    droppedRequirements: new Map(),
    droppedCourses: new Map(),
  };
}

/**
 * Candidates for a reservation — the card the planner actually holds.
 *
 * Two sources, and neither is trusted blindly:
 *
 *   options       the catalog named the choice, so it becomes the groups
 *   requirement   re-checked through `resolveRequirement`, which verifies the
 *                 stored index still carries the stored title. Sections are
 *                 re-scraped monthly; an index that has drifted is dropped
 *                 rather than followed, so the card degrades to "we do not
 *                 know" instead of pointing at a different requirement.
 *
 * `targets` lets a caller that has the plan grid supply the FULL candidate list
 * for an ambiguous cell. Reservations only store a requirement when the binding
 * was forced (`applySamplePlan`), so without it an ambiguous card arrives here
 * knowing nothing — which reads as unbounded, and is the honest default.
 */
export function candidatesForReservation(reservation, { programData, targets = null } = {}) {
  const groups = Array.isArray(reservation?.options) ? reservation.options : null;
  let requirements;
  if (Array.isArray(targets)) {
    requirements = targets;
  } else {
    const resolved = resolveRequirement(reservation, programData);
    requirements = resolved ? [resolved.index] : [];
  }
  return createCandidates({ requirements, groups });
}

/**
 * The groups that can still answer this card.
 *
 * A group survives only if EVERY course in it is real and none has been ruled
 * out — losing one half of `PT 5410 and PT 5411` kills the whole option, since
 * the other half alone was never an answer.
 */
export function answerGroups(cands, { courseMap } = {}) {
  if (!cands.groups) return null;
  return cands.groups.filter(g =>
    g.every(id => (!courseMap || courseMap[id]) && !cands.droppedCourses.has(id)));
}

/**
 * Apply one filter's removals.
 *
 * Removals that name something already gone, or something that was never a
 * candidate, are ignored rather than recorded — otherwise the reason map fills
 * with entries for things no UI can ever ask about, and "why is this missing?"
 * stops having one answer.
 *
 * @param {Candidates} cands
 * @param {{requirements?: Iterable, courses?: Iterable, reason?: string}} removal
 * @returns {Candidates} a new object; the input is untouched
 */
export function narrow(cands, removal) {
  if (!removal) return cands;
  const reason = removal.reason ?? "";
  let touched = false;

  const requirements = new Set(cands.requirements);
  const droppedRequirements = new Map(cands.droppedRequirements);
  for (const t of removal.requirements ?? []) {
    if (!requirements.has(t)) continue;
    requirements.delete(t);
    droppedRequirements.set(t, reason);
    touched = true;
  }

  const droppedCourses = new Map(cands.droppedCourses);
  for (const id of removal.courses ?? []) {
    if (droppedCourses.has(id)) continue;
    droppedCourses.set(id, reason);
    touched = true;
  }

  if (!touched) return cands;
  return { ...cands, requirements, droppedRequirements, droppedCourses };
}

/**
 * Run a list of filters, in order.
 *
 * Order matters only for which REASON is recorded when two filters would remove
 * the same thing — the surviving set is the same either way, because removal
 * commutes. So filters may be listed cheapest-first without changing the answer.
 *
 * @param {Candidates} cands
 * @param {Array<(c: Candidates, ctx: object) => object|null>} filters
 */
export function applyFilters(cands, filters, ctx = {}) {
  let out = cands;
  for (const f of filters ?? []) {
    if (typeof f !== "function") continue;
    out = narrow(out, f(out, ctx));
  }
  return out;
}

// ── Reading the result ─────────────────────────────────────────────

/**
 * True when the surviving requirements include one that admits any course, so
 * the course set is not enumerable and a picker should offer search.
 */
export function isUnbounded(cands, { specOf } = {}) {
  if (cands.seed) return false;      // a named cell is bounded by its options
  // A card that never had a candidate requirement — 113 cells in the corpus
  // bind to nothing, because the requirement is missing from our data, not
  // because none exists. "We do not know" must read as "anything might", never
  // as "nothing can": the second is false confidence about the student's
  // degree, which rule 4 forbids. `isSpare` is the different case where every
  // candidate was RULED OUT.
  if (!cands.requirements.size && !cands.droppedRequirements.size) return true;
  for (const t of cands.requirements) {
    if (isSentinel(t)) return true;
    if (specIsEmpty(specOf?.(t))) return true;   // an open-ended section
  }
  return false;
}

/**
 * Every candidate requirement was ruled out — the plan already covers whatever
 * this card was for.
 *
 * Distinct from "we never knew": design §11 requires that a card whose
 * candidates all become impossible does NOT rebind to something else, and says
 * so instead. Without this distinction that card is indistinguishable from an
 * unbound one and would silently start offering the whole catalog.
 */
export function isSpare(cands) {
  return cands.requirements.size === 0 && cands.droppedRequirements.size > 0;
}

/**
 * The course candidate set, as a spec — or **null when the card is unbounded**.
 *
 * Derived, never stored: the seed (or the union of what the surviving
 * requirements admit) minus everything filtered out.
 *
 * Null rather than a spec is deliberate. A card bound to `~general` plus one
 * real section would otherwise return that section's courses, which reads as a
 * complete answer and is not — the card admits the whole catalog. Returning a
 * narrower set than `courseIds` for the same card is exactly the sort of quiet
 * disagreement between two accessors that this module exists to remove, so the
 * unrepresentable case is made unrepresentable rather than approximated.
 */
export function courseSpec(cands, { specOf, courseMap } = {}) {
  if (isUnbounded(cands, { specOf })) return null;
  // A grouped card's courses are the courses of the groups that SURVIVE. Taking
  // the flat seed minus dropped ids would leave PT 5411 on offer after PT 5410
  // was ruled out, even though their group is dead.
  if (cands.groups) {
    const live = answerGroups(cands, { courseMap });
    return { keys: new Set(live.flat()), ranges: [] };
  }
  const base = cands.seed
    ? cands.seed
    : unionAll([...cands.requirements].filter(t => !isSentinel(t)).map(t => specOf?.(t)).filter(Boolean));
  return cands.droppedCourses.size
    ? subtractIds(base, cands.droppedCourses.keys())
    : cloneSpec(base);
}

/**
 * The actual course ids. The only place expansion happens.
 *
 * For an unbounded card this is every course the catalog has, minus what was
 * filtered — which is what "any course counts, except these" means and is what
 * a search-backed picker should rank.
 */
export function courseIds(cands, { specOf, courseMap } = {}) {
  if (!courseMap) return new Set();
  if (isUnbounded(cands, { specOf })) {
    const out = new Set();
    for (const id in courseMap) if (!cands.droppedCourses.has(id)) out.add(id);
    return out;
  }
  return materialize(courseSpec(cands, { specOf, courseMap }), courseMap);
}

/**
 * The single requirement this card is for, or null while more than one survives.
 *
 * This is the whole of "forced" and "provable" — §12's two pending populations
 * differ in how they got here, not in what they mean, so the panel asks one
 * question.
 */
export function forcedRequirement(cands) {
  return cands.requirements.size === 1 ? [...cands.requirements][0] : null;
}

/** Why something is not a candidate, for the picker and for debugging. */
export function reasonFor(cands, thing) {
  return cands.droppedCourses.get(thing)
      ?? cands.droppedRequirements.get(thing)
      ?? null;
}

/**
 * Nothing can answer this card.
 *
 * Three ways to have no courses, and only one of them is this:
 *
 *   unbounded  anything counts, so the set is not enumerable   → not impossible
 *   spare      the plan already covers what this card was for  → not impossible
 *   impossible every course that could answer it is ruled out  → this
 */
export function isImpossible(cands, ctx = {}) {
  if (isUnbounded(cands, ctx)) return false;
  if (isSpare(cands)) return false;
  return courseIds(cands, ctx).size === 0;
}

// ── Filters ────────────────────────────────────────────────────────
//
// Each returns removals or null. None may construct a candidate set, which is
// what makes narrowing monotone without anyone having to check.

/**
 * A requirement the plan has already satisfied cannot be what this card is for.
 *
 * Measured at 1.2% of named-option cells (design §9.3): a section fully answered
 * by the plan's own named courses still ADMITS the option, so it still looks
 * certain, and marking it pending would claim demand that no longer exists.
 *
 * @param {Set|Map|object} outstanding  targets that still have shortfall
 */
export const withoutSatisfiedRequirements = (outstanding) => (cands) => {
  const has = outstanding instanceof Set || outstanding instanceof Map
    ? (t) => outstanding.has(t)
    : (t) => Object.prototype.hasOwnProperty.call(outstanding ?? {}, t);
  const gone = [...cands.requirements].filter(t => !has(t));
  return gone.length ? { requirements: gone, reason: "already satisfied" } : null;
};

/**
 * A course already in the plan cannot also be the answer to an open card.
 *
 * Repeat instances are the exception the rule has to know about: `MUS1990#2` is
 * a second take of a repeatable course, so the BASE id being placed does not
 * make it unavailable. Comparing raw keys would hide every repeatable course
 * from every picker as soon as it was taken once.
 */
export const withoutPlacedCourses = (placements, { repeatable = () => false } = {}) => (cands, ctx) => {
  const ids = courseIds(cands, ctx);
  if (!ids.size) return null;
  const placed = new Set();
  for (const key of Object.keys(placements ?? {})) {
    const base = String(key).split("#")[0];
    if (!repeatable(base)) placed.add(base);
  }
  const gone = [...ids].filter(id => placed.has(id));
  return gone.length ? { courses: gone, reason: "already in your plan" } : null;
};

/**
 * Options a placed course rules out (design §15.2).
 *
 * If some course in the plan cannot satisfy its prerequisites without option A,
 * then choosing option B breaks the student's own plan, so B is not a candidate.
 * Conservative by construction: the caller supplies `forcedBy`, which must have
 * already checked that the dependent is unsatisfiable WITHOUT the reservation —
 * a dependent whose prerequisites are met some other way rules nothing out.
 *
 * @param {(candidateId: string) => string|null} forcedBy
 *   the placed course that rules this candidate out, or null
 */
export const withoutOptionsRuledOut = (forcedBy) => (cands, ctx) => {
  const ids = courseIds(cands, ctx);
  if (ids.size < 2) return null;      // nothing to rule out when there is one answer
  const gone = [];
  for (const id of ids) if (forcedBy(id)) gone.push(id);
  if (!gone.length) return null;

  // Would this leave the card unanswerable? The prereq graph may narrow a
  // choice; it is not entitled to say the card cannot be answered at all.
  //
  // Checked by SIMULATING the removal rather than by counting what is left.
  // Counting courses is wrong the moment a group has two members: ruling out
  // PSYC 3200 and PT 5410 leaves one course on offer and ZERO answerable
  // groups, because PT 5411 alone was never an answer.
  const after = narrow(cands, { courses: gone, reason: "" });
  if (courseIds(after, ctx).size === 0) return null;

  return { courses: gone, reason: "ruled out by a course already in your plan" };
};

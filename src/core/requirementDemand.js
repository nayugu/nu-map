// ═══════════════════════════════════════════════════════════════════
// REQUIREMENT DEMAND  (pure — no React, no I/O)
//
// How much of a program's requirements are demanded, and how much of that the
// placed courses already satisfy — read off the graduation audit's own
// allocator rather than derived a second time.
//
// It lives in core because BOTH sides need the identical numbers and must not
// form separate opinions: scripts/lib/plan-binding.js sizes each requirement at
// scrape time, and the runtime measures what a student has satisfied since. If
// those two disagreed, a reservation could bind to a requirement the audit
// considers met, or linger after the audit considers it answered.
//
// ── Why only a section's immediate children are inspected ──────────
//
// `normalizePooledSection` reshapes a section's children before allocating, so
// the allocation result is index-aligned with `requirementSections` at SECTION
// level and nowhere deeper. A node-by-node walk of the two trees in parallel
// would silently mismatch.
//
// The shallow read is sufficient for the real data — measured across all 6,185
// shipped sections, no credit-bearing XOM sits deeper than an immediate child —
// and `deepPools` below is the tripwire for that ceasing to be true.
// ═══════════════════════════════════════════════════════════════════

import { specForNode } from "./programEligibility.js";
import { allocateSections } from "./gradRequirements.js";

/** Northeastern's standard course. A parameter, not a fact about degrees. */
export const DEFAULT_UNIT_SH = 4;

/** Targets that are not catalog sections, so they cannot collide with one. */
export const GENERAL_ELECTIVE = "~general";
export const CONCENTRATION = "~concentration";

/**
 * The smallest credit value that can stand alone as somebody's course choice.
 *
 * A one-credit lab is not a thing a student picks FROM a pool — it arrives attached to the
 * lecture it belongs to, and the corequisite machinery is what puts it in the plan. So it is
 * not a candidate for "the typical unit of this pool", however many of them the pool lists.
 *
 * Three, matching the credit floor the rest of the app uses for "a real course". Stated here
 * as its own constant rather than imported, because `src/core/` must not depend on the engine's
 * calibration — the direction is engine → core.
 */
const STANDALONE_SH = 3;

/**
 * The credit value one course answering this requirement usually carries.
 *
 * ── Why sub-3 credit courses are excluded from the mode ─────────────
 *
 * Science pools are lecture/lab PAIRS, so the counts tie exactly and the tie-break decided
 * everything — in the wrong direction, since it sorted credits ascending. Computer Science
 * BSCS's science pool, measured:
 *
 *     44 courses · {0 SH: 4, 1 SH: 19, 3 SH: 2, 4 SH: 19}
 *     BIOL 1111 (4) BIOL 1112 (1) BIOL 1113 (4) BIOL 1114 (1) CHEM 1161 (4) CHEM 1162 (1) …
 *
 * Nineteen 4 SH lectures against nineteen 1 SH labs, so `typicalSH` returned 1 and an 8 SH
 * requirement became EIGHT one-credit slots titled "Science Requirement" instead of two
 * lecture-and-lab pairs. The tie is structural, not a coincidence: every lecture in such a
 * pool has a lab partner, so the counts are always equal and the tie-break always decides.
 *
 * Excluding the labs is more robust than reversing the tie-break, which would still fail a
 * pool listing two labs per lecture. The mode over the standalone courses is the lecture, and
 * the lab follows it in as a corequisite — which is what `coreqAdded` already exists to record.
 *
 * The full-pool mode remains the fallback, so a pool of genuinely small courses — a
 * one-credit seminar requirement, of which the corpus has several — still sizes itself
 * correctly rather than being rounded up to a course it does not contain.
 *
 * ── Why the filter is OPT-IN, and only CHART opts in ────────────────
 *
 * It is off by default because the two callers are asking different questions, which is this
 * codebase's own key inversion: the catalog binding INFERS what a published cell meant, and a
 * department really can print a one-credit lab as its own cell, so there the widest reading is
 * the right one. CHART CONSTRUCTS cells, and a constructed standalone 1 SH slot is meaningless
 * — nobody picks a lab out of a pool as their choice.
 *
 * Measured, which is why this is a flag rather than a change of behaviour: applying the filter
 * to the catalog path moved the binding's over-subscription ratchet from 34 to 40. Not through
 * the named pools — "Khoury Approved Electives" has no sub-3 SH course in it at all — but
 * through the concentration floor at `requirementBinding.js`, a `min` over options that feeds
 * total demand and therefore the derived general-elective budget. Perturbing that is a
 * different subsystem's quality metric, and nothing here argues the new value is better.
 */
export function typicalSH(spec, courseMap, fallback = DEFAULT_UNIT_SH,
                          { standaloneOnly = false } = {}) {
  const counts = new Map();
  const standalone = new Map();
  for (const key of spec?.keys ?? []) {
    const sh = courseMap[key]?.sh;
    if (!sh) continue;
    counts.set(sh, (counts.get(sh) ?? 0) + 1);
    if (sh >= STANDALONE_SH) standalone.set(sh, (standalone.get(sh) ?? 0) + 1);
  }
  const pick = standaloneOnly && standalone.size ? standalone : counts;
  if (!pick.size) return fallback;
  // The tie-break stays ASCENDING. Reversing it looks like it would help — a bigger unit means
  // fewer, larger cells — but it was measured to cost 6 sections: the catalog binding's
  // over-subscription ratchet went 34 → 40, because pools with equal counts of 4 and 5 SH
  // courses started picking 5 and `room = demand / typicalSH` shrank. The filter above is what
  // fixes the lab case, and it fixes it without a tie: {3 SH: 2, 4 SH: 19} picks 4 on count.
  return [...pick.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/**
 * A section's children, split by how they state their demand.
 *
 * `reqSh` marks a credit-hour threshold over a pool (an XOM); everything else is
 * counted in courses. A section can hold BOTH — 61 of the 6,185 shipped sections
 * do — and the two halves have to be added, not chosen between.
 */
function splitChildren(allocSection) {
  const kids = allocSection?.children ?? [];
  const pools = [], plain = [];
  for (const c of kids) (typeof c.reqSh === "number" ? pools : plain).push(c);
  return { kids, pools, plain };
}

/**
 * How many of the plain children this section actually requires.
 *
 * `minRequired` counts ALL children, pools included, so the plain share is
 * whatever is left after the pools have taken their places. Clamped both ways:
 * a section may state a minimum above its child count, and one below its pool
 * count would otherwise ask for a negative number of courses.
 */
function plainRequired(allocSection, pools, plain) {
  const min = allocSection?.minRequired ?? allocSection?.total ?? (pools.length + plain.length);
  return Math.max(0, Math.min(plain.length, min - pools.length));
}

/**
 * Credit a section demands in total, whatever is placed.
 *
 * A child carrying `reqSh` states its demand in credit hours (an XOM pool);
 * anything else is counted in courses via the section's own `minRequired`.
 *
 * ── Both halves, when a section has both ──────────────────────────
 *
 * This used to return the pool total ALONE as soon as any child carried
 * `reqSh`, which reported Behavioral Neuroscience's eight-course, 34 SH
 * "Foundation Requirements" as demanding **1 SH** — the credit of the one small
 * pool sitting beside the courses. 61 sections mix the two shapes, understating
 * their demand by a median of 4 SH and up to 32.
 *
 * That number is not cosmetic. `obligationsOf` derives the general-elective
 * allowance as `totalCreditsRequired − Σ demand`, so an understated section
 * inflated the free-elective bucket by exactly as much: 42 programs were
 * affected, and Behavioral Neuroscience was told 84 of its 132 SH were free
 * electives. It also sets `bindCells`' capacity, so a section could not absorb
 * the cells it genuinely demands.
 *
 * All 61 have `minRequired >= children.length` — every child required — so the
 * split is arithmetic rather than a guess. `plainRequired` generalises it in
 * case a "choose N" section ever mixes the two.
 */
export function demandOf(allocSection, unitSH = DEFAULT_UNIT_SH) {
  const { pools, plain } = splitChildren(allocSection);
  if (!pools.length) {
    return (allocSection?.minRequired ?? allocSection?.total ?? 0) * unitSH;
  }
  const poolSH = pools.reduce((n, c) => n + c.reqSh, 0);
  if (!plain.length) return poolSH;
  return poolSH + plainRequired(allocSection, pools, plain) * unitSH;
}

/**
 * Credit of a section the placed courses already answer.
 *
 * Split the same way as `demandOf`, and for the same reason: measuring
 * satisfaction over the pools alone while demanding both halves would report a
 * section as permanently unmet.
 */
export function satisfiedOf(allocSection, unitSH = DEFAULT_UNIT_SH) {
  const { pools, plain } = splitChildren(allocSection);
  if (!pools.length) return (allocSection?.satCount ?? 0) * unitSH;
  const poolSH = pools.reduce((n, c) => n + (c.satSh ?? 0), 0);
  if (!plain.length) return poolSH;
  return poolSH + plain.filter(c => c.sat).length * unitSH;
}

/** Credit of a section still outstanding. */
export function shortfallOf(allocSection, unitSH = DEFAULT_UNIT_SH) {
  return Math.max(0, demandOf(allocSection, unitSH) - satisfiedOf(allocSection, unitSH));
}

/**
 * Sections whose credit pools nest deeper than the shallow read can see.
 *
 * Empty for all shipped data. A scrape gate rather than a silent wrong answer.
 */
export function deepPools(programData) {
  const bad = [];
  const deep = (node, d) => {
    if (node?.type === "XOM" && node.numCreditsMin && d > 0) return true;
    return (node?.courses ?? []).some(c => deep(c, d + 1));
  };
  for (const s of programData?.requirementSections ?? []) {
    for (const r of s.requirements ?? []) {
      if (r.type !== "XOM" && deep(r, 0)) { bad.push(s.title ?? ""); break; }
    }
  }
  return bad;
}

/**
 * Credit satisfied per binding target, given a set of placed courses.
 *
 * Keyed exactly as a binding's `targets` are — a section INDEX, or a sentinel
 * — so the two line up without translation.
 *
 * @returns {{satisfied: Map, unitSH: Map}}
 */
export function satisfiedByTarget(programData, placedSet, courseMap = {}) {
  const sections = programData?.requirementSections ?? [];
  const alloc = allocateSections(sections, placedSet, new Set(), courseMap);
  const satisfied = new Map();
  const unitSH = new Map();
  const allocated = new Set();

  sections.forEach((section, i) => {
    const unit = typicalSH(specForNode(section), courseMap);
    unitSH.set(i, unit);
    satisfied.set(i, satisfiedOf(alloc[i], unit));
    alloc[i]?.allocatedCourses?.forEach(k => allocated.add(k));
  });

  // Anything placed that no section claimed is general-elective credit. This is
  // the same measure the audit uses, so a course counted toward a requirement
  // is never also counted here.
  let general = 0;
  for (const key of placedSet) if (!allocated.has(key)) general += courseMap[key]?.sh ?? 0;
  satisfied.set(GENERAL_ELECTIVE, general);
  unitSH.set(GENERAL_ELECTIVE, DEFAULT_UNIT_SH);
  return { satisfied, unitSH };
}

/**
 * How many reservations each requirement can retire, for `resolveAnswers`.
 *
 * The difference between what the student's placements satisfy and what the
 * plan's OWN named courses would — measured in whole courses. So a course
 * placed for any reason retires a reservation for the requirement it answers,
 * and a course the plan already named never retires one twice.
 *
 * Both sides are measured with the same function, so the subtraction is
 * meaningful rather than two estimates differenced.
 *
 * ── UNBUILT, and there is a hazard waiting for whoever builds it ─────
 *
 * `resolveAnswers` does not exist. This function has no callers anywhere in
 * src, scripts or test — checked, not assumed — so nothing below has ever run
 * against real state. That is the only reason the following is a note rather
 * than a bug.
 *
 * Since `1434dbc5`, one course answers EVERY requirement that names it while
 * being credited once. `satisfiedByTarget` sums satisfied credit PER TARGET, so
 * a single 4 SH course named by two sections contributes 4 SH to each: 8 SH of
 * satisfaction from 4 SH of coursework. Divide by the unit and this retires a
 * reservation in both.
 *
 * Retiring both is CORRECT as a statement about requirements — both really are
 * met. The hazard is credit: the plan loses two reservations' worth of expected
 * future coursework for one course, and if nothing puts that credit back the
 * student is short by the difference. Whether it is real depends entirely on
 * the consumer — if general electives are re-derived after retirement they
 * absorb it, since `used` still claims the course exactly once for credit.
 *
 * So: before wiring this up, check the degree TOTAL after retirement, not the
 * per-target counts. The counts will look right while the total is short.
 *
 * (A first attempt to measure this compared retired-reservation credit against
 * placed credit across the corpus and reported 34 programs "over". That metric
 * was meaningless: placing every named course legitimately meets every
 * requirement and legitimately retires every reservation, and shared courses
 * make per-target credit exceed coursework BY DESIGN. Two different currencies.
 * The measurement that would settle it needs a real CHART plan and a re-derived
 * elective bucket.)
 *
 * @param {object} programData
 * @param {Iterable<string>} placedKeys      what the student has placed
 * @param {Iterable<string>} planNamedKeys   what the plan names outright
 * @param {object} courseMap
 * @returns {Map<string|number, number>} target -> reservations it may retire
 */
export function planSurplus(programData, placedKeys, planNamedKeys, courseMap = {}) {
  const now  = satisfiedByTarget(programData, new Set(placedKeys), courseMap);
  const base = satisfiedByTarget(programData, new Set(planNamedKeys), courseMap);
  const out = new Map();
  for (const [target, sh] of now.satisfied) {
    const unit = now.unitSH.get(target) || DEFAULT_UNIT_SH;
    const n = Math.floor(Math.max(0, sh - (base.satisfied.get(target) ?? 0)) / unit);
    if (n > 0) out.set(target, n);
  }
  return out;
}

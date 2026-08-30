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
 * What one node of an allocation result REQUIRES and how much of that is MET,
 * both in credit hours.
 *
 * ── Why one function and not two ──────────────────────────────────
 *
 * `demandOf` and `satisfiedOf` are subtracted from each other by `shortfallOf`,
 * so any disagreement between them shows up as a section that can never be
 * finished. They used to be two independent walks in two different currencies —
 * demand in `count x modal credit`, satisfaction in `satCount x modal credit` —
 * which agreed only because both were wrong the same way. Measuring the real
 * thing means measuring it once, here, and letting both read off the result.
 *
 * The cap is what makes the subtraction safe: `sat` can never exceed `req` for
 * any node, so a 12 SH pool answered with 16 SH does not lend 4 SH of surplus
 * to the section beside it.
 *
 * ── Why the modal unit is now only a FALLBACK ─────────────────────
 *
 * A section's credit was `minRequired x typicalSH(...)` — how many children it
 * has, times the credit of the pool's most common course. That is an estimate
 * standing in for a number the catalog states outright, and it was wrong in
 * every direction at once. Mechanical Engineering and Design (Boston), which is
 * how this was found:
 *
 *   Senior Capstone Design Project   MEIE 4701 (1 SH) + MEIE 4702 (5 SH) = 6 SH.
 *                                    Modal credit over {1, 5} is 1, so: 2 x 1 = 2.
 *   Design Requirements              four ARTG co-requisite pairs, 4 SH each = 16.
 *                                    Every course is 2 SH, so: 4 x 2 = 8.
 *   Required Engineering             seven entries, five of them a lecture plus a
 *                                    1 SH lab = 32 SH. Modal credit 4, so: 7 x 4 = 28.
 *
 * 117 SH of a 139 SH degree, leaving **22 SH of free electives** where the
 * registrar's own page says 4. Summing the courses gives 135, and 139 - 135 = 4,
 * exactly. The estimate is only needed where nothing names a credit value: a
 * RANGE ("any MATH 3001-4999"), a course missing from the catalog (54 nodes
 * corpus-wide), and a section that names no course at all.
 *
 * ── The tie-breaks, each measured ─────────────────────────────────
 *
 * OR takes the **minimum** of its branches. 518 of 3,318 OR nodes offer branches
 * of differing credit, so this had to be decided rather than assumed, and min
 * beat both alternatives against the 95 programs that state their own free-
 * elective figure: exact matches 22 (min) against 20 (modal branch) and 16 (max).
 * It is also the honest reading — the requirement is answerable with the
 * cheapest branch — and it errs by inflating free electives rather than by
 * demanding credit the student does not owe.
 *
 * A "choose N of M" section would need a fourth rule, and does not get one:
 * `minRequirementCount >= children.length` for **all 6,887 shipped sections**,
 * and there are zero nested SECTION nodes and zero pick-N concentration options.
 * The N-smallest branch below is unexercised by the corpus; it is there so that
 * a page that starts doing this degrades to the conservative reading instead of
 * silently demanding everything.
 */
function creditsOfNode(node, courseMap, unit) {
  const sh = (key) => courseMap?.[key]?.sh;
  const met = (req) => (node?.sat ? req : 0);
  switch (node?.type) {
    case "COURSE": {
      const req = sh(node.key) ?? unit;
      return { req, sat: met(req) };
    }
    case "AND": {
      const kids = (node.children ?? []).map(c => creditsOfNode(c, courseMap, unit));
      return { req: kids.reduce((n, k) => n + k.req, 0),
               sat: kids.reduce((n, k) => n + k.sat, 0) };
    }
    case "OR": {
      const kids = (node.children ?? []).map(c => creditsOfNode(c, courseMap, unit));
      if (!kids.length) return { req: 0, sat: 0 };
      // One branch answers it, so the credit is one branch's — and the credit
      // MET is the best single branch, not the sum, or placing two alternatives
      // would report the requirement as doubly satisfied.
      const req = Math.min(...kids.map(k => k.req));
      return { req, sat: Math.min(req, Math.max(...kids.map(k => k.sat))) };
    }
    case "XOM":
      // Already exact in both halves: `reqSh` is the registrar's threshold and
      // `satSh` the allocator's own credit accounting, split-credit included.
      return { req: node.reqSh ?? 0, sat: Math.min(node.reqSh ?? 0, node.satSh ?? 0) };
    case "RANGE": {
      // A window over a subject names no course, so its credit is unknowable
      // until something lands in it. One course's worth is the reading that
      // matches how the catalog prints these.
      return { req: unit, sat: met(unit) };
    }
    case "SECTION":
      return creditsOfSection(node, courseMap, unit);
    default:
      // An unrecognised or malformed node still occupies a requirement slot. It
      // must not contribute 0 and silently hand its credit to free electives.
      return { req: unit, sat: met(unit) };
  }
}

/** The same, for a SECTION result — top-level or (hypothetically) nested. */
function creditsOfSection(allocSection, courseMap, unit) {
  const kids = allocSection?.children ?? [];
  if (!kids.length) {
    // ── A section with NO children states its demand in PROSE ──────
    //
    // The catalog can print a credit figure and never name a course to satisfy
    // it (580 sections, 343 programs). There is nothing to count, so
    // `minRequired * unit` is arithmetic over children that do not exist: it
    // answered a flat 4 SH for every one of them, including a 16 SH minor
    // requirement and a 32 SH focus area. Corpus-wide it under-claimed 4,305
    // of 6,625 SH, and `obligationsOf` derives the free-elective allowance as
    // `total − Σ demandOf`, so every credit missed here was handed to general
    // electives — the planner told the student to fill it with anything.
    //
    // The registrar's own number is the better claim, so it wins when present.
    const req = allocSection?.statedSH > 0
      ? allocSection.statedSH
      : (allocSection?.minRequired ?? allocSection?.total ?? 0) * unit;
    // Nothing is enumerated, so nothing here can be marked met; `satCount` is
    // structurally 0 for these. Kept as arithmetic rather than a literal 0 so a
    // future shape that does count something is not silently reported unmet.
    return { req, sat: Math.min(req, (allocSection?.satCount ?? 0) * unit) };
  }

  const parts = kids.map(c => creditsOfNode(c, courseMap, unit));
  const min = allocSection?.minRequired ?? allocSection?.total ?? kids.length;
  if (min >= kids.length) {
    // No `Math.min(req, …)` here, unlike the branch below, and that asymmetry is
    // load-bearing rather than an oversight: every node type caps its own `sat`
    // at its own `req`, so Σ sat <= Σ req by induction and a cap would be dead
    // code — code that implies a hazard the structure has already ruled out.
    // The pick-N branch needs one because it sums a DIFFERENT subset for each
    // half (cheapest by req, largest by sat), so its two sums are not aligned.
    return { req: parts.reduce((n, k) => n + k.req, 0),
             sat: parts.reduce((n, k) => n + k.sat, 0) };
  }
  // Unexercised by the shipped corpus — see the note above. The N cheapest
  // children bound the demand from below, and satisfaction is capped by it.
  const need = Math.max(0, min);
  const req = [...parts].sort((a, b) => a.req - b.req).slice(0, need)
    .reduce((n, k) => n + k.req, 0);
  const sat = [...parts].sort((a, b) => b.sat - a.sat).slice(0, need)
    .reduce((n, k) => n + k.sat, 0);
  return { req, sat: Math.min(req, sat) };
}

/**
 * Credit a section demands in total, whatever is placed.
 *
 * Placement-independent by construction: `creditsOfNode` reads `sat` for the
 * satisfied half only, and every credit figure it sums comes from the catalog
 * or from `courseMap`. A section's demand must not move as a student places
 * courses, or the derived free-elective allowance would drift under them.
 *
 * `courseMap` is optional so that a caller with no catalog still gets the
 * count-times-unit reading rather than a crash — but every caller in `src` has
 * one, because `typicalSH` needs it to compute `unitSH` in the first place.
 */
export function demandOf(allocSection, unitSH = DEFAULT_UNIT_SH, courseMap = {}) {
  return creditsOfSection(allocSection, courseMap, unitSH).req;
}

/**
 * Credit of a section the placed courses already answer.
 *
 * The same walk as `demandOf`, reading the other half of the pair. That is the
 * point: a section whose every child is satisfied returns exactly its demand,
 * so `shortfallOf` reaches 0 rather than leaving a residue in whatever unit the
 * two happened to disagree about.
 */
export function satisfiedOf(allocSection, unitSH = DEFAULT_UNIT_SH, courseMap = {}) {
  return creditsOfSection(allocSection, courseMap, unitSH).sat;
}

/** Credit of a section still outstanding. */
export function shortfallOf(allocSection, unitSH = DEFAULT_UNIT_SH, courseMap = {}) {
  const { req, sat } = creditsOfSection(allocSection, courseMap, unitSH);
  return Math.max(0, req - sat);
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
    satisfied.set(i, satisfiedOf(alloc[i], unit, courseMap));
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

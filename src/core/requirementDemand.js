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

/** The credit value one course answering this requirement usually carries. */
export function typicalSH(spec, courseMap, fallback = DEFAULT_UNIT_SH) {
  const counts = new Map();
  for (const key of spec?.keys ?? []) {
    const sh = courseMap[key]?.sh;
    if (sh) counts.set(sh, (counts.get(sh) ?? 0) + 1);
  }
  if (!counts.size) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
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

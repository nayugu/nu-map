// ═══════════════════════════════════════════════════════════════════
// CHART · PREREQ DEPTH  (pure — no React, no I/O, no adapters)
//
// How many study terms must precede a course. This is the lower bound that gives
// every cell its domain — never the placement. A course of depth 2 cannot sit in
// the first two terms; that it *could* sit in term 3 says nothing about whether
// it should. Feasibility bound and placement preference are different questions,
// and conflating them is what puts a broad elective in year 1.
//
// ── Boolean-aware, because a flat count is wrong ───────────────────
//
//   AND → max   both branches must be behind you, so the deeper one decides
//   OR  → min   either branch will do, so the shallower one decides
//   ref → 1 + depth(that course)
//
// CS 4100 lists "CS 3100 Or CS 3500" and CS 3500 is not in our catalog. Under
// OR→min the bound is CS 3100's; under a flat walk over refs the absent course
// would either inflate the bound or make the course look free.
//
// ── MEASURED: this is a WEAK constraint, and the design must not lean on it ──
//
// Over the 7,966-course catalog, depth is 0 for **5,627 (71%)** and ≥4 for 118.
// Per program, the bound leaves every study term legal for **52–65%** of the
// courses the program names outright (CS+Math 11/21, Industrial Engineering
// 18/32, Biology 13/20). CS+Math's deepest required course is depth 2.
//
// The reason is structural, not a data gap: most prereqs are wide ORs
// ("CS 2000 Or CS 2100 Or CS 2500 Or DS 2000 Or DS 2500 Or EECE 2560"), and OR
// takes the MINIMUM, so one shallow branch collapses the whole bound.
//
// Two consequences, both load-bearing:
//
//   1. **Most-constrained-first ordering cannot get its signal from here.**
//      Availability is the constraint that actually narrows — 42.0% of courses
//      have a season provably never offered and 17.1% admit only ONE of the four
//      — followed by pool size (most requirement sections admit 2–11 courses).
//   2. **Sequencing quality is the objective's job, not feasibility's.** The DAG
//      will not stop a 4000-level elective landing in year 1, because the
//      catalog genuinely permits it. Only a stated preference will.
//
// ── An unresolvable ref is ABSENT, not zero and not infinite ───────
//
// 13.2% of prereq atoms name courses the catalog no longer has (NEU renumbered
// CS 2500/2510/3500). `evalPrereqTree` calls those "missing", which is right for
// warning a student that something in their plan is unaccounted for, and wrong
// for CONSTRUCTING one: it would make CHART refuse to schedule courses
// departments require, over a defect in our own data.
//
// Treating them as costing NOTHING is the opposite error, and it is worse,
// because OR takes the minimum. `CS 3100 Or CS 3500` would bound at zero on the
// strength of the branch we cannot read — and the first plan this engine
// generated duly put CS 3100 in the second term and CS 2100, its actual
// prerequisite, in the eighth.
//
// The right answer is the one the parser already implements for a dangling
// operator: an operand we cannot evaluate is not an operand. `foldPrereqTree`
// short-circuits null, so an unresolvable ref contributes nothing to a min and
// nothing to a max, and the resolvable siblings decide:
//
//   OR  [CS 3100, CS 3500]  → depth(CS 3100) + 1     the branch we can read
//   AND [CS 3100, CS 3500]  → depth(CS 3100) + 1     same
//   [CS 3500] alone         → null → 0               we know nothing, so nothing
//
// The last line is what keeps the 33 courses whose every prerequisite was
// renumbered schedulable, which is the whole reason not to call them missing.
//
// A course-number ladder (2xxx→2 terms, 3xxx→4, 4xxx→6) was tried first and
// **over-estimates 94–100% of the resolvable population at every level ≥2**,
// whose measured median depth is 0 — numbering predicts prereq depth barely at
// all. Course level is still real information, just about *depth vs breadth*,
// which is an objective (see `courseLevel`) and not about ordering.
//
// Every course whose bound touched an unresolvable ref is named in
// `unresolvableBearers`, so a bound resting on incomplete data is never mistaken
// for a measurement.
//
// ── Cycles ─────────────────────────────────────────────────────────
//
// Scraped prereq data contains cycles (A requires B requires A) — 7 courses.
// Taken literally neither is ever takeable, which is true of the data and false
// of the world, so a back edge folds to 0 and is recorded.
//
// ── Determinism ────────────────────────────────────────────────────
//
// Depths are computed EAGERLY over ids in sorted order, not lazily per query.
// Inside a cyclic component the memoised answer depends on which member was
// entered first, so a lazy index would hand out different depths depending on
// which cell asked first — and a plan that differs run to run makes the diff
// review the data workflows rely on into noise. Measured cost: 353 ms for the
// whole catalog, once.
// ═══════════════════════════════════════════════════════════════════

import { foldPrereqTree, refId } from "../core/prereqFold.js";

/**
 * Depth is capped so a pathological chain cannot dominate every domain. A degree
 * is a dozen terms; a bound past that says "not schedulable" as well as 40 does.
 * Measured: nothing in the shipped catalog reaches it — the deepest course is 8.
 */
export const MAX_DEPTH = 24;

/**
 * What a ref we cannot resolve contributes: nothing.
 *
 * `null`, not 0 — see the header. Zero would win every OR it appears in and
 * collapse the bound on the strength of the branch we cannot read.
 */
export const UNRESOLVED_ABSENT = () => null;

/**
 * A course's level band, 1..9 — the NEU numbering convention, read literally.
 *
 * NOT a depth estimate: measured against real prereq chains, numbering predicts
 * depth barely at all (see the header). It is a *depth-vs-breadth* signal, which
 * is what the objective layer needs it for — a 4000-level course in the major
 * subject is advanced study whether or not anything gates it.
 *
 * 0 for an id carrying no number, so an unparseable id sorts as "not advanced"
 * rather than throwing.
 */
export function courseLevel(courseId) {
  const m = /(\d+)\s*$/.exec(String(courseId ?? ""));
  if (!m) return 0;
  const level = Math.floor(parseInt(m[1], 10) / 1000);
  return Number.isFinite(level) ? Math.max(0, Math.min(9, level)) : 0;
}

/**
 * @typedef {Object} DepthIndex
 * @property {(courseId: string) => number} depthOf
 * @property {(courseId: string) => boolean} approximate
 *   true when this course's bound rests on data we know to be broken
 * @property {Set<string>} unresolvableRefs   refs naming no catalog course
 * @property {Set<string>} unresolvableBearers courses whose bound used one
 * @property {Set<string>} cyclic             courses in or below a prereq cycle
 * @property {Map<string, number>} depths
 */

/**
 * Build the depth index for a catalog, once.
 *
 * @param {Record<string, {id: string, prereqs?: any[]}>} courseMap
 * @param {object} [opts]
 * @param {(refId: string) => number|null} [opts.unresolvedDepth]
 *   what an unresolvable ref contributes; `null` means "not an operand". Injected
 *   so the policy is visible and testable rather than arrived at by accident.
 * @returns {DepthIndex}
 */
export function buildDepthIndex(courseMap = {}, { unresolvedDepth = UNRESOLVED_ABSENT } = {}) {
  const depths = new Map();
  const inProgress = new Set();
  const unresolvableRefs = new Set();
  const unresolvableBearers = new Set();
  const cyclic = new Set();
  const tainted = new Set();          // at or below a cycle / an estimated ref

  function compute(id) {
    const memo = depths.get(id);
    if (memo !== undefined) return memo;

    const course = courseMap[id];
    // Not a catalog course at all. Callers reach us through a ref and handle the
    // estimate there; a direct query for a nonexistent id has no answer to give.
    if (!course) return 0;

    if (inProgress.has(id)) {
      // Back edge. 0 rather than MAX_DEPTH: a cycle is our data's defect, and
      // refusing to schedule both courses is a confident wrong answer where an
      // under-estimate is a recoverable one — the witness must still find a real
      // course for the cell.
      cyclic.add(id);
      tainted.add(id);
      return 0;
    }

    inProgress.add(id);
    let taintedBelow = false;

    const below = foldPrereqTree(course.prereqs, {
      or:  (a, b) => Math.min(a, b),
      and: (a, b) => Math.max(a, b),
      // A condition leaf ("graduate program admission") is not a course and
      // costs no terms — neutral, as the satisfaction algebra treats it.
      note: () => 0,
      course: (tok) => {
        const rid = refId(tok);
        if (!courseMap[rid]) {
          unresolvableRefs.add(rid);
          unresolvableBearers.add(id);
          taintedBelow = true;
          const d = unresolvedDepth(rid);
          // null propagates as "not an operand", so the resolvable siblings of an
          // OR decide the bound instead of this branch collapsing it to zero.
          return d === null ? null : d + 1;
        }
        const d = compute(rid);
        if (tainted.has(rid)) taintedBelow = true;
        return d + 1;
      },
    });

    inProgress.delete(id);
    // Capped per course rather than mid-tree, so an AND of two capped branches
    // does not creep past the cap.
    const value = Math.min(MAX_DEPTH, below ?? 0);
    depths.set(id, value);
    if (taintedBelow) tainted.add(id);
    return value;
  }

  // Eager and sorted — see the determinism note in the header.
  for (const id of Object.keys(courseMap).sort()) compute(id);

  return {
    depthOf: (id) => depths.get(id) ?? 0,
    approximate: (id) => tainted.has(id),
    unresolvableRefs,
    unresolvableBearers,
    cyclic,
    depths,
  };
}

/**
 * The depth a GROUP costs — a cell whose answer is several courses taken
 * together (`CS 1800 and CS 1802`).
 *
 * Max, not sum: they sit in the same term, so the group is ready when its
 * deepest member is.
 */
export function groupDepth(group, depthOf) {
  let d = 0;
  for (const id of group ?? []) d = Math.max(d, depthOf(id));
  return d;
}

/**
 * How many courses in a supplied pool each course unlocks.
 *
 * `generators before consumers` needs a direction, and "is named in other
 * courses' prerequisites" is the only structural evidence of one we have.
 * Counted within the pool rather than the whole catalog, because unlocking three
 * courses this degree requires matters and unlocking thirty it never mentions
 * does not.
 *
 * @param {Iterable<string>} ids
 * @param {Record<string, object>} courseMap
 * @returns {Map<string, number>} course id → how many of `ids` name it
 */
export function unlockCounts(ids, courseMap = {}) {
  const pool = new Set(ids);
  const out = new Map();
  for (const id of pool) {
    const seen = new Set();
    foldPrereqTree(courseMap[id]?.prereqs, {
      or: () => 1, and: () => 1, note: () => 1,
      course: (tok) => { seen.add(refId(tok)); return 1; },
    });
    for (const rid of seen) if (pool.has(rid)) out.set(rid, (out.get(rid) ?? 0) + 1);
  }
  return out;
}

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
// Over the 7,966-course catalog, depth is 0 for **5,784 (72.6%)** and ≥4 for 118.
// (It read 5,627 before concurrent-eligible references stopped costing a term —
// see the `course` leaf below. 152 courses list nothing but concurrent options.)
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
// Derived, not declared. `levelPosition` and `levelFloor` are Northeastern measurements over
// its own published plans, so they are owned by the calibration; a second literal here would
// drift from it silently, which is the whole reason the calibration exists.
import { DEFAULT_CALIBRATION } from "./calibration.js";
import { standingFloorOf, STANDING_LADDER } from "../core/classStanding.js";

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
 * @property {Map<string, number>} catalogUnlock  how many catalog courses need this one,
 *   transitively — foundationality measured against the UNIVERSITY rather than one degree
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
        // ── A CONCURRENT prerequisite costs no term ──────────────────
        //
        // `concurrent: true` means the catalog permits the two in the SAME semester, so the
        // reference bounds what must be *underway*, not what must be *finished*. Charging it
        // a term is charging for an ordering the registrar does not require.
        //
        // Not academic. `PHYS 1161` lists `MATH 1341` concurrent and its department puts
        // both in the first fall; depth said 1, and since PHYS 1161 is fall-only that pushed
        // Intro Physics to YEAR TWO. `precedence.js` already knew (`concurrentOk`) — depth
        // did not, and depth is what `buildDomains` turns into `before-prereqs`. So a rule
        // the engine models correctly in one place was contradicted in another.
        //
        // 251 of 2,614 courses with prerequisites (9.6%) carry a concurrent-eligible option
        // and 152 (5.8%) have nothing but. This is the same "systematically later than the
        // department" bias the early-terms window exists to fight, arriving from underneath.
        const cost = tok?.concurrent ? 0 : 1;
        const rid = refId(tok);
        if (!courseMap[rid]) {
          unresolvableRefs.add(rid);
          unresolvableBearers.add(id);
          taintedBelow = true;
          const d = unresolvedDepth(rid);
          // null propagates as "not an operand", so the resolvable siblings of an
          // OR decide the bound instead of this branch collapsing it to zero.
          return d === null ? null : d + cost;
        }
        const d = compute(rid);
        if (tainted.has(rid)) taintedBelow = true;
        return d + cost;
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
    // ── Foundationality, measured against the CATALOG ────────────────
    //
    // The same computation as the per-program unlock the search already uses, over the whole
    // course universe instead of one degree's. Built here because it belongs to the CATALOG,
    // like depth does: it is the same for every program, and computing it per attempt would
    // pay 15 ms once per rung per shape instead of once per run.
    //
    // Why both scopes are needed rather than one replacing the other is argued at
    // `noClaim` in search.js. Briefly: the program scope answers "does this degree's own
    // structure rest on this course", which is the right question for ranking a degree's
    // generators against each other; this one answers "does anything at all rest on it",
    // which is the right question for deciding whether a course is foundational or terminal.
    catalogUnlock: unlockValues(Object.keys(courseMap), courseMap),
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
 * How much of a program's own course universe each course unlocks.
 *
 * `generators before consumers` needs a direction, and "is named in other courses'
 * prerequisites" is the only structural evidence of one we have.
 *
 * ── Two decisions here, both of which were wrong in the first version ─
 *
 * **Transitive, not direct.** MATH 1341 is not usually named by the 3000-level course
 * that needs it; MATH 1342 is, and MATH 1342 names 1341. Counting direct dependents
 * only makes a chain's root look like a leaf.
 *
 * **Over the program's whole universe, pools included.** This is the one that matters
 * and the one a plausible-sounding shortcut gets wrong. Counting only the courses a
 * degree NAMES scores `CS 3100` at **zero** in Computer Science and Political Science —
 * nothing required names it — while it in fact sits under **30** of that program's
 * elective candidates. That is the whole reason a student calls it a course that opens
 * things up, and the required-only count is blind to exactly the cases the distinction
 * exists for.
 *
 * Worth stating that the aggregate does NOT show this: against published position, the
 * required-only count correlates at r = -0.251 and this one at -0.253 — indistinguishable.
 * They differ on individual courses, not on average, so the average is the wrong summary
 * and a per-case check is what settles it.
 *
 * Measured against 194 published plans, unlock value predicts position WITHIN a level
 * band, where level cannot take the credit: r = -0.13 (1xxx), -0.27 (2xxx), -0.33
 * (3xxx), -0.14 (4xxx), with r(unlock, level) only -0.19. Among 3000-level courses the
 * high-unlock ones sit at 0.47 through the plan and the low-unlock ones at 0.61.
 *
 * @param {Iterable<string>} universe every course this program could schedule —
 *   required courses AND every elective-pool candidate
 * @param {Record<string, object>} courseMap
 * @returns {Map<string, number>} course id → how many of `universe` need it, transitively
 */
export function unlockValues(universe, courseMap = {}) {
  const pool = new Set(universe);
  const closures = new Map();

  const closureOf = (id, stack) => {
    const memo = closures.get(id);
    if (memo) return memo;
    // A cycle is our data's defect, not a fact about the degree. Returning empty
    // under-counts rather than looping, the same call `buildDepthIndex` makes.
    if (stack.has(id)) return EMPTY_SET;
    stack.add(id);
    const out = new Set();
    const refs = new Set();
    foldPrereqTree(courseMap[id]?.prereqs, {
      or: () => 1, and: () => 1, note: () => 1,
      course: (tok) => { refs.add(refId(tok)); return 1; },
    });
    for (const r of refs) {
      if (!courseMap[r]) continue;              // a renumbered course: absent, not zero
      out.add(r);
      for (const x of closureOf(r, stack)) out.add(x);
    }
    stack.delete(id);
    closures.set(id, out);
    return out;
  };

  const out = new Map();
  for (const id of pool) {
    for (const anc of closureOf(id, new Set())) out.set(anc, (out.get(anc) ?? 0) + 1);
  }
  return out;
}

const EMPTY_SET = new Set();

/**
 * Where a course of each level belongs, as a fraction through the plan.
 *
 * MEASURED, not assumed: 12,848 course placements across 661 published plans. The
 * relationship is the strongest in the corpus — **Pearson r = 0.809** between level
 * and position, monotone at every step.
 *
 *   1xxx  0.00      2xxx  0.36      3xxx  0.64      4xxx  0.91
 *
 * ── The MEDIAN, not the mean, and the difference mattered ───────────
 *
 * The means are 0.10 / 0.36 / 0.61 / 0.88, and using them was a bug. A distribution
 * bounded at zero with a long right tail has a mean above its median, so level 1
 * came out at 0.10 — which is nearer term 1 than term 0 in a ten-term plan. First-year
 * courses were duly pushed out of the first term, and four general electives filled
 * the hole. The median says what the corpus actually does: a 1000-level course goes
 * in term one.
 *
 * This is what was missing. Without it CHART produced plans where every prereq
 * chain was correct and a reader could still see they were wrong: a 3000-level
 * Number Theory course in the second term, first-year Discrete Structures in year
 * two, a first-year seminar in year four. Nothing in prereqs or availability
 * objects to any of that, because the catalog genuinely permits it — only the
 * convention every department follows does.
 *
 * A PREFERENCE, not a constraint. A student legitimately takes a 4000-level
 * elective early, and 10% of published 1xxx placements sit past the plan's midpoint.
 */
export const LEVEL_POSITION = DEFAULT_CALIBRATION.levelPosition;

/**
 * The EARLIEST a published plan puts a course of each level — the p10 of the same
 * 12,848 placements.
 *
 *   1xxx  0.00      2xxx  0.09      3xxx  0.22      4xxx  0.67
 *
 * ── Why a floor, and not just a target ──────────────────────────────
 *
 * Level is not merely a convention. It is a PROXY for a hard constraint we do not
 * have: class standing. A 4000-level course generally requires junior or senior
 * standing, the catalog states that in prose, and `RESTRICTION_ONLY` discards the
 * prose — so nothing in our data objects to a senior seminar in the first term.
 *
 * Reading level as a target instead produced two opposite failures in turn. As a
 * target it put general electives in year 1, because a degree has few 1000-level
 * courses and year 1 has room for fourteen. Ignored in favour of "major courses as
 * early as possible", it put `CS 4530` in the first term. A floor gets both right:
 * go as early as the major wants, but not earlier than a real plan has ever put a
 * course of that level.
 *
 * p10 rather than the minimum, because the minimum is one department's outlier and
 * a floor built on it would not constrain anything.
 *
 * ── The proxy is now a FALLBACK, not the answer ─────────────────────
 *
 * The paragraph above is still the reason this table exists, but its premise —
 * "class standing, a hard constraint we do not have" — stopped being true in
 * August 2026. Banner's getRestrictions publishes the gate directly and the scrape
 * reads it (`course.offering.std`, see src/core/classStanding.js), so where the
 * registrar has stated a standing we use the stated one and this table is what we
 * fall back to for the ~79% of courses with no restriction.
 *
 * MEASURED, and it corrects the proxy in BOTH directions — which one applies depends
 * on the GATE, not on the level:
 *
 *   ENGW 3302   level 3, gated JR    0.22 → 0.50   ~2.2 terms LATER  (proxy too loose)
 *   EECE 4792   level 4, gated JR    0.67 → 0.50   ~1.4 terms EARLIER (proxy too strict)
 *   MEIE 4702   level 4, gated SR    0.67 → 0.75   ~0.6 terms LATER
 *
 * The third line is worth keeping because it contradicts the obvious summary of this
 * change: a senior-only capstone is held LATER by the registrar than by the p10 of
 * observed placements. Do not re-fit `levelFloor` to close any of these gaps — the
 * two disagree because one is a statistical proxy and the other is the rule.
 */
export const LEVEL_FLOOR = DEFAULT_CALIBRATION.levelFloor;

/**
 * ── A GRADUATE program has no standing ladder, and clamping to 4xxx was a bug ──
 *
 * Measured over 62 graduate plans and 683 placements, the p10 position is **0.00 at
 * every level from 5xxx to 8xxx**: a student admitted to a master's takes 5000-level
 * courses in their first term, which is the whole point of being admitted.
 *
 * Clamping level to 4 gave every one of those courses the 4xxx floor of 0.67 — so in
 * a program where every course is 5000-level, every cell was barred from the first
 * two thirds of its own plan.
 *
 * The medians do not form a usable ladder either — 5xxx 0.21, 6xxx 0.33, 7xxx 0.75,
 * 8xxx 0.27 — and the non-monotonicity is not signal, it is 33 observations at 8xxx.
 * So graduate study gets one target and no floor rather than a fabricated ladder.
 *
 * A 5000-level course inside an UNDERGRADUATE plan is a different case and does have
 * a floor: measured p10 0.57 across 154 placements, which is why `LEVEL_FLOOR` carries
 * a 5 rather than reusing 4's.
 */
export const GRADUATE_TARGET = DEFAULT_CALIBRATION.graduateLevelTarget;

/** Levels at and above this are graduate study. */
export const GRADUATE_LEVEL = DEFAULT_CALIBRATION.graduateStudyLevel;

/**
 * The earliest position a cell of this level should occupy, 0..1.
 *
 * `studentType` matters: the same 5000-level course is late in an undergraduate plan
 * and immediate in a master's.
 */
export function cellLevelFloor(plan, courseMap, studentType = "undergraduate") {
  if (studentType === "graduate") return 0;
  const floors = optionFloors(plan, courseMap);
  return floors.length ? Math.min(...floors) : 0;
}

/**
 * The class standing a whole cell requires, or null when it requires none.
 *
 * Combines like `optionFloors`, and for the same reasons: strictest WITHIN a group
 * (an AND needs every member, so the latest gate governs), most lenient ACROSS
 * options (the student may pick that option). One consequence worth stating —
 * a single UNGATED option makes the whole cell ungated, because the student can
 * simply choose it. That is not a loophole; it is what the requirement means.
 *
 * @param {object} plan   a cell plan from deriveCells
 * @param {Record<string,object>} courseMap
 * @returns {string|null} a STANDING_LADDER member
 */
export function cellStanding(plan, courseMap) {
  const cell = plan?.cell ?? plan;
  const options = cell?.groups?.length
    ? cell.groups
    : (plan?.candidates ?? []).map(id => [id]);
  if (!options.length) return null;
  let lenient = null;
  for (const group of options) {
    let strictest = null;
    for (const id of group) {
      const code = courseMap?.[id]?.offering?.std;
      if (!STANDING_LADDER.includes(code)) continue;
      if (strictest === null
          || STANDING_LADDER.indexOf(code) > STANDING_LADDER.indexOf(strictest)) strictest = code;
    }
    if (strictest === null) return null;   // an ungated option ungates the cell
    if (lenient === null
        || STANDING_LADDER.indexOf(strictest) < STANDING_LADDER.indexOf(lenient)) lenient = strictest;
  }
  return lenient;
}

/**
 * One course's floor: the registrar's stated standing if there is one, else the
 * level-digit p10. Null means "no information", which is NOT the same as 0 — a
 * course with an unparseable number must drop out of the combination rather than
 * pull the whole cell's floor to zero, which is what `.filter(Boolean)` did when
 * this worked on levels.
 */
function courseFloor(id, courseMap) {
  const stated = standingFloorOf(courseMap?.[id]);
  if (stated !== null) return stated;
  const lv = courseLevel(id);
  if (!lv) return null;
  return LEVEL_FLOOR[Math.min(5, lv)] ?? LEVEL_FLOOR[5];
}

/**
 * The floor of each of a cell's options.
 *
 * A GROUP is an AND — every member must be taken, so the group cannot start before
 * its latest member and its floor is the MAX. Across options it is the caller's job
 * to take the MIN: shallowest, not deepest, because the student may pick that
 * option and a floor must not forbid a placement some legal choice makes perfectly
 * fine. Same shape as the levels version this replaced, computed per course so a
 * stated gate and a level estimate can sit side by side in one cell.
 */
function optionFloors(plan, courseMap) {
  const cell = plan.cell ?? plan;
  const options = cell.groups?.length
    ? cell.groups
    : (plan.candidates ?? []).map(id => [id]);
  const out = [];
  for (const group of options) {
    const memberFloors = group.map(id => courseFloor(id, courseMap)).filter(f => f !== null);
    if (memberFloors.length) out.push(Math.max(...memberFloors));
  }
  return out;
}



/** Where a course of this level wants to sit, 0..1 through the plan. */
export function levelTarget(courseId, studentType = "undergraduate") {
  const lv = courseLevel(courseId);
  if (!lv) return null;
  if (studentType === "graduate" || lv >= GRADUATE_LEVEL) {
    return studentType === "graduate" ? GRADUATE_TARGET : LEVEL_POSITION[4];
  }
  return LEVEL_POSITION[lv];
}

/**
 * The target position for a whole cell.
 *
 * For a decided cell, its courses' deepest level — a group sits where its most
 * advanced member belongs. For an undecided one, the modal level of its candidates,
 * because a `MATH 3001–4999` pool is a third-year slot whichever course fills it.
 * Null for a cell that admits anything: a general elective belongs nowhere in
 * particular, which is exactly why it is the filler.
 */
export function cellLevelTarget(plan, courseMap, studentType = "undergraduate") {
  const cell = plan.cell ?? plan;
  if (cell.groups?.length) {
    // `filter(v => v > 0)` was here, and it discarded the ONE value that matters
    // most: `LEVEL_POSITION[1]` is 0.00, so every first-year course in a group-based
    // cell was read as having no level at all and sent to the end of the plan as
    // filler. `ENGW 1111 or 1102` — first-year writing, which 100% of published plans
    // put in year one — came out at a median position of 0.55.
    //
    // Null is the only "no level" value; 0 is a position.
    // ── The MEDIAN across options, not the minimum ────────────────
    //
    // `Math.min` was the optimistic extreme: a cell offering eleven unrelated options was
    // positioned as if the student would take its cheapest one. CS+Math's `Supporting
    // Course` — 11 options across 7 subjects (SOCL, CY, PHIL, AFCS, DS, HIST, INSH),
    // levels 1xxx:4, 2xxx:4, 4xxx:2, 5xxx:1, and unlocking NOTHING in the degree — came
    // out at 0.00 and was placed in the first term of year 1, ahead of `MATH 2341`.
    //
    // The argument is internal to this function rather than from the corpus, which is
    // what makes it safe. The POOL branch below already answers "which level is this
    // cell about" with a typical value — the modal level of its candidates — and this
    // branch answered it with an extreme. Those are different questions and only one of
    // them is being asked: nobody knows which option a student takes.
    //
    // Median rather than mode, because the option list is small and lumpy and the
    // Supporting Course's mode is a 4–4 tie between levels 1 and 2 that the mode's
    // tie-break resolves back to 0.00.
    //
    // ── Why this cannot disturb anything that was right ──────────────
    //
    // For a cell with ONE option the median IS the minimum, and that is every named
    // cell in the catalog. For a multi-option cell whose options share a level they are
    // also equal. So the only cells that move are heterogeneous choices, and the two
    // that matter are unchanged by construction: `ENGW 1111 or 1102` is all 1000-level
    // so it keeps 0.00 (100% of published plans put first-year writing in year one), and
    // `ENGW 3302 or 3307 or 3315` is all 3000-level so it keeps 0.64 (measured 0.78).
    const t = cell.groups
      .map(g => Math.max(...g.map(id => levelTarget(id, studentType) ?? -1)))
      .filter(v => v >= 0)
      .sort((a, b) => a - b);
    return t.length ? t[Math.floor((t.length - 1) / 2)] : null;
  }
  if (!plan.candidates?.length) return null;
  const counts = new Map();
  for (const id of plan.candidates) {
    const lv = courseLevel(id);
    if (lv) counts.set(lv, (counts.get(lv) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const [lv] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  if (studentType === "graduate" || lv >= GRADUATE_LEVEL) {
    return studentType === "graduate" ? GRADUATE_TARGET : LEVEL_POSITION[4];
  }
  return LEVEL_POSITION[lv];
}

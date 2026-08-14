// ═══════════════════════════════════════════════════════════════════
// CHART · OBJECTIVE — what makes one legal plan better than another
//
// Phase 1 produces a plan that breaks no rule. That is not the same as a plan
// worth following, and the gap between them is the whole reason this engine
// exists: the department's own plans are legal too, and they spend the general
// electives before the first co-op.
//
// ── Three tiers, because most preferences are satisficing ──────────
//
//   constraints  must hold. Phase 1's business, not this file's.
//   thresholds   "at least / at most" — CHECKED and repaired, never maximised.
//                ≥12 SH in a full term. ≤17 SH. ≥1 spare slot.
//   ranked       direction + a tolerance band in its own units.
//
// Thresholds are the tier that does most of the work. "A reasonable load" is a bar,
// not a maximisation; satisficing is cheaper to search and far easier to explain.
// Maximising slack, by contrast, just empties the plan.
//
// ── Why a ranked list and not a weight vector ──────────────────────
//
// A weighted sum has to put "peak course level", "distinct subjects" and "credit
// variance" on one scale. Any such scale is invented, and its numbers get defended
// as though they were measured. A ranked list is also checkable by a student:
// "co-op depth first, then early breadth" is a sentence you can hold a plan up
// against. `(0.4, 0.3, 0.2, 0.1)` is not.
//
// ── Strict lexicographic ordering degenerates, so bands ────────────
//
// If rank 1 is a real-valued score it usually has a single maximum, so ranks 2..n
// never speak — and it will trade away arbitrarily much of rank 2 for a trivial
// gain in rank 1. Each objective therefore carries a TOLERANCE in its own units:
// "within 1 course of the best achievable", "within 1 subject". Lower ranks get
// real room, and the trade is reportable in units the student thinks in.
//
// ── Which principles survive contact with the data ─────────────────
//
// Four ranked objectives, not nine. Most of the candidate list turned out not to
// be a scoring term at all:
//
//   completeness, feasibility     constraints, settled in phase 1
//   purposeful, prioritised       the ranking mechanism itself
//   legibility, adaptivity        properties of the output format
//   proportionality               governs search effort
//   own-bottleneck cost           NO DIFFICULTY DATA EXISTS. No grade
//                                 distributions, no workload. Any "hard term"
//                                 notion would be invented, so it is absent.
//   protect slack                 survives as a THRESHOLD, not a maximisation
//
// And two of the four are computed from evidence this repo already had but was not
// using for sequencing: course level (`courseLevel`) and offering probability.
// ═══════════════════════════════════════════════════════════════════

import { courseLevel, cellLevelTarget, LEVEL_POSITION } from "./prereqDepth.js";
import { witnessPlan } from "./witness.js";
import { termCapacity, termSlotCap, coursesInCell } from "./domains.js";
import { DEFAULT_CALIBRATION, minCoursesFor, termIsFull } from "./calibration.js";
import { unlockUniverse, unlockOfCell, isPoolCell, generatorBar } from "./search.js";
import { GENERAL_ELECTIVE } from "../core/requirementDemand.js";
import { unlockValues } from "./prereqDepth.js";
import { cellSubject, majorSubjectsOf } from "./subjects.js";
import { precedenceViolations, chainHeight } from "./precedence.js";
import { buildContention } from "./witness.js";

/**
 * The default ranking, in order, each with a band in its own units.
 *
 * Three or four is the practical ceiling: each earlier rank consumes the freedom
 * the next one needs, so a fifth is decoration. Offering a ranking of nine that
 * pretends to be meaningful would be worse than offering four that are.
 */
/**
 * Three ranked objectives, and the division of labour that makes them meaningful.
 *
 * The base plan phase 1 hands over is already conventionally shaped — level target
 * within the precedence window, fillers last — so these do not have to establish
 * order, only improve it.
 *
 * `coop-depth` leads because it is the motivating complaint. Departments spend the
 * general electives before the first co-op and students arrive at recruiting with
 * the least major depth they will ever have again. Ranking it first lets it pull
 * major courses earlier, and the band below it is what stops that becoming a plan of
 * 4000-level courses in year 1.
 *
 * `level-order` follows with a band of 2, so it keeps the plan conventional
 * everywhere co-op depth did not need to move something. It must not lead: ranking
 * it first makes CHART imitate the published low-to-high ladder, which is the habit
 * that causes the problem `coop-depth` exists to fix.
 *
 * `chain-first`, `early-breadth` and `interleave` remain available to rank
 * explicitly. They are off by default because each earlier rank consumes the freedom
 * the next needs, so a fourth and fifth are decoration — and because `chain-first`
 * turned out to be phase 1's job rather than an objective: precedence is a hard
 * constraint and the critical path narrows the domains, which is where a chain's
 * claim on early terms actually belongs.
 */
export { LEVEL_POSITION, levelTarget, cellLevelTarget } from "./prereqDepth.js";

export const DEFAULT_PREFERENCES = {
  ranked: [
    { objective: "coop-depth",    tolerance: 1 },   // levels of peak depth before co-op
    { objective: "level-order",   tolerance: 2 },   // courses out of conventional place
    { objective: "robustness",    tolerance: 1 },   // expected missing offerings
  ],
  thresholds: {
    // Full-time status. Scaled by term weight, so a summer half is not held to a
    // full term's floor.
    minTermSH: null,          // null = take it from ports.creditMin
    // Below the registration cap, so the student can add a course without
    // needing an overload petition. `protect slack`, as a bar.
    maxTermSH: null,          // null = ports.creditMax − slackSH
    slackSH: 2,
  },
};

// ── Scoring ────────────────────────────────────────────────────────

/**
 * Every score, for one arrangement. Higher is better in all four, so the search
 * never has to remember which way a metric points.
 *
 * @returns {{coopDepth: number, earlyBreadth: number, robustness: number, interleave: number}}
 */
export function scorePlan({ plans, terms, termOf, boundary, ports, courseMap, heightOf, studentType }) {
  const byTerm = terms.map(() => []);
  for (const p of plans) {
    const ti = termOf.get(p.cell.id);
    if (ti != null) byTerm[ti].push(p);
  }

  // ── chain-first ────────────────────────────────────────────────
  //
  // Σ (chain height × term index), negated. A cell that unlocks a long run of others
  // is expensive to place late; one that unlocks nothing costs nothing wherever it
  // goes. Maximising this races up the prerequisite chains and leaves the leaves for
  // last, which is simultaneously the sequencing fix and the co-op fix.
  //
  // In units of course-terms, so a tolerance of 2 means "within two course-terms of
  // the tightest schedule the chains allow".
  let chainCost = 0;
  for (let ti = 0; ti < terms.length; ti++) {
    for (const p of byTerm[ti]) chainCost += (heightOf?.get(p.cell.id) ?? 0) * ti;
  }

  // ── coop-depth ─────────────────────────────────────────────────
  //
  // The PEAK level reached in the plan's primary subject before the first work term,
  // which is when co-op recruiting happens. A max, not a sum.
  //
  // Summing was wrong and wrong in an instructive way: it rewarded piling many
  // major courses early regardless of how far they got, and it made "one 4000-level
  // course" worth less than "four 1000-level courses". Depth is how far up you
  // reached, so it is the maximum — and 4 is the ceiling, so the metric cannot be
  // gamed by volume.
  //
  // Level rather than prereq depth, because 71% of the catalog has prereq depth 0
  // and so depth cannot tell an introduction from a capstone.
  const primary = primarySubject(plans, courseMap);
  let coopDepth = 0;
  for (let ti = 0; ti < Math.min(boundary, terms.length); ti++) {
    for (const p of byTerm[ti]) {
      if (cellSubject(p, courseMap) !== primary) continue;
      coopDepth = Math.max(coopDepth, cellLevel(p, courseMap));
    }
  }

  // ── level-order ────────────────────────────────────────────────
  //
  // How many cells sit far from where their level conventionally belongs, counted
  // rather than summed so the unit is "courses out of place" and the tolerance reads
  // in courses. `LEVEL_POSITION` is measured from 12,848 published placements.
  //
  // A tolerance band of one third of the plan, because the corpus itself is that
  // loose: 10% of published 1xxx placements sit past the midpoint.
  const span = Math.max(1, terms.length - 1);
  let outOfPlace = 0;
  for (let ti = 0; ti < terms.length; ti++) {
    for (const p of byTerm[ti]) {
      const want = cellLevelTarget(p, courseMap, studentType);
      if (want === null) continue;                  // a filler belongs nowhere
      if (Math.abs(ti / span - want) > 1 / 3) outOfPlace++;
    }
  }

  // ── early-breadth ──────────────────────────────────────────────
  //
  // Distinct subjects in years 1–2. `diversify early` and `decide late` both want
  // this, and it is directly opposed to coop-depth — which is why the trade has to
  // be reported rather than silently resolved.
  const earlySubjects = new Set();
  for (let ti = 0; ti < terms.length; ti++) {
    if ((terms[ti].yearIndex ?? 0) > 1) continue;
    for (const p of byTerm[ti]) {
      const s = cellSubject(p, courseMap);
      if (s) earlySubjects.add(s);
    }
  }

  // ── robustness ─────────────────────────────────────────────────
  //
  // Expected number of cells whose season is a gamble. Σ(1 − offering probability)
  // over the cell's best candidate for that season, negated so higher is better.
  // A cell with no history contributes 0 rather than 1: unknown is not risk, and
  // treating it as risk would penalise 40.8% of the catalog for our own gap.
  let risk = 0;
  for (let ti = 0; ti < terms.length; ti++) {
    for (const p of byTerm[ti]) {
      const best = bestProbability(p, terms[ti].semTypeId, ports);
      if (best !== null) risk += 1 - best;
    }
  }

  // ── interleave ─────────────────────────────────────────────────
  //
  // `interleave, don't block`: penalise a term that is three courses in one
  // subject. Counted as repeats beyond the first per subject per term, negated.
  let repeats = 0;
  for (let ti = 0; ti < terms.length; ti++) {
    const seen = new Map();
    for (const p of byTerm[ti]) {
      const s = cellSubject(p, courseMap) || "?";
      seen.set(s, (seen.get(s) ?? 0) + 1);
    }
    for (const n of seen.values()) repeats += Math.max(0, n - 1);
  }

  return {
    chainFirst: -chainCost,
    coopDepth,
    levelOrder: -outOfPlace,
    earlyBreadth: earlySubjects.size,
    robustness: -risk,
    interleave: -repeats,
  };
}

const KEY = {
  "chain-first": "chainFirst",
  "coop-depth": "coopDepth",
  "level-order": "levelOrder",
  "early-breadth": "earlyBreadth",
  "robustness": "robustness",
  "interleave": "interleave",
};

// `cellSubject` lived here as a second, character-for-character-different but
// behaviourally identical copy of `subjects.js`'s. Deleted rather than called from a
// third place: search.js decides "is this a major subject" from subjects.js, and two
// copies of that judgement would let the search and the objective disagree about which
// cells are the major — silently, and only after one of them was edited.

/** How advanced a cell is: the level of its lowest option, since that is what a student could legitimately take. */
function cellLevel(plan, courseMap) {
  const cell = plan.cell ?? plan;
  if (cell.groups?.length) {
    return Math.min(...cell.groups.map(g => Math.max(...g.map(courseLevel))));
  }
  if (!plan.candidates?.length) return 0;
  let min = Infinity;
  for (const id of plan.candidates) min = Math.min(min, courseLevel(id));
  return Number.isFinite(min) ? min : 0;
}

/**
 * The plan's primary subject — the modal subject of its forced cells.
 *
 * "Primary subject" is undefined for a combined degree (Computer Science AND
 * Mathematics), and pretending otherwise is how a metric becomes meaningless. The
 * forced cells are the honest evidence: whatever the program names outright most
 * often is what it is mostly about. For a genuinely even combined major the
 * tie-break is alphabetical and the metric measures one half of it — a stated
 * limitation, not a hidden one.
 */
export function primarySubject(plans, courseMap) {
  const counts = new Map();
  for (const p of plans) {
    if (p.cell.kind !== "named") continue;
    for (const id of p.cell.groups?.[0] ?? []) {
      const s = courseMap[id]?.subject;
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/** The most likely of a cell's candidates to actually run in that season. */
function bestProbability(plan, semTypeId, ports) {
  const ids = plan.candidates;
  if (!ids?.length) return null;                 // admits anything — no risk to price
  let best = null;
  for (const id of ids) {
    const p = ports.offeringProbability(id, semTypeId);
    if (p === null) continue;
    if (best === null || p > best) best = p;
    if (best === 1) break;
  }
  return best;
}

// ── Thresholds ─────────────────────────────────────────────────────

/**
 * Which bars an arrangement fails. Reported, and repaired where a legal move
 * exists — never scored, because a bar is not a direction.
 */
export function checkThresholds({ plans, terms, termOf, ports, studentType, thresholds, cal = DEFAULT_CALIBRATION }) {
  const min = thresholds.minTermSH ?? ports.creditMin(studentType);
  const cap = ports.creditMax(studentType);
  const max = thresholds.maxTermSH ?? (cap - (thresholds.slackSH ?? 0));
  const load = terms.map(() => 0);
  // Courses of at least 3 SH, counted separately from credit: "four courses" and
  // "sixteen credits" are different claims and only the first is the rule below.
  const big = terms.map(() => 0);
  // Credit held by real courses — what `termIsFull` measures its slack against.
  const bigSH = terms.map(() => 0);
  for (const p of plans) {
    const ti = termOf.get(p.cell.id);
    if (ti == null) continue;
    load[ti] += p.cell.sh ?? 0;
    if ((p.cell.sh ?? 0) >= cal.realCourseSH) { big[ti] += 1; bigSH[ti] += p.cell.sh ?? 0; }
  }
  const failures = [];
  terms.forEach((t, ti) => {
    const w = t.weight ?? 1;
    // An EMPTY term is not a full-time-status failure — it is a term the student
    // is not enrolled in, which is a different thing and not CHART's to forbid.
    if (load[ti] > 0 && load[ti] < min * w) {
      failures.push({ kind: "below-full-time", term: ti,
                      label: label(t), sh: load[ti], need: min * w });
    }
    // Slack applies to FULL terms only. A summer half's cap is already 9.5, and
    // subtracting two more made 8.5 the bar — which flagged the 9 SH summers the
    // published plans themselves print, in 22% of generated plans. A threshold
    // that fires on what the departments do is measuring the wrong thing.
    //
    // And where the shape is a PUBLISHED plan, its own per-term target outranks the
    // comfort bar. CS+Math prints 19 SH in its first term; telling a student that
    // their department's own stated load is uncomfortable is not advice, it is
    // noise, and it fired on half of all generated plans.
    const bar = w >= 1 ? max : cap * w;
    const comfortable = Math.max(bar, t.targetSH || 0);
    if (load[ti] > comfortable) {
      failures.push({ kind: "above-comfortable-load", term: ti,
                      label: label(t), sh: load[ti], limit: comfortable });
    }
    // ── Four real courses in every full fall and spring ─────────────
    //
    // MEASURED over 3,941 published full fall/spring terms: 97.7% carry four cells or
    // more, and 95.8% carry four of at least 3 SH. It is not a tendency, it is how a
    // degree is built — the credit total is designed so four courses a term over eight
    // full terms arrives at the degree.
    //
    // CHART broke it in 13.0% of full terms against their 2.3%, and the shape of the
    // error is always the same: a course sits in a half-summer while a fall runs three
    // deep. That is the wrong way round — a summer is optional and a fall is not.
    //
    // ── Why a threshold and not a hard constraint ───────────────────
    //
    // Because the 4.2% of published exceptions are real and not noise: they are
    // architecture and art, where one studio course IS 16 credits and there is no fourth
    // course to add. A hard rule would refuse those programs outright, and refusing a
    // degree over a rule its own department does not follow is the failure this codebase
    // keeps paying for. So it is checked, reported, and repaired by moving cells — and
    // where it cannot be met it is stated rather than hidden.
    //
    // Cells of under 3 SH do not count toward the four. A one-credit lab and a course
    // are not two courses, and the corpus bar is explicitly four of >= 3 SH.
    const minCourses = minCoursesFor(cal, studentType);
    // Credit-aware: a term with no room for another real course is full, whatever its count.
    if (w >= 1 && load[ti] > 0 && minCourses > 0
        && !termIsFull(big[ti], load[ti], bar, cal, studentType, bigSH[ti])) {
      failures.push({ kind: "full-term-under-four", term: ti,
                      label: label(t), courses: big[ti], need: minCourses });
    }
  });
  return { failures, load };
}

// `FULL_TERM_MIN_COURSES` and `REAL_COURSE_SH` live in domains.js with the other
// measured bounds. Defining them here made search.js import objective.js while
// objective.js imports search.js — a cycle that happens to survive because both are read
// inside functions, which is not a reason to keep it.

const label = (t) => `${t.label ?? ""} ${t.termLabel ?? ""}`.trim();

// ── Improvement ────────────────────────────────────────────────────

/**
 * Local search: move one cell at a time, keeping every hard constraint, accepting
 * a move that improves the ranked objectives within their bands.
 *
 * Not branch-and-bound. Planning effort should match stakes, and an optimal plan
 * is not worth an intractable solve when the student will edit it anyway. The
 * bands are also what make this terminate cheaply — each rank searches a shrinking
 * region rather than the whole space.
 *
 * ── The bands need a "best achievable", and it is computed ──────────
 *
 * "Within 1 course of the best achievable" requires knowing the best achievable,
 * which means optimising each ranked objective ALONE first. That is N extra hill
 * climbs before the banded pass — cheap at this size, and it is what makes the
 * band a real bound rather than a number.
 */
/**
 * Trials the improvement phase may evaluate, in total.
 *
 * Counted in WORK, not wall-clock. A time budget here made generation
 * nondeterministic — the same program did a different number of moves on a loaded
 * machine, so two runs produced two plans — and byte-identical output is a hard
 * requirement, not a nicety: the diff review the data workflows depend on becomes
 * noise without it.
 *
 * Sized from measurement: a median program takes 3 accepted moves and a p90 of 14,
 * and each pass over ~35 cells × ~10 terms is ~350 trials. 20,000 is roughly six
 * full passes per hill climb across five climbs, which is more than the search has
 * ever needed and still bounded.
 */
export const DEFAULT_IMPROVE_TRIALS = 20000;

export function improve({
  plans, terms, termOf, ports, studentType, courseMap, repeatable,
  preferences = DEFAULT_PREFERENCES, boundary, depthOf, precedence = null,
  trialBudget = DEFAULT_IMPROVE_TRIALS, shape = null, cal = DEFAULT_CALIBRATION,
}) {
  // Chain height drives the leading objective, and it is a property of the
  // precedence graph rather than of any one arrangement, so it is computed once.
  const heightOf = precedence ? chainHeight(plans, precedence) : new Map();
  const ranked = (preferences.ranked ?? []).filter(r => KEY[r.objective]);
  const thresholds = { ...DEFAULT_PREFERENCES.thresholds, ...(preferences.thresholds ?? {}) };
  const byId = new Map(plans.map(p => [p.cell.id, p]));
  const cap = terms.map(t => termCapacity(t, { creditMax: ports.creditMax, studentType }));

  const ctx = { plans, terms, boundary, ports, courseMap, heightOf, studentType };
  // Cheap: capacity is checked by the caller, so this is precedence alone.
  const cheapLegal = (assignment) =>
    !precedence || precedenceViolations(precedence, assignment).length === 0;
  // Established once, from the plan phase 1 handed over: phase 2 may never make it worse.
  const maxThin = thinFullTerms(termOf, plans, terms, studentType, cal, cap);
  const fullLegal = (assignment) =>
    isLegal({ plans, terms, termOf: assignment, cap, courseMap, repeatable, ports, byId,
              precedence, shape, maxThin, studentType, cal });

  // One shared budget across every climb, so total work is bounded regardless of how
  // many objectives are ranked.
  const budget = { left: trialBudget };
  const climb = (from, score) =>
    hillClimb(from, score, cheapLegal, fullLegal, plans, terms, cap, { budget, shape });

  let current = new Map(termOf);
  let moves = 0;

  // ── The ceiling for each objective, alone ───────────────────────
  const ceilings = new Map();
  for (const { objective } of ranked) {
    const key = KEY[objective];
    const solo = climb(current, (a) => scorePlan({ ...ctx, termOf: a })[key]);
    ceilings.set(objective, scorePlan({ ...ctx, termOf: solo.termOf })[key]);
    moves += solo.moves;
  }

  // ── Then the banded pass, rank by rank ──────────────────────────
  //
  // Each rank optimises its own objective subject to every earlier rank staying
  // inside its band. So rank 2 has real room, and cannot be starved by a trivial
  // gain in rank 1.
  const withinBands = (assignment, upTo) => {
    const s = scorePlan({ ...ctx, termOf: assignment });
    for (let i = 0; i < upTo; i++) {
      const { objective, tolerance } = ranked[i];
      if (s[KEY[objective]] < ceilings.get(objective) - (tolerance ?? 0)) return false;
    }
    return true;
  };

  for (let r = 0; r < ranked.length; r++) {
    const key = KEY[ranked[r].objective];
    const res = hillClimb(
      current,
      (a) => scorePlan({ ...ctx, termOf: a })[key],
      // A band is cheap to evaluate and belongs in the screening filter: a trial
      // outside an earlier rank's band is not a candidate at all.
      (a) => cheapLegal(a) && withinBands(a, r),
      fullLegal,
      plans, terms, cap, { budget, shape },
    );
    current = res.termOf;
    moves += res.moves;
  }

  // ── Trade a terminal requirement for major depth ────────────────
  //
  // A DELIBERATE departure from the published plans, and the only one CHART makes.
  // Measured over 195 published plans, departments place major-subject elective pools at
  // median position 0.67 and general electives at 0.56 — their major electives come
  // LATER than their free ones, behind requirements that unlock nothing. A `Number
  // Theory 1` in term 2 and a `Khoury Approved Elective` in term 9 is a plan that shows
  // a co-op recruiter the least major depth it ever will.
  //
  // Why this is not left to the ranked objectives: `coop-depth` only counts what sits
  // before the FIRST work term, so a trade between terms 5 and 9 scores zero on it and
  // the hill climber has no reason to make it. And it is a SWAP, not a move — pulling
  // the pool forward alone breaks the term's target, so a one-cell climber cannot reach
  // it either. Measured, 52.9% of programs had at least one such trade available and
  // untaken.
  //
  // Every trade is verified by the same `fullLegal` the climber uses, so the witness,
  // precedence and availability all still hold; an unverifiable trade is skipped rather
  // than forced.
  const traded = tradeDepth(current, { plans, terms, cap, courseMap, fullLegal, cal });
  current = traded.termOf;
  moves += traded.moves;

  // ── Then fill every full fall and spring to four ────────────────
  //
  // After the trade, because a trade moves cells between terms and would otherwise undo
  // this; before the threshold repair, because a term left thin here is exactly what that
  // repair should then report. See `fillFullTerms` for why this cannot be a preference.
  const packed = fillFullTerms(current, { plans, terms, cap, fullLegal, studentType, cal });
  current = packed.termOf;
  moves += packed.moves;

  // ── Then take the early terms back from the fillers ─────────────
  //
  // After the fill, because a fill moves cells between terms and would undo a swap; before
  // availability, because a course actually running in a season is closer to a hard fact than
  // earliness is, so it gets the last word between the two swaps. See `reclaimFromFiller`.
  const reclaimed = reclaimFromFiller(current, {
    plans, terms, cap, fullLegal, courseMap, studentType, cal,
  });
  current = reclaimed.termOf;
  moves += reclaimed.moves;

  // ── Then spend the electives to settle availability ─────────────
  //
  // Last of the swaps, and the order is the argument: a swap preserves each term's course
  // count exactly, so it cannot undo the fill above, while a fill moves cells between
  // terms and would undo a swap. See `swapForAvailability`.
  const settled = swapForAvailability(current, { plans, terms, cap, ports, fullLegal, cal });
  current = settled.termOf;
  moves += settled.moves;

  // ── Repair thresholds last ──────────────────────────────────────
  //
  // Last because a threshold is a bar: satisfying it is worth giving up ranked
  // score for, and doing it first would let the ranked passes undo it.
  const before = checkThresholds({ plans, terms, termOf: current, ports, studentType, thresholds, cal });
  let repaired = current;
  if (before.failures.length) {
    const res = climb(
      current,
      (a) => -checkThresholds({ plans, terms, termOf: a, ports, studentType, thresholds, cal }).failures.length,
    );
    repaired = res.termOf;
    moves += res.moves;
  }

  const finalScores = scorePlan({ ...ctx, termOf: repaired });
  const after = checkThresholds({ plans, terms, termOf: repaired, ports, studentType, thresholds, cal });

  // What each rank gave up, in its own units — so a considered trade is
  // distinguishable from a bug.
  const trades = ranked
    .map(({ objective, tolerance }) => ({
      objective,
      best: ceilings.get(objective),
      got: finalScores[KEY[objective]],
      gaveUp: ceilings.get(objective) - finalScores[KEY[objective]],
      tolerance: tolerance ?? 0,
      units: UNITS[objective],
    }))
    .filter(t => t.gaveUp > 0);

  return {
    termOf: repaired, moves, scores: finalScores,
    thresholds: after.failures, trades,
    // Which major electives were pulled ahead of a low-unlock requirement, and from
    // where. Reported because it is the one place CHART deliberately departs from the
    // published plans, and a departure a student cannot see is one they cannot judge.
    depthTrades: traded.applied,
    // Which requirements took an early term back from a general elective. Reported for the
    // same reason: this is the pass that answers the complaint CHART exists for, so its
    // effect has to be countable rather than asserted.
    reclaimed: reclaimed.applied,
    reasons: reasonsFor({ plans, terms, termOf: repaired, byId, depthOf, ports, trades }),
  };
}

// Every objective needs one, or a reported trade reads "3 undefined". The whole
// point of a band is that the sacrifice is stated in units the student thinks in.
const UNITS = {
  "chain-first": "course-terms of delay in the prerequisite chains",
  "coop-depth": "levels of major depth before co-op",
  "level-order": "courses away from their conventional year",
  "early-breadth": "distinct subjects in years 1–2",
  "robustness": "expected unavailable offerings",
  "interleave": "same-subject repeats within a term",
};

/**
 * Steepest-ascent hill climb over single-cell moves.
 *
 * Single moves only, not swaps: a swap is two moves, and with capacity as the
 * binding constraint the intermediate state of a swap is usually illegal, so
 * offering swaps would mean relaxing legality mid-move. Bounded by a pass limit
 * because a plateau with equal-scoring moves could otherwise cycle.
 *
 * ── Two legality checks, because one of them is expensive ───────────
 *
 * The first version ran the full prereq-aware witness on every TRIAL. Nine hill
 * climbs × 6 passes × ~35 cells × ~10 terms is ~19,000 witnesses, and it showed up
 * exactly where you would expect: search nodes stayed at a median of 34 while
 * wall-clock went to a median of 4.9 seconds and a p90 of 21.
 *
 * So a trial is screened by the CHEAP invariants — term capacity and precedence,
 * both map lookups — and the full witness runs only when a move is about to be
 * COMMITTED. Accepted moves are a median of 5 per program, so the expensive check
 * runs five times instead of nineteen thousand. If the witness then rejects the
 * move, it is simply not taken; the plan that phase 1 produced was already legal,
 * so there is always a legal state to stay in.
 */
function hillClimb(start, score, cheapLegal, fullLegal, plans, terms, cap,
                   { maxPasses = 6, budget = { left: Infinity }, shape = null } = {}) {
  let current = new Map(start);
  let best = score(current);
  let moves = 0;
  // Deterministic order: two runs must produce the same plan.
  const ordered = [...plans].sort((a, b) => String(a.cell.id).localeCompare(String(b.cell.id)));

  for (let pass = 0; pass < maxPasses; pass++) {
    let improvedThisPass = false;
    for (const p of ordered) {
      if (budget.left <= 0) return { termOf: current, moves, exhausted: true };
      const from = current.get(p.cell.id);
      if (from == null) continue;
      let bestTerm = from, bestScore = best;
      for (const ti of p.domain) {
        if (ti === from) continue;
        budget.left--;
        const trial = new Map(current);
        trial.set(p.cell.id, ti);
        if (!fitsCapacity(trial, plans, terms, cap, shape)) continue;
        if (!cheapLegal(trial)) continue;
        const s = score(trial);
        if (s > bestScore) { bestScore = s; bestTerm = ti; }
      }
      if (bestTerm === from) continue;
      // Only now, on the one move worth taking, pay for the witness.
      const trial = new Map(current);
      trial.set(p.cell.id, bestTerm);
      if (!fullLegal(trial)) continue;
      current = trial;
      best = bestScore;
      moves++;
      improvedThisPass = true;
    }
    if (!improvedThisPass) break;
  }
  return { termOf: current, moves };
}

/**
 * Move a course to a season it is KNOWN to run in, spending a general elective to do it.
 *
 * ── Unknown is not the same as barred, and both matter ──────────────
 *
 * A season a course has never been recorded in is barred outright — `offeringProbability`
 * returns 0 and the domain never contained that term. What survives is the UNKNOWN case:
 * 40.8% of the catalog has no offering history at all, `semTypeProb` returns null, and the
 * engine reads null as allowed because the alternative is refusing to schedule 40% of the
 * catalog. The UI is more honest with the student than the engine was with itself and
 * draws `offered?`.
 *
 * So the plan is legal and the student still sees a warning. Measured, 12.0% of named
 * placements sat in a season with no history for that course.
 *
 * ── Why a general elective is the right thing to spend ──────────────
 *
 * Because it is the only cell in the plan with NO season constraint whatsoever. A general
 * elective is an unbounded pool — its candidate list is `null`, meaning it admits any
 * course — so whatever season it lands in, some course answers it. Every other cell is
 * narrower. That makes the electives a buffer in the strict sense: they can absorb an
 * awkward slot at zero cost, which is exactly what a free elective is for.
 *
 * A SWAP rather than a move, and both halves matter: moving the course alone would empty
 * the slot it leaves and break the four-courses-per-full-term rule the pass before this
 * one just established. Trading with a cell of its own size keeps every term's course
 * count identical, so this pass cannot undo that one.
 *
 * Verified against the full witness like every other pass here. A swap that would create
 * an order or distinctness problem is not made, and the warning stays — degrade to less
 * information, never to a wrong plan.
 *
 * @returns {{termOf: Map, moves: number, swapped: object[]}}
 */
export function swapForAvailability(termOf, { plans, terms, cap, ports, fullLegal, cal = DEFAULT_CALIBRATION }) {
  const prob = (id, ti) => ports.offeringProbability(id, terms[ti].semTypeId);
  /** Is this cell's answer provably offered where it sits? */
  const known = (p, ti) => {
    const groups = p.cell.groups;
    if (!groups?.length) return true;         // a pool always has an answer; see above
    return groups.some(g => g.every(id => (prob(id, ti) ?? 0) > 0));
  };
  const isBig = (p) => (p.cell.sh ?? 0) >= cal.realCourseSH;
  // The buffer: unbounded pools only. A BOUNDED pool has a candidate list and therefore a
  // season constraint of its own, so spending it can move the problem rather than solve it.
  const buffers = plans.filter(p => p.candidates === null && isBig(p));
  if (!buffers.length) return { termOf, moves: 0, swapped: [] };

  let current = new Map(termOf);
  const swapped = [];
  let moves = 0;

  for (const p of plans) {
    const at = current.get(p.cell.id);
    if (at == null || !p.cell.groups?.length || known(p, at)) continue;
    // Somewhere this course is actually recorded as running, and it must be a term this
    // cell could legally occupy in the first place.
    for (const to of p.domain) {
      if (to === at || !known(p, to)) continue;
      const buf = buffers.find((b) => {
        const bAt = current.get(b.cell.id);
        return bAt === to && b.domain.includes(at) && (b.cell.sh ?? 0) === (p.cell.sh ?? 0);
      });
      if (!buf) continue;
      const trial = new Map(current);
      trial.set(p.cell.id, to);
      trial.set(buf.cell.id, at);
      if (!fitsCapacity(trial, plans, terms, cap)) continue;
      if (!fullLegal(trial)) continue;
      current = trial;
      moves += 1;
      swapped.push({ cell: p.cell.title ?? "", from: at, to, buffer: buf.cell.title ?? "" });
      break;
    }
  }
  return { termOf: current, moves, swapped };
}

/**
 * Fill every full fall and spring to four real courses, by moving cells that can move.
 *
 * ── Why this is a pass and not a preference ─────────────────────────
 *
 * Four courses in every full term is not a taste, it is how a degree is built: 97.7% of
 * 3,941 published full terms carry four cells or more. And MEASURED over 94 programs, of
 * the 50 with a thin term, **0** were short of courses and **50** had courses sitting
 * somewhere else. It was never arithmetic. It was always a move that nothing made.
 *
 * Four attempts to get there by ordering all failed, and the last one showed why any
 * such attempt must:
 *
 *   `PHYS 1151` sat alone in a Summer B while the final Spring held three courses and an
 *   empty slot. Moving it fixes both. But PHYS 1151 is a 1000-level course, so its level
 *   target is 0.00, and that Summer B is CLOSER to 0.00 than the final Spring is. Every
 *   level-aware comparator therefore prefers the summer, correctly by its own lights, and
 *   the under-filled tie-break is never reached because the two terms do not tie.
 *
 * A preference expresses where a cell would LIKE to go. This rule is about a property of
 * the finished grid, and no amount of per-cell preference guarantees a global property.
 * So it is checked and repaired directly, exhaustively, until no legal move remains.
 *
 * ── What it will not do ─────────────────────────────────────────────
 *
 * It never robs a full term that needs its own four, never exceeds a term's credit cap,
 * and verifies every move against the full prereq-aware witness before keeping it. So it
 * cannot introduce the order or availability errors that a plan must never have — a move
 * that would is simply not made, and the term stays thin and is reported.
 *
 * @returns {{termOf: Map, moves: number, filled: object[]}}
 */
export function fillFullTerms(termOf, { plans, terms, cap, fullLegal, maxPasses = 4,
                                        studentType = "undergraduate", cal = DEFAULT_CALIBRATION }) {
  // No bar, nothing to fill. Graduate plans have no four-course convention — measured, 39%
  // of their published full terms carry zero or one course — so this pass would be moving
  // cells to satisfy a rule their own departments do not follow.
  const minCourses = minCoursesFor(cal, studentType);
  if (minCourses <= 0) return { termOf, moves: 0, filled: [] };
  let current = new Map(termOf);
  const isBig = (p) => (p.cell.sh ?? 0) >= cal.realCourseSH;
  const big = terms.map(() => 0);
  const load = terms.map(() => 0);
  const bigSH = terms.map(() => 0);
  for (const p of plans) {
    const ti = current.get(p.cell.id);
    if (ti == null) continue;
    load[ti] += p.cell.sh ?? 0;
    if (isBig(p)) { big[ti] += 1; bigSH[ti] += p.cell.sh ?? 0; }
  }

  const filled = [];
  let moves = 0;

  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (let t = 0; t < terms.length; t++) {
      const w = terms[t].weight ?? 1;
      // Half terms are half a term and hold two; an EMPTY full term is a term the student
      // is not enrolled in, which is a different thing and not this rule's business.
      if (w < 1 || load[t] === 0) continue;

      // ── Make room by moving a LAB out, not by giving up ─────────────
      //
      // A term can be short of its four real courses and have no credits left for another,
      // because one- and two-credit cells got there first. International Business Spring
      // 2027 is the case: `BUSN 1103` and two 2 SH `INTB` courses take five credits, the
      // term sits at 17 of 19, and the fourth real course cannot fit. The loop below would
      // simply find no legal donor and move on, leaving a term that is short AND full.
      //
      // So before giving up, try evicting a small cell to somewhere that already has its
      // four. That is where labs and seminars belong anyway, and it is the only direction
      // that helps: the four-course bar is what a full term is for, and credits limit the
      // extras rather than defining it.
      //
      // Safe by construction, which is why it is here and not in the placement loop. Every
      // move is checked by `fullLegal` and skipped if it fails, so this can only ever
      // rearrange a plan that already exists — it cannot turn one into a refusal, which is
      // exactly what the same rule did when it was written as a veto during placement.
      if (!termIsFull(big[t], load[t], cap[t], cal, studentType, bigSH[t])
          && load[t] + cal.realCourseSH > cap[t] + 0.01) {
        for (const p of plans) {
          if (current.get(p.cell.id) !== t || isBig(p)) continue;
          const sh = p.cell.sh ?? 0;
          const to = p.domain.find(d => d !== t && (terms[d].weight ?? 1) >= 1
            && big[d] >= minCourses && load[d] + sh <= cap[d]);
          if (to == null) continue;
          const trial = new Map(current);
          trial.set(p.cell.id, to);
          if (!fitsCapacity(trial, plans, terms, cap) || !fullLegal(trial)) continue;
          current = trial;
          load[t] -= sh; load[to] += sh;
          moves += 1; changed = true;
          break;                          // one eviction, then re-test the term
        }
      }

      while (!termIsFull(big[t], load[t], cap[t], cal, studentType, bigSH[t])) {
        let donor = null;
        // `plans` order is deterministic, so the same input yields the same plan.
        for (const p of plans) {
          const from = current.get(p.cell.id);
          if (from == null || from === t || !isBig(p)) continue;
          if (!p.domain.includes(t)) continue;
          // Never solve one thin term by creating another.
          if ((terms[from].weight ?? 1) >= 1 && big[from] <= minCourses) continue;
          if (load[t] + (p.cell.sh ?? 0) > cap[t]) continue;
          const trial = new Map(current);
          trial.set(p.cell.id, t);
          if (!fitsCapacity(trial, plans, terms, cap)) continue;
          if (!fullLegal(trial)) continue;
          donor = { p, from, trial };
          break;
        }
        if (!donor) break;                     // nothing can legally move; report it
        const sh = donor.p.cell.sh ?? 0;
        current = donor.trial;
        big[t] += 1; load[t] += sh; bigSH[t] += sh;
        // `bigSH` has to be unwound on BOTH sides. Added to the receiver and not subtracted
        // from the donor, the donor's real-course credit only ever grows, so `termIsFull`
        // reads it as fuller than it is and it is never refilled — a term can be drained and
        // then skipped by the very loop that exists to fill it.
        big[donor.from] -= 1; load[donor.from] -= sh; bigSH[donor.from] -= sh;
        moves += 1;
        changed = true;
        filled.push({ cell: donor.p.cell.title ?? "", from: donor.from, to: t });
      }
    }
    if (!changed) break;
  }
  return { termOf: current, moves, filled };
}

/**
 * Swap major-subject elective pools earlier, past requirements that unlock nothing.
 *
 * Greedy, largest gain first, each swap verified before it is kept. Greedy is right here
 * rather than a search: the trades are near-independent (each frees the term it vacates)
 * and a swap that turns out illegal is simply skipped, so there is no branch to explore.
 *
 * @returns {{termOf: Map, moves: number, applied: object[]}}
 */
export function tradeDepth(termOf, { plans, terms, cap, courseMap, fullLegal, cal = DEFAULT_CALIBRATION }) {
  const unlockValue = unlockValues(unlockUniverse(plans), courseMap);
  const majors = majorSubjectsOf(plans, courseMap);
  const bar = generatorBar(plans, courseMap, unlockValue, majors);
  const pools = plans.filter(p =>
    p.reachAt && isPoolCell(p) && majors.has(cellSubject(p, courseMap)));
  // The same bar the search uses, so the two cannot disagree about which requirement is
  // worth trading away. A zero bar here found almost nothing to trade: the courses a
  // student would call low-value mostly unlock one or two pool candidates, not none.
  const flats = plans.filter(p =>
    p.cell.groups && !isPoolCell(p) && unlockOfCell(p, unlockValue) < bar);
  if (!pools.length || !flats.length) return { termOf, moves: 0, applied: [] };

  let current = new Map(termOf);
  const applied = [];
  let moves = 0;

  // Largest earliness gain first, so a pool that can come forward four terms is not
  // blocked by one that only gains one.
  const pairs = [];
  for (const pool of pools) {
    for (const flat of flats) {
      const j = current.get(pool.cell.id), i = current.get(flat.cell.id);
      if (i == null || j == null || i >= j) continue;
      pairs.push({ pool, flat, gain: j - i });
    }
  }
  pairs.sort((a, b) => b.gain - a.gain
    || String(a.pool.cell.id).localeCompare(String(b.pool.cell.id))
    || String(a.flat.cell.id).localeCompare(String(b.flat.cell.id)));

  for (const { pool, flat } of pairs) {
    const j = current.get(pool.cell.id), i = current.get(flat.cell.id);
    if (i == null || j == null || i >= j) continue;              // moved by an earlier trade
    if (!pool.domain.includes(i) || !flat.domain.includes(j)) continue;
    // The share bar is what stops "earlier" being nominal: a pool with one reachable
    // candidate is not an elective, however early it sits.
    if ((pool.reachAt[i] ?? 1) < cal.poolReachMin) continue;
    const trial = new Map(current);
    trial.set(pool.cell.id, i);
    trial.set(flat.cell.id, j);
    if (!fitsCapacity(trial, plans, terms, cap)) continue;
    if (!fullLegal(trial)) continue;
    current = trial;
    moves++;
    applied.push({ pool: pool.cell.title ?? "", flat: flat.cell.title ?? "", from: j, to: i });
  }
  return { termOf: current, moves, applied };
}

/**
 * A requirement takes an early term back from a filler.
 *
 * ── The defect, measured ────────────────────────────────────────────
 *
 * Computer Science BSCS, as generated before this existed: SIX general electives in the three
 * terms before the first co-op (one whole 8 SH summer half was nothing else), and the 8 SH
 * `Science Requirement` in term 13, after both co-ops. That is the exact complaint CHART was
 * built to fix — "departments spend the general electives before the first co-op" — committed
 * by CHART.
 *
 * ── Why no existing mechanism reaches it ────────────────────────────
 *
 * Not for want of trying, and the three near-misses are the argument for this one:
 *
 * 1. `byConstraint` already puts fillers last, "unconditionally", as its FIRST key. But branch
 *    order is not plan position: fillers are placed last into whatever gaps remain, and a
 *    bounded cell that chose a late term while an early one was still open is never revisited.
 * 2. The elective RESERVE actively causes it. `fill()` charges a non-filler `target - reserve`
 *    and a filler the full `target`, so every early term looks fuller than it is to the very
 *    cells that have a claim on it. The mechanism built so electives would not be squeezed into
 *    year 4 is what puts a real requirement there and hands the elective the early slot.
 * 3. `tradeDepth` cannot see either end of this swap. Its backward candidates need
 *    `cell.groups`, and a general elective's groups are `null`; its forward candidates must be
 *    a MAJOR-subject pool, and `Science Requirement` is BIOL/CHEM. Both ends invisible.
 *
 * And the one-cell hill climber cannot reach it either, for the same reason `tradeDepth` is a
 * swap: pulling Science into term 2 alone overflows a term already at 17 SH with four entries,
 * so every intermediate single move is illegal even though the endpoint is fine.
 *
 * ── Why it is a dominance rule and not a preference ─────────────────
 *
 * A filler admits the whole catalog: no pool, no prerequisites of its own, no season it must
 * run in. It is therefore STRICTLY the most flexible cell in the plan — any term it can
 * occupy, it can also occupy later. A bounded cell has candidates carrying their own
 * prerequisites and seasons, so deferring it accumulates real risk: fewer remaining terms in
 * which its candidates are offered, and less room to reschedule if one is not.
 *
 * So this is least-slack-first, and the exchange is dominated rather than merely preferred:
 * giving the strictly-more-flexible cell the earlier slot is never the better plan. It needs no
 * weights, no aggregate over a pool's candidates, and no institution knowledge — which is what
 * makes it survive where unlock value did not. Measured on this program, the science pool gates
 * 5 in-plan candidates against CS Fundamentals' 39, and 40 of its 44 candidates gate nothing,
 * so no aggregate of unlock value would have moved it: mean 0.3, min 0.
 *
 * ── Termination ─────────────────────────────────────────────────────
 *
 * Σ(term index) over bounded cells is a non-negative integer and each accepted swap decreases
 * it by exactly `gain > 0`, so the pass cannot cycle. Every swap is verified by the same
 * `fullLegal` every other mutation uses, so the witness, precedence, availability and the thin
 * -term budget all still hold — and because it only ever transforms a plan that was already
 * accepted, and keeps the original when a swap does not verify, it cannot turn a plan into a
 * refusal.
 */
export function reclaimFromFiller(termOf, {
  plans, terms, cap, fullLegal, courseMap, studentType = "undergraduate",
  cal = DEFAULT_CALIBRATION,
}) {
  const fillers = plans.filter(p => p.candidates === null);
  const bounded = plans.filter(p => p.candidates !== null);
  if (!fillers.length || !bounded.length) return { termOf, moves: 0, applied: [] };

  let current = new Map(termOf);
  const applied = [];
  let moves = 0;

  // ── Evicting a filler must not pile them up somewhere else ─────────
  //
  // The pass takes early terms from fillers, so the fillers have to land later, and left
  // unchecked they land TOGETHER: Computer Science BSCS came out with four general electives
  // in one spring term, and corpus-wide "3+ cells of one requirement in a term" went from 6.4%
  // to 11.1% against the departments' 0.7%. A final term that is nothing but placeholders is
  // not an improvement on a plan that spread them out, whatever the mean position says.
  //
  // So the incoming plan sets the ceiling and this pass may not exceed it — the same
  // non-erosion shape as `maxThin`, and for the same reason: phase 1 handed over a plan whose
  // filler spread was acceptable, so acceptable is defined as "no worse than that".
  const fillerIds = new Set(fillers.map(p => p.cell.id));
  const fillersIn = (assignment, ti) => {
    let n = 0;
    for (const id of fillerIds) if (assignment.get(id) === ti) n++;
    return n;
  };
  let maxFillers = 0;
  for (let ti = 0; ti < terms.length; ti++) maxFillers = Math.max(maxFillers, fillersIn(termOf, ti));

  // ── The convention is a FLOOR, and the asymmetry is the whole point ──
  //
  // Two wrong versions preceded this one, both instructive:
  //
  // 1. Distance from home, truncated to whole terms the way `termPreference` does it. The
  //    truncation is deliberate THERE — it manufactures the ties the elective reserve needs to
  //    bite at all — and it silently disabled the guard here: `Advanced Writing in the
  //    Disciplines` (home 0.64) sat 3.76 terms from home at study term 2 and 3.24 at study
  //    term 9, and `Math.floor` made both 3, so eroding the convention read as "no worse".
  // 2. Exact distance from home. Correct arithmetic, wrong question: home 0.64 of ten study
  //    terms is term 5.8, so term 3 genuinely IS closer than term 9 — and the pass moved a
  //    3000-level writing course into the summer of year one on that reasoning.
  //
  // Late and early are not symmetric. A course sitting LATER than convention is harmless: the
  // student has more standing and more prerequisites behind them than the course expects.
  // Sitting EARLIER is the failure, because that is precisely when the gates nobody recorded
  // bite — "junior standing or above" lives in prose that `RESTRICTION_ONLY` discards. So the
  // convention bounds this pass from below and says nothing from above.
  //
  // One term of slack, because `LEVEL_POSITION` is a median over 12,848 placements and ±1 term
  // is inside its own noise — and because a strict floor would refuse the case this pass exists
  // for, a 1000-level science pool whose home is 1.17 arriving at term 1.
  const span = Math.max(1, terms.length - 1);
  const beforeConvention = (ti, want) => ti < want * span - 1;

  // ── Who wins a scarce early slot: convention, not distance travelled ──
  //
  // The first version ranked by earliness GAIN, and that ranks by where a cell happens to have
  // been put rather than by where it belongs. Measured on Computer Science BSCS, the four
  // reclaimed slots went to `Presentation Requirement`, `Computing and Social Issues`,
  // `Advanced Writing in the Disciplines` and `Electrical Engineering` — every one of them
  // sitting in the last study term, so every one of them scoring a gain of 8 or 9 — while the
  // 8 SH `Science Requirement`, a 1000-level pool that belongs in year one, got nothing because
  // its gain was merely 7. The scarce resource is the early slot, and gain does not measure who
  // has a claim on it.
  //
  // So the ordering is the cell's conventional home, earliest first. Same quantity as the floor
  // below, used for a different job: the floor says how early a cell MAY go, this says who gets
  // there first when they compete. A 1000-level science pool outranks `AFCS 2600 or CY 4170`,
  // whose group maximum is 4000-level and whose home is therefore late.
  const homeOf = new Map(bounded.map(p =>
    [p.cell.id, cellLevelTarget(p, courseMap, studentType) ?? 1]));
  const pairs = [];
  for (const want of bounded) {
    for (const filler of fillers) {
      const j = current.get(want.cell.id), i = current.get(filler.cell.id);
      if (i == null || j == null || i >= j) continue;
      pairs.push({ want, filler, gain: j - i, home: homeOf.get(want.cell.id) });
    }
  }
  pairs.sort((a, b) => a.home - b.home
    || b.gain - a.gain
    || String(a.want.cell.id).localeCompare(String(b.want.cell.id))
    || String(a.filler.cell.id).localeCompare(String(b.filler.cell.id)));

  for (const { want, filler } of pairs) {
    const j = current.get(want.cell.id), i = current.get(filler.cell.id);
    if (i == null || j == null || i >= j) continue;            // moved by an earlier swap
    if (!want.domain.includes(i) || !filler.domain.includes(j)) continue;
    // The same reachability bar `tradeDepth` uses, so the two operators cannot disagree about
    // when "earlier" is real: a pool with one reachable candidate at term i has not gained
    // anything by sitting there.
    if (isPoolCell(want) && want.reachAt && (want.reachAt[i] ?? 1) < cal.poolReachMin) continue;
    const trial = new Map(current);
    trial.set(want.cell.id, i);
    trial.set(filler.cell.id, j);
    if (fillersIn(trial, j) > maxFillers) continue;
    if (!fitsCapacity(trial, plans, terms, cap)) continue;
    // ── The level convention is a FLOOR here, not something to spend ──
    //
    // The first version of this pass ignored it and produced exactly the plan you would
    // predict: `ENGW 3302 or 3315` — Advanced Writing in the Disciplines, whose conventional
    // position `cellLevelTarget` puts at 0.64 through the plan — in the summer of year ONE,
    // and `CS 4530 or 4535` beside it. Both were prerequisite-legal, which is the whole
    // problem: ENGW 3302's real gate is "junior standing or above", and CS 4530's is CS 3100,
    // reachable only because its sibling CS 4535 has no prerequisites and the cell needs just
    // one viable option.
    //
    // So the convention is not decoration to be traded for a better placeholder position. It
    // is the PROXY for every constraint the catalog never recorded — class standing, major
    // gates, the prerequisite edges nobody wrote down — and `RESTRICTION_ONLY` throws that
    // prose away, so nothing else in the engine is holding a 3000-level course out of year 1.
    // Corpus effect of leaving it out: cells of one requirement clumping 3-to-a-term went from
    // 6.4% to 11.1% against the departments' 0.7%.
    //
    // ── And the check is PER CELL, because an aggregate is gameable ────
    //
    // The first attempt at this guard compared the plan-wide `level-order` score before and
    // after, and changed nothing at all: a swap moves TWO cells, and the filler travelling
    // later improves its own level fit by about as much as the requirement travelling earlier
    // worsens its. The aggregate stayed flat while the individual placement it existed to
    // prevent went through. So the rule is stated about the cell being pulled forward, where
    // the erosion actually happens.
    //
    // Earliness is only worth having where it is also conventional.
    const home = cellLevelTarget(want, courseMap, studentType);
    if (home != null && beforeConvention(i, home)) continue;
    if (!fullLegal(trial)) continue;
    current = trial;
    moves++;
    applied.push({ requirement: want.cell.title ?? "", from: j, to: i });
  }
  return { termOf: current, moves, applied };
}

/**
 * How many thin full terms phase 2 is allowed to leave.
 *
 * ── The general defect this closes ──────────────────────────────────
 *
 * Phase 1's cardinality propagator makes "four real courses in every full fall and spring"
 * true of every plan it returns — at the last placement, `need > possible` is checked with
 * nothing left to place, so a thin term cannot survive. And the property was STILL absent
 * from the emitted plans: `Year 3 Fall — 3 courses` in the five-year Industrial Engineering
 * and Computer Science variants, with the relaxed tier never invoked.
 *
 * Phase 2 was undoing it. Every mutation there — the hill climber, the depth trade, the
 * availability swap, the threshold repair — is screened by `fitsCapacity`, which knew the
 * credit cap, the slot cap and the same-requirement cap, and did not know this one. So each
 * phase enforced its own list, and a rule in one list and not the other erodes the moment
 * the other phase runs.
 *
 * That is the class of bug, not an instance of it: an invariant is only as strong as the
 * WEAKEST legality check any mutation passes through. The fix is that every hard rule lives
 * in the one function every mutation calls.
 *
 * ── A budget rather than a floor, and why ───────────────────────────
 *
 * Not "no thin terms": a plan can arrive here already carrying one, from the relaxed tier
 * or from a shape whose arithmetic cannot give every full term four. A hard floor would
 * then reject every move and freeze the plan unimproved. A non-increasing budget is
 * monotone — phase 2 may never make it worse, and `fillFullTerms` can still make it better.
 */
export function thinFullTerms(assignment, plans, terms, studentType = "undergraduate",
                              cal = DEFAULT_CALIBRATION, cap = null) {
  const minCourses = minCoursesFor(cal, studentType);
  if (minCourses <= 0) return 0;
  const big = terms.map(() => 0);
  const load = terms.map(() => 0);
  const bigSH = terms.map(() => 0);
  const any = terms.map(() => false);
  for (const p of plans) {
    const ti = assignment.get(p.cell.id);
    if (ti == null) continue;
    any[ti] = true;
    load[ti] += p.cell.sh ?? 0;
    if ((p.cell.sh ?? 0) >= cal.realCourseSH) { big[ti] += 1; bigSH[ti] += p.cell.sh ?? 0; }
  }
  let n = 0;
  for (let t = 0; t < terms.length; t++) {
    if ((terms[t].weight ?? 1) < 1 || !any[t]) continue;
    // Without a cap to compare against, fall back to the count — the caller that has one
    // passes it, and a missing cap must not silently make every term look full.
    const full = cap
      ? termIsFull(big[t], load[t], cap[t], cal, studentType, bigSH[t])
      : big[t] >= minCourses;
    if (!full) n += 1;
  }
  return n;
}

function fitsCapacity(assignment, plans, terms, cap, shape = null, maxThin = Infinity,
                      studentType = "undergraduate", cal = DEFAULT_CALIBRATION) {
  const load = terms.map(() => 0);
  const count = terms.map(() => 0);
  // Per requirement, matching search.js. Phase 2 shares this check because a bound the
  // objective does not know about is a bound it will spend its whole budget undoing:
  // spreading a requirement across terms costs load balance, so the hill climber would
  // happily re-stack all four in one term for a point of it.
  const req = terms.map(() => new Map());
  for (const p of plans) {
    const ti = assignment.get(p.cell.id);
    if (ti == null) continue;
    load[ti] += p.cell.sh ?? 0;
    count[ti] += coursesInCell(p.cell);
    const k = p.cell.target ?? `#${p.cell.id}`;
    req[ti].set(k, (req[ti].get(k) ?? 0) + 1);
  }
  // Every bound, or a move the search refused would be reachable by the objective.
  return load.every((sh, ti) => sh <= cap[ti])
      && count.every((n, ti) => n <= termSlotCap(terms[ti], shape))
      && req.every(m => [...m.values()].every(n => n <= cal.sameRequirementPerTermMax))
      // The four-course floor, as a non-increasing budget. See `thinFullTerms`.
      && (maxThin === Infinity || thinFullTerms(assignment, plans, terms, studentType, cal, cap) <= maxThin);
}

/** Full hard-constraint check, including the prereq-aware witness. */
function isLegal({ plans, terms, termOf, cap, courseMap, repeatable, ports, byId, precedence,
                  shape, maxThin = Infinity, studentType = "undergraduate",
                  cal = DEFAULT_CALIBRATION }) {
  if (!fitsCapacity(termOf, plans, terms, cap, shape, maxThin, studentType, cal)) return false;
  // Cheapest first: a precedence check is a map lookup, the witness is a matching.
  if (precedence && precedenceViolations(precedence, termOf).length) return false;
  const cells = plans
    .filter(p => termOf.get(p.cell.id) != null)
    .map(p => ({ ...p.cell, term: termOf.get(p.cell.id) }));
  return witnessPlan({
    cells, candidatesOf: (c) => byId.get(c.id).candidates,
    terms, courseMap, offeringProbability: ports.offeringProbability,
      offered: ports.offered,
    repeatable, checkPrereqs: true, contention: buildContention(plans),
  }).ok;
}

/**
 * Why each cell is where it is — legibility as a data structure, so it cannot
 * drift from the plan it describes.
 *
 * `cause` is a closed vocabulary, so the UI can render it and a test can assert
 * it. A cell whose domain had one legal term was FORCED and says so; a cell that
 * could have gone anywhere says that instead of inventing a rationale.
 */
function reasonsFor({ plans, terms, termOf, byId, depthOf, ports, trades }) {
  const out = new Map();
  for (const p of plans) {
    const ti = termOf.get(p.cell.id);
    if (ti == null) continue;
    const why = [];
    if (typeof p.cell.target === "number") {
      why.push({ kind: "requirement", target: p.cell.target, title: p.cell.title });
    } else {
      why.push({ kind: "requirement", target: p.cell.target, title: p.cell.title });
    }
    if (p.domain.length === 1) {
      why.push({ kind: "term", cause: "forced", detail: "no other term in this plan can hold it" });
    } else if (p.minDepth > 0 && ti === p.minDepth) {
      why.push({ kind: "term", cause: "prereq-forced",
                 detail: `${p.minDepth} term${p.minDepth === 1 ? "" : "s"} of prerequisites come first` });
    } else if (p.candidates?.length && onlySeason(p, terms, ports) === terms[ti].semTypeId) {
      why.push({ kind: "term", cause: "only-season-offered",
                 detail: `only offered in ${terms[ti].termLabel}` });
    } else {
      why.push({ kind: "term", cause: "load-balance", detail: "placed to even out the term loads" });
    }
    if (p.cell.alsoAnswers?.length) {
      why.push({ kind: "also-answers", targets: p.cell.alsoAnswers });
    }
    out.set(p.cell.id, why);
  }
  // The trade belongs to the plan, not to a cell — it is a statement about the
  // ranking, and attaching it to an arbitrary card would misattribute it.
  if (trades.length) out.set("~plan", trades.map(t => ({
    kind: "traded", against: t.objective, amount: `${t.gaveUp} ${t.units}`,
  })));
  return out;
}

/** The one season every candidate is restricted to, if there is one. */
function onlySeason(plan, terms, ports) {
  const seasons = [...new Set(terms.map(t => t.semTypeId))];
  const live = seasons.filter(s =>
    plan.candidates.some(id => ports.offeringProbability(id, s) !== 0));
  return live.length === 1 ? live[0] : null;
}

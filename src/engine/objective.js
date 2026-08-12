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

/**
 * The subject a cell is about.
 *
 * For a forced or chosen cell, the subject its groups agree on. For an open cell,
 * the modal subject of its candidates — a `MATH 3001–4999` pool is about MATH
 * whatever course fills it. Null for a cell that admits anything, which is
 * correct: a general elective is about no subject, and inventing one for it would
 * make it score as depth.
 */
export function cellSubject(plan, courseMap) {
  const cell = plan.cell ?? plan;
  if (cell.groups?.length) {
    const subs = new Set(cell.groups.flat().map(id => courseMap[id]?.subject).filter(Boolean));
    return subs.size === 1 ? [...subs][0] : null;
  }
  if (!plan.candidates?.length) return null;
  const counts = new Map();
  for (const id of plan.candidates) {
    const s = courseMap[id]?.subject;
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  if (!counts.size) return null;
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // A pool spread across many subjects is not "about" the largest of them.
  return top[1] / plan.candidates.length >= 0.5 ? top[0] : null;
}

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
export function checkThresholds({ plans, terms, termOf, ports, studentType, thresholds }) {
  const min = thresholds.minTermSH ?? ports.creditMin(studentType);
  const cap = ports.creditMax(studentType);
  const max = thresholds.maxTermSH ?? (cap - (thresholds.slackSH ?? 0));
  const load = terms.map(() => 0);
  for (const p of plans) {
    const ti = termOf.get(p.cell.id);
    if (ti != null) load[ti] += p.cell.sh ?? 0;
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
  });
  return { failures, load };
}

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
  trialBudget = DEFAULT_IMPROVE_TRIALS, shape = null,
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
  const fullLegal = (assignment) =>
    isLegal({ plans, terms, termOf: assignment, cap, courseMap, repeatable, ports, byId, precedence, shape });

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

  // ── Repair thresholds last ──────────────────────────────────────
  //
  // Last because a threshold is a bar: satisfying it is worth giving up ranked
  // score for, and doing it first would let the ranked passes undo it.
  const before = checkThresholds({ plans, terms, termOf: current, ports, studentType, thresholds });
  let repaired = current;
  if (before.failures.length) {
    const res = climb(
      current,
      (a) => -checkThresholds({ plans, terms, termOf: a, ports, studentType, thresholds }).failures.length,
    );
    repaired = res.termOf;
    moves += res.moves;
  }

  const finalScores = scorePlan({ ...ctx, termOf: repaired });
  const after = checkThresholds({ plans, terms, termOf: repaired, ports, studentType, thresholds });

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

function fitsCapacity(assignment, plans, terms, cap, shape = null) {
  const load = terms.map(() => 0);
  const count = terms.map(() => 0);
  for (const p of plans) {
    const ti = assignment.get(p.cell.id);
    if (ti == null) continue;
    load[ti] += p.cell.sh ?? 0;
    count[ti] += coursesInCell(p.cell);
  }
  // Both bounds, or a move the search refused would be reachable by the objective.
  return load.every((sh, ti) => sh <= cap[ti])
      && count.every((n, ti) => n <= termSlotCap(terms[ti], shape));
}

/** Full hard-constraint check, including the prereq-aware witness. */
function isLegal({ plans, terms, termOf, cap, courseMap, repeatable, ports, byId, precedence, shape }) {
  if (!fitsCapacity(termOf, plans, terms, cap, shape)) return false;
  // Cheapest first: a precedence check is a map lookup, the witness is a matching.
  if (precedence && precedenceViolations(precedence, termOf).length) return false;
  const cells = plans
    .filter(p => termOf.get(p.cell.id) != null)
    .map(p => ({ ...p.cell, term: termOf.get(p.cell.id) }));
  return witnessPlan({
    cells, candidatesOf: (c) => byId.get(c.id).candidates,
    terms, courseMap, offeringProbability: ports.offeringProbability,
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

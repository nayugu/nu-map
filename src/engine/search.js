// ═══════════════════════════════════════════════════════════════════
// CHART · SEARCH — placing cells in terms
//
// Phase 1 finds a plan that satisfies every hard constraint. It does not try to
// find a GOOD one; that is phase 2's job (objective.js), and keeping them apart
// is what makes "the plan is legal" testable independently of "the plan is well
// sequenced".
//
// ── Most-constrained-first, with a correction ───────────────────────
//
// The standard MRV heuristic: assign the cell with the fewest legal terms first,
// so the widest cells fall into whatever gaps remain. The design expected this to
// make electives the filler rather than the front-loaded thing.
//
// Measured, it only half does. MRV needs domains of differing width, and the
// prereq DAG barely narrows anything — 71% of the catalog is depth 0, so 52–65%
// of a program's named courses have every term legal. Availability narrows more
// (17.1% of courses admit one season of four) and pool size more still, but a
// broad `General Elective` and a specific 4000-level course frequently have the
// SAME domain. MRV cannot separate them, so it does not stop the elective landing
// in year 1.
//
// The tie-break carries that weight instead, and it is stated rather than
// emergent: among equally-constrained cells, place the one whose candidate set is
// SMALLEST first. A cell with 2 candidates is a real commitment; a cell with the
// whole catalog is filler by definition. This is `decide late` used as a search
// order, and it is the honest version of what MRV was supposed to deliver.
//
// ── The witness is the propagator, not a verification pass ──────────
//
// Distinctness across cells — no two answered by the same course — is an
// `alldifferent` constraint, whose standard propagator IS maximum matching. So
// there is no propose → witness → repair loop to design; the matching runs inside
// the search and a failure is a dead branch like any other.
//
// But only the part of it that is sound on a partial assignment: eligibility,
// season and distinctness. Prereq-reachability is NOT sound to prune on, because
// a cell needing CS 3000 fails while the cell that supplies CS 3000 is still
// unplaced, and that cell might land earlier. Pruning on it would refuse
// perfectly generatable programs, and refuse them silently — there would be no
// output for a test to find fault with. So the search propagates with
// `checkPrereqs: false` and the FINAL witness, over the complete assignment,
// turns it on. See witness.js for the argument in full.
//
// ── Placing early is not the same as placing legally ────────────────
//
// Taking each cell's earliest legal term fills term 1 to the registration cap and
// leaves the last year nearly empty. Legal, and a terrible plan — and a terrible
// starting point for phase 2, which would have to undo all of it. So terms are
// tried in order of how FULL they are relative to the shape's own target, which
// costs nothing (branch order does not affect completeness) and lands phase 1 on
// a balanced plan directly.
//
// ── Backtracking needs a bound ──────────────────────────────────────
//
// At ~40 cells and ~12 terms this should never thrash, but a pathological program
// could. Phase 1 carries a node budget and a defined answer when it is spent:
// refusal, reached for a different reason than pre-flight's but reported the same
// way. A search that silently returned its best partial answer would emit a plan
// missing requirements, which is the one thing generation must never do.
// ═══════════════════════════════════════════════════════════════════

import { witnessPlan, buildContention, bipartiteMatch } from "./witness.js";
import { termCapacity, termSlotCap, coursesInCell } from "./domains.js";
import { chainHeight, precedenceViolations } from "./precedence.js";
import { DEFAULT_CALIBRATION, minCoursesFor, termIsFull } from "./calibration.js";
import { cellLevelTarget, cellLevelFloor, unlockValues } from "./prereqDepth.js";

/**
 * Above how many candidates a cell is a pool rather than a choice.
 *
 * `CS 4300 or CS 4100` is a choice between two named courses and belongs where its
 * level says; `Khoury Approved Elective` with 247 candidates is a pool and belongs
 * where its reachable share says. The line is drawn at the corpus's own: a published
 * `or` cell names at most 5 courses, so anything past that is not a printed choice.
 */
export const POOL_MIN_CANDIDATES = 5;

/**
 * Every course this program could schedule — required courses AND every elective-pool
 * candidate.
 *
 * The universe has to include the pools, because a course that unlocks half the Khoury
 * pool and nothing the degree names outright is the clearest case of "opens a lot" there
 * is, and counting required cells only scores it zero. See `unlockValues`.
 */
export function unlockUniverse(plans) {
  const universe = new Set();
  for (const p of plans) for (const id of p.candidates ?? []) universe.add(id);
  return universe;
}

/** A cell's unlock value: the most any single course answering it opens. */
export function unlockOfCell(plan, unlockValue) {
  const groups = plan.cell?.groups;
  if (!groups) return 0;          // a pool is not a generator; it is the thing unlocked
  let n = 0;
  for (const g of groups) for (const id of g) n = Math.max(n, unlockValue.get(id) ?? 0);
  return n;
}

/**
 * A cell offering a genuine choice among many courses, rather than naming one.
 *
 * `CS 4300 or CS 4100` is a choice between two named courses and belongs where its level
 * says; `Khoury Approved Elective` with 247 candidates is a pool and belongs where its
 * reachable share says.
 */
export function isPoolCell(plan) {
  return plan.cell?.kind === "open" || (plan.candidates?.length ?? 0) > POOL_MIN_CANDIDATES;
}

/**
 * The unlock value at which a course earns an early slot: this program's own MEDIAN over
 * its named major cells.
 *
 * ── Why a median, and why "unlocks nothing" was the wrong bar ────────
 *
 * The first version treated only a zero as terminal, on the reasoning that any positive
 * cut would be an invented constant. That reasoning was wrong, and the measurement shows
 * how badly. In Computer Science and Mathematics the named major cells score:
 *
 *     CS 2000  57   CS 2100  56   MATH 1341  40   MATH 1342  39   CS 1800  33
 *     CS 3100  30   MATH 2331  19   MATH 2321  17   MATH 3081  12   CS 3000  11
 *     MATH 2341  8   CS 3800  6   MATH 3175  5   MATH 3527  2   CS 2800  1  …
 *
 * A zero bar catches 3 of 19. `MATH 3527` (Number Theory 1) unlocks exactly one pool
 * candidate — Number Theory 2 — and was therefore ranked with `CS 2000`, which unlocks
 * 57. The distribution is heavily skewed, so the question "does this open a lot" has no
 * absolute answer; it only has one relative to the degree it is in.
 *
 * The median needs no constant and is self-calibrating: half of a degree's major courses
 * take the earliest term their prerequisites allow, and the other half go where their
 * level conventionally sits, freeing the early terms for the electives that carry depth.
 * A degree of long chains and a degree of independent courses each get their own bar.
 *
 * Ties count as generators (`>=`), so a cell sitting exactly at the median is not
 * demoted by an accident of how the halves divide.
 */
export function generatorBar(plans, courseMap, unlockValue, majorSubjects) {
  const vals = plans
    .filter(p => p.cell?.groups && !isPoolCell(p) && majorSubjects.has(cellSubject(p, courseMap)))
    .map(p => unlockOfCell(p, unlockValue))
    .sort((a, b) => a - b);
  if (!vals.length) return 1;            // no major named cells: everything specific is a generator
  return vals[Math.floor(vals.length / 2)];
}
import { cellSubject, majorSubjectsOf } from "./subjects.js";
import { GENERAL_ELECTIVE } from "../core/requirementDemand.js";
import { assignSeedHints } from "./seed.js";
import { barsReachable } from "./cardinality.js";

/**
 * The most general electives one term may hold, at every tier and every rung.
 *
 * Four cells of an ordinary requirement is fine — four `Concentration` cards is a real
 * semester with a real shape. Four GENERAL ELECTIVES is not: it is a term with nothing in it
 * to read, and `docs/chart-success-criteria.md` makes it a hard criterion. So unlike every
 * other requirement this bucket does not widen when `wideTerms` lifts the general cap, and
 * the packing fallback obeys it too — a fallback that produces plans the criteria refuse is
 * not a fallback.
 */
export const UNGUIDED_PER_TERM_CAP = 3;

/**
 * How deep a DEPTH elective is assumed to be, in chain height — rule 4's estimate.
 *
 * A depth elective is "an advanced course in or near the major", and such a course sits on
 * about two terms of prerequisites: a 3000-level course in a major subject typically needs an
 * introductory course and its successor behind it. Two is that, and it is an ESTIMATE — the
 * cell names no course, so no measurement of it is available even in principle.
 *
 * What makes an estimate safe to act on is that it is never used alone. It is only ever
 * COMPARED against the degree's own chains (`majorChainMax`), so what it has to get right is
 * the ORDER of two numbers, not either one's value. Measured over 351 degrees with an elective
 * pool, the major's max chain height runs p10 1, median 2, p90 4, max 7 — so 2 sits at the
 * corpus median and the comparison genuinely splits the population rather than answering the
 * same way for everyone.
 *
 * Raising it lets electives compete in deeper degrees; lowering it confines them to the
 * shallowest. The two benchmarks bracket it: International Business is 2 and its electives must
 * compete, Computer Science and Mathematics is 3 and its must not.
 */
export const GE_DEPTH_ESTIMATE = 2;

/**
 * Nodes phase 1 may expand before refusing.
 *
 * 20,000 — and it stays there, which took two measured regressions to establish.
 *
 * ── Raising it is intuitive, and it loses plans ──────────────────────
 *
 * The intuition is sound as far as it goes. 20,000 was sized when `firstFree` re-sorted the
 * whole catalog on every node, putting a node at 0.4–10 ms; with that cached a node costs
 * about 0.031 ms, so 20,000 nodes is ~620 ms of a 5,000 ms allowance and the search appears to
 * give up holding 87% of its clock.
 *
 * Measured over all 1,031 shapes, raising it tenfold cost SIX plans (744 → 738). The rung
 * tally explains it: `term-width` usage fell from 42 to 20. A bigger node budget makes rung 1's
 * allowance — half of what remains — large enough to spend the shared WALL CLOCK, so rung 2
 * never runs. Raising `NODES_PER_MS` alongside it was worse still (740, and thin terms tripled),
 * starving both rungs from the strict tier instead.
 *
 * ── What the two regressions actually teach ─────────────────────────
 *
 * The ladder is a fixed-clock ALLOCATION problem, not a budget-size problem. Coverage is
 * carried by the later, more permissive tiers, so any change that lets an earlier tier spend
 * more clock starves the tier that would have rescued the program. Nobody needs more; the
 * later rungs need a GUARANTEED share.
 *
 * That is the next structural change, and it is the generalisation of a fix this file already
 * applies once: `STRICT_TIER_SHARE` reserves the fallbacks' clock against the strict tier, and
 * nothing reserves rung 2's clock against rung 1. Until each rung has a reserved share,
 * enlarging the budget will keep making things worse.
 *
 * Also a cost worth knowing: at 200,000 the corpus sweep went from ~12 to ~25 minutes, because
 * every refusal now spends its whole clock. That gate runs in the monthly workflow.
 */
export const DEFAULT_NODE_BUDGET = 23600;

/**
 * And a wall-clock bound, because nodes are not a good proxy for time.
 *
 * A node's cost scales with the elective pool it has to match over, so 20,000
 * nodes took 45 seconds on one program and 177 on another. A generate button that
 * hangs for three minutes is broken however principled the reason, and the honest
 * answer — refusal, naming what could not be placed — is available immediately.
 */
export const DEFAULT_TIME_BUDGET_MS = 5000;

/**
 * Nodes the STRICT tier may spend before the four-course bound is relaxed.
 *
 * Sized against BOTH bounds, because it has to satisfy two things at once.
 *
 * Against nodes: a program that generates uses a median of 19 and a p90 of 36, so 1,200 is
 * ~33x the headroom a real plan needs, and it allows four restarts at the 300-node slice —
 * enough for nogood learning, which measurably rescued 46 programs.
 *
 * Against the clock: a node costs roughly 0.4 ms, since each one runs a matching. That is
 * what killed the two earlier values. 60% of the node budget (12,000) and then 3,000 both
 * consumed the ENTIRE shared wall clock before the fallback tier was reached, so the tier
 * that exists to protect coverage never ran — and once the clock became a refusal rather
 * than a tier switch, generation fell to 48%. 1,200 nodes is ~480 ms, which leaves the
 * majority of even a 1,200 ms budget to the fallback.
 *
 * The general shape: the strict tier must be bounded so it cannot spend the budget it
 * shares with the tier behind it.
 */
/**
 * Nodes per millisecond, for deriving the strict tier's allowance from the time budget.
 *
 * 2.5, and it STAYS 2.5 even though a node now costs 0.031 ms rather than 0.4 ms.
 *
 * ── Raising it to the measured rate was tried and made coverage WORSE ──
 *
 * 20 is the honest figure for what a node now costs, so it looked like a straightforward
 * correction. Measured over all 1,031 shapes it cost 4 plans (744 → 740) and tripled thin
 * terms (1 → 3), and the rung tally says why: fallback usage collapsed from 74/42 to 49/18.
 * A bigger strict allowance means the strict tier spends more of the WALL CLOCK, which it
 * shares, so the tiers that actually rescue coverage never ran.
 *
 * This constant's own history is three instances of the same mistake — 60% of the node budget,
 * then a flat 3,000, now the "correct" rate — and the invariant behind all three is the one
 * worth keeping: **the strict tier must not be able to spend the clock the fallbacks need.**
 * Coverage is carried by the fallback rungs, so starving them is always the wrong trade.
 *
 * The node budget was raised instead (see `DEFAULT_NODE_BUDGET`), which gives the RUNGS the
 * headroom without touching the strict tier's share.
 */
export const NODES_PER_MS = 2.5;

/**
 * The share of the time budget the strict tier may spend, expressed in nodes.
 *
 * 40%, leaving the majority to the fallback, whose whole purpose is protecting coverage.
 */
export const STRICT_TIER_SHARE = 0.4;

/**
 * How the NODE budget is divided between the tiers — shares that sum to one.
 *
 * ── The defect this replaces ────────────────────────────────────────
 *
 * Each rung used to take "half of whatever is left" (`(nodeBudget - totalNodes) / 2`). That is
 * not a reservation, it is a scramble: it hands every tier a share of the REMAINDER, so an
 * earlier tier that overruns silently consumes what a later one needed, and the later tiers are
 * exactly the ones that rescue coverage.
 *
 * Two measured regressions, both this shape, both from an intuitive "the budget is too small"
 * change:
 *
 *   NODES_PER_MS 2.5 -> 20     `strictNodes` became min(5000*20*0.4, 20000) = 20,000, so the
 *                              strict tier consumed the WHOLE node budget and every rung got
 *                              one node. Fallback usage 74/42 -> 49/18; cost 4 plans
 *   nodeBudget 20k -> 200k     rung 1's half-the-remainder became 97,500 nodes, ~3 s of a 5 s
 *                              clock, so rung 2 was starved of TIME rather than nodes.
 *                              `term-width` usage 42 -> 20; cost 6 plans
 *
 * Fixed shares fix the FIRST of those and not the second, and the distinction matters enough to
 * state rather than let a reader assume. No tier's NODE allowance depends on what another spent,
 * so a tier can no longer consume the budget of the tier behind it. But a node share is not a
 * time share: rung 1 holding 40% of the nodes can still spend 100% of the CLOCK if its nodes are
 * expensive, and that is what starved rung 2 in the second regression.
 *
 * ── And the second one cannot be fixed here ─────────────────────────
 *
 * A per-rung DEADLINE would fix it and is forbidden: when it fired, rung 2 would run and might
 * succeed, so a slow machine would produce rung 2's plan where a fast one produced rung 1's —
 * the same input giving two different plans. That is the non-determinism this file has already
 * been through twice, and the rule it settled on is absolute: the clock may turn an answer into
 * a refusal, never into a different answer. Deriving rung allowances from `timeBudgetMs` instead
 * does not escape it either — `NODES_PER_MS` is deliberately conservative, so the allowances
 * come out smaller than today's and cost coverage.
 *
 * So inter-tier clock starvation is not solvable within the determinism rule. The route that
 * actually works is making nodes uniformly cheap, which is what profiling delivered: caching one
 * catalog sort took a node from 10 ms to 0.031 ms and won 50 plans. Cheap nodes make the clock
 * stop binding at all, which dissolves the problem rather than allocating around it.
 *
 * ── What this is worth, stated honestly ─────────────────────────────
 *
 * Measured over all 1,031 shapes: 744 generated before and after, and the fingerprint diff reads
 * 740 unchanged, 0 moved, 0 gained, 0 lost. It buys NOTHING today. It is kept because it removes
 * a demonstrated failure mode — two regressions in one afternoon came through the remainder
 * arithmetic — and because it stops leaving 3,750 nodes of 20,000 permanently unallocated. A
 * structural correction with a measured value of zero is worth keeping only when it forecloses a
 * mistake someone will otherwise repeat, and this one has been made twice already.
 *
 * ── Why the shares are what they are ────────────────────────────────
 *
 * 0.25 / 0.40 / 0.35, and they allocate the WHOLE budget where the old scheme left 3,750 nodes
 * of 20,000 permanently unspent (5,000 + 7,500 + 3,750 = 16,250 — the constant that showed up
 * in refusal after refusal).
 *
 * Strict gets the smallest share deliberately. It is the tier expected to succeed quickly — a
 * program that generates uses a median of 19 nodes — so past a few thousand nodes it is hitting
 * the same wall repeatedly, and the measurement is unambiguous that coverage is carried by the
 * fallbacks. Its share is ALSO capped by the time-derived bound, so a short `timeBudgetMs`
 * still shrinks it and the test suite's 1,200 ms budget behaves exactly as before.
 *
 * Rung 2 rises from 3,750 to 7,000, which is the whole point: it is the tier with nothing behind
 * it, and it was the one being starved.
 *
 * ── The shares must leave room for the LAST rung to exist ───────────
 *
 * `0.25 + 0.40 + 0.35` is exactly 1.00, and the ladder breaks on
 * `totalNodes >= nodeBudget` before each rung. So a third rung could be added, be correct,
 * and never execute once — which is precisely what happened to the four-course rung: it was
 * on the ladder, `canStillFill` honoured its `enforceCardinality: false`, and International
 * Business still refused with `full-term-cannot-reach-four` at twelve times the clock,
 * because the loop had already broken.
 *
 * A budget that sums to the whole is not a set of reservations; it is a set of claims on the
 * same nodes, and the last one loses silently. So the shares sum to less than 1 with every
 * rung named, and adding a rung now means editing this line — which is the point.
 *
 * ── And the new rung is paid for with NEW nodes, not with theirs ────
 *
 * The first attempt took the third rung's share out of the existing three. It worked — the
 * rung ran and rescued 28 programs — and it also made 45 already-good plans worse, because a
 * program that used to settle in the strict tier now ran out of nodes and fell through to a
 * looser one. Empty full terms rose by 27 across plans that were already generating, and
 * measured per plan rather than in total the cause was unmistakable: the 29 newly-generating
 * plans contributed ONE empty term between them.
 *
 * That is this file's own warning — "coverage is carried by the fallback rungs, so starving
 * them is always the wrong trade" — collected a second time. So `DEFAULT_NODE_BUDGET` rises
 * by the same factor the shares fall, and every original tier keeps its ABSOLUTE allowance:
 *
 *   strict  0.21 x 23,600 = 4,956   (was 0.25 x 20,000 = 5,000)
 *   rung 1  0.34 x 23,600 = 8,024   (was 0.40 x 20,000 = 8,000)
 *   rung 2  0.30 x 23,600 = 7,080   (was 0.35 x 20,000 = 7,000)
 *   rung 3  0.13 x 23,600 = 3,068   (new, and nobody else pays for it)
 */
export const TIER_SHARES = Object.freeze({ strict: 0.21, rungs: [0.34, 0.30, 0.13] });

/**
 * How close the remaining problem must be to tight before the exact Hall check runs.
 *
 * The matching is ~30k operations, so running it at every node of every program would cost
 * more than it saves — and where there are spare cells the cheap per-term count already
 * decides. Two spare cells is the point at which cross-term interference becomes possible
 * at all: with three or more, a term short by one always has an alternative and Hall cannot
 * fail where the per-term check passed.
 */
export const HALL_SLACK = 0;

/**
 * The most work one Hall check may do, as `slots² × cells`.
 *
 * 40,000 — about a 20-slot, 100-cell instance, which is comfortably larger than the case the
 * check was built for (Industrial Engineering and Computer Science: 24 slots, 32 cells) and
 * far below the one that broke it (22 terms, 15 needing, 40 cells ≈ 144,000 per node).
 *
 * A bound rather than a smarter algorithm because the check is OPTIONAL. It prunes; it does
 * not decide. Declining to prune costs search time and cannot cost correctness, so the honest
 * trade for a pathological instance is to think less rather than to hang — 168 seconds in a
 * browser tab is not a slow answer, it is no answer.
 */
export const HALL_MAX_WORK = 40_000;

/**
 * @typedef {Object} Assignment
 * @property {Map<string, number>} termOf   cell id → study-term index
 * @property {number} nodes
 */

/**
 * Place every cell, honouring every hard constraint.
 *
 * @param {object} args
 * @param {import("./domains.js").CellPlan[]} args.plans
 * @param {object[]} args.terms          study terms in order
 * @param {object} args.ports
 * @param {string} args.studentType
 * @param {Record<string,object>} args.courseMap
 * @param {(id: string) => boolean} [args.repeatable]
 * @param {number} [args.nodeBudget]
 * @returns {{ok: boolean, termOf?: Map, failure?: object, nodes: number}}
 */
/**
 * Place every cell, learning from each dead end.
 *
 * ── Why an outer restart loop ───────────────────────────────────────
 *
 * Phase 1 prunes on everything that is SOUND to prune on mid-assignment:
 * distinctness, capacity, precedence, named-course order. Candidate prerequisites
 * are not on that list — whether a course can answer a cell in term 6 depends on
 * where the OTHER cells land — so they are only checked once the plan is complete.
 *
 * That leaves the search discovering one class of conflict at the very last step
 * and then backtracking blindly into the same wall. Measured: 46 programs failed
 * this way, all of them reporting "no course can answer X in term T".
 *
 * So a failure that names a cell and a term is recorded as a NOGOOD and the search
 * restarts with that pairing removed. Each restart is cheap (a median program uses
 * 19 nodes) and each one strictly narrows the space, so it converges.
 *
 * ── What this trades, stated plainly ────────────────────────────────
 *
 * A nogood is a HEURISTIC, not a deduction: "C cannot be in T" was observed under
 * one arrangement of the other cells, and a different arrangement might have made
 * it work. So this can miss a plan that exists — it is incomplete.
 *
 * That is an acceptable trade only because of what it does NOT trade: every plan
 * it returns has passed the full prereq-aware witness, so no wrong plan can escape
 * this way. And the alternative was not completeness, it was refusal — the 46
 * programs got no plan at all.
 */
export function placeCells({
  plans, terms, ports, studentType = "undergraduate", courseMap = {},
  repeatable = () => false, nodeBudget = DEFAULT_NODE_BUDGET,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS, now = () => Date.now(),
  precedence = null, maxRestarts = 40, shape = null, cal = DEFAULT_CALIBRATION,
  // The department's own arrangement, as a branch ordering. Absent for the 62% of programs
  // that publish no plan, which simply search as they did before.
  seed = null,
  // ── Skip the ladder and pack ────────────────────────────────────────
  //
  // For the caller's SECOND attempt, after the first produced a plan the hard criteria
  // refused. The ladder cannot be asked for "another plan" — it is deterministic, so it
  // returns the same one — and its last rung deliberately relaxes the four-course bar, which
  // is precisely the rule the criteria then enforce. So a degree could have the ladder
  // succeed with a lopsided plan, be refused for it, and never reach the packer that would
  // have filled every term. International Business is exactly that: the packer solves it in
  // 200 nodes, and was unreachable because rung 3 answered first.
  packOnly = false,
  propagateChains = true,
}) {
  const deadline = now() + timeBudgetMs;

  // The caller has already had a plan refused by the criteria; go straight to the packer,
  // which is a different constructor rather than the same search asked twice.
  if (packOnly) {
    const g = packDecreasing({ plans, terms, ports, studentType, courseMap, repeatable,
                               precedence, cal, shape });
    return g.ok
      ? { ...g, nodes: 0, restarts: 0, cardinalityRelaxed: true,
          relaxed: ["packed-largest-first"] }
      : { ok: false, nodes: 0, restarts: 0, exhaustedSpace: false,
          failure: g.failure ?? { kind: "packed-largest-first-failed" } };
  }

  // ── The fallback tier gets a RESERVED share, not the leftovers ────
  //
  // The relaxed attempt below was gated on `now() <= deadline` and therefore almost never
  // ran: the strict restarts spend the whole budget by construction — they escalate until
  // they hit it — so the tier meant to protect coverage was unreachable in exactly the
  // cases that needed it. Measured, generation stayed at 59 of 150 instead of recovering.
  //
  // So the strict tiers run against a shorter clock and the remainder belongs to the
  // fallback. 60/40 rather than 50/50 because the strict pass is the one expected to
  // succeed — a program that generates at all uses a median of 19 nodes — and the fallback
  // is a single attempt with no restarts to pay for.
  // ── The tier boundary is in NODES, because wall clock is not reproducible ──
  //
  // This reserved the fallback's share as a fraction of the TIME budget, and that made
  // generation non-deterministic — a defect this engine had already been through once, for
  // the same reason, in the objective's improve loop.
  //
  // Which tier answers decides the plan: the strict tier enforces four courses in every
  // full term and the relaxed one does not, so they return DIFFERENT plans. Gate that on a
  // clock and the answer depends on machine load — `business_administration_and_public_
  // health_bs` duly differed between two runs in the same process. A plan that changes
  // run to run also makes the diff review the monthly data workflows rely on into noise.
  //
  // Nodes are a property of the search, so the boundary is now 60% of the NODE budget. The
  // wall clock survives as an outer guard only, and when it fires the answer is a refusal
  // rather than a quietly different plan: deterministic, or honest about having given up.
  // 60% of the node budget was too much: at 20,000 nodes the strict tier gets 12,000, each
  // node runs a matching, and it spent the entire WALL CLOCK before the fallback tier was
  // reached — so coverage fell instead of recovering. The clock is shared; the point of
  // reserving anything is that the fallback actually runs.
  //
  // 3,000 is sized off the measurement instead of a fraction: a program that generates uses
  // a median of 19 nodes and a p90 of 36, so this is roughly eighty times the headroom a
  // real plan needs, and anything past it is the same wall being hit repeatedly.
  // Derived from the TIME budget, in nodes — which sounds contradictory and is the point.
  //
  // A node costs roughly 0.4 ms because each one runs a matching, so the strict tier must
  // not be able to spend the clock it SHARES with the fallback behind it. Two earlier values
  // failed in opposite directions: 60% of the node budget (12,000) and then a flat 3,000
  // each consumed everything, so the tier that exists to protect coverage never ran and
  // generation fell to 48%; a flat 1,200 was sized for the 1,200 ms TEST budget and left
  // production's 5,000 ms mostly unused, pushing the five-year "Summer Second Half" variant
  // out of the strict tier and giving it a thin term.
  //
  // So it scales with `timeBudgetMs`, which is an INPUT. That keeps determinism — the bound
  // is a function of the arguments, not of how fast the machine happens to be running —
  // while spending the budget actually available. Reading the clock DURING the search to
  // decide this is exactly what made generation non-deterministic.
  //
  // Floored at one full restart slice so nogood learning always gets a turn.
  // BOTH bounds, and each one is load-bearing. The time-derived term keeps the strict tier from
  // spending the clock it shares with the fallbacks — the invariant this constant has broken
  // three times. The share term keeps it from spending their NODES, which is how raising
  // `NODES_PER_MS` starved them even though the time term looked correct.
  const strictNodes = Math.max(300, Math.min(
    Math.floor(timeBudgetMs * NODES_PER_MS * STRICT_TIER_SHARE),
    Math.floor(nodeBudget * TIER_SHARES.strict),
    nodeBudget));
  // Domains are narrowed across restarts, so the originals are left untouched for
  // the caller (the objective phase moves cells within them).
  const working = plans.map(p => ({ ...p, domain: [...p.domain] }));
  let totalNodes = 0;
  let last = null;

  // Each attempt gets a SMALL slice of the budget, in BOTH currencies.
  //
  // Bounding only the nodes was not enough. Attempt 0 stopped at 768 nodes — under
  // its 800-node share — because it had used the whole three-second wall-clock
  // budget, and the loop then had no time to restart. Traced by hand on one program,
  // the second restart succeeds in 34 nodes; it simply never ran.
  //
  // A program that succeeds uses a median of 19 nodes and a p90 of 36, so a few
  // hundred is already ten times the headroom a real plan needs. Past that it is the
  // same wall being hit repeatedly, and the useful move is to learn and start again.
  let perAttempt = Math.max(64, Math.min(nodeBudget, 300));

  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    const r = attemptPlacement({
      plans: working, terms, ports, studentType, courseMap, repeatable,
      nodeBudget: Math.min(perAttempt, Math.max(1, strictNodes - totalNodes)),
      precedence, now, shape, cal, propagateChains, seed,
      // The GLOBAL deadline only. Each attempt used to get a time slice as well, and that
      // was the last source of non-determinism: how many nodes an attempt explored depended
      // on machine load, so `business_administration_and_public_health_bs` returned
      // different plans on two runs in the same process. Attempts are bounded by nodes,
      // which is a property of the search; the clock is the outer guard and firing it means
      // refusing, not answering differently.
      deadline,
    });
    totalNodes += r.nodes;
    if (r.ok) return { ...r, nodes: totalNodes, restarts: attempt };
    last = r;

    // Node-bounded, so the same input always reaches the fallback at the same point.
    if (totalNodes >= strictNodes) break;

    // ── A clock may cost you an answer; it must not change which answer ──
    //
    // Breaking here on time fell through to the relaxed tier, and the two tiers return
    // DIFFERENT plans — the strict one holds four courses in every full term and the
    // relaxed one does not. So a slow machine silently produced the other plan, which is
    // what `business_administration_and_public_health_bs` was doing: same input, two
    // outputs, decided by load.
    //
    // On the clock we now refuse outright. The set of possible outputs for one input is
    // then {strict plan, relaxed plan, refusal}, and only the first two are ever REACHED
    // BY THE SEARCH — the third is the clock giving up. A refusal under load is a cost;
    // a different plan under load is a correctness failure, and the diff review the
    // monthly workflows depend on cannot tell the two apart.
    if (now() > deadline) {
      return {
        ok: false, nodes: totalNodes, restarts: attempt,
        failure: { kind: "search-budget-exhausted", detail: describe({ kind: "search-budget-exhausted" }) },
      };
    }

    // Only a failure that names a cell AND a term can become a nogood.
    const f = r.failure?.lastObstruction ?? r.failure;
    const target = f?.cell != null ? working.find(p => p.cell.id === f.cell) : null;
    const canLearn = target && f.term != null
      && target.domain.length > 1 && target.domain.includes(f.term);

    if (canLearn) {
      target.domain = target.domain.filter(t => t !== f.term);
      continue;
    }

    // Nothing to learn: the attempt ran out of allowance before it reached a
    // conflict it could name. Escalating rather than giving up, because a small
    // allowance is what makes learning possible in the common case and must not
    // become a ceiling in the rare one. Doubling means the total stays bounded by
    // the overall deadline rather than by the number of restarts.
    if (perAttempt >= nodeBudget) break;
    perAttempt = Math.min(nodeBudget, perAttempt * 4);
  }

  // Report what actually stopped it, not the budget it happened to stop inside.
  // A cell whose last legal term was tried and rejected is not "we ran out of
  // attempts" — it is "nothing can answer this cell anywhere", which is a different
  // sentence and the only one a person can act on.
  // ── One last attempt with the four-course bound RELAXED ───────────
  //
  // The cardinality propagator is what finally made "every full fall and spring holds
  // four" a property of the answer rather than something repaired afterwards — thin terms
  // fell from 3.5% to 0.3%. It also costs coverage, because a tighter constraint means
  // more dead branches and a budget that expires inside them: generation fell from 85
  // programs of 150 to 61.
  //
  // Both of those are real, and the choice between them is a false one. The bar is a
  // convention, measured at 95.8% of published full terms — strong, and NOT universal:
  // the 4.2% that miss it are architecture and art, where one studio course is 16 credits
  // and no fourth course exists to add. Refusing a degree over a rule its own department
  // does not follow is the failure this codebase keeps paying for.
  //
  // So the bound is enforced wherever it is SATISFIABLE and dropped where it is not, which
  // is the most any method can promise. Nothing else relaxes: prerequisite order,
  // availability, distinctness, the credit cap and requirement coverage are all still in
  // force on this pass — a relaxed run yields a plan with a thin term, never a wrong one.
  //
  // And it keeps refusal honest. A refusal now means the relaxed problem is infeasible,
  // not that a stricter search ran out of time, which is the difference between a fact
  // about the degree and a fact about my search.
  // ── Give up a CONVENTION before giving up on the degree ───────────
  //
  // A refusal should mean "no legal plan exists", never "no plan exists that also follows
  // every convention we measured". Those are different claims, and only the first is worth
  // withholding a plan over: a student cannot register for a plan that breaks a prerequisite,
  // and can perfectly well follow one with five courses in a term.
  //
  // So the fallbacks relax, in order, the things that are conventions rather than rules:
  //
  //   1. the four-course full term        strong (95.8%) and not universal — architecture's
  //                                      16 SH studios cannot reach four inside the 19 SH cap
  //   2. the same-requirement cap         the corpus MAXIMUM, not a limit anyone enforces
  //      and the inherited slot cap       "no worse than this program's own worst term" is a
  //                                      courtesy; the corpus-wide 9 and 5 are the real bound
  //
  // What NEVER relaxes, at any rung: prerequisite order, availability, distinctness, the
  // registration credit cap, and requirement coverage. Those are the hard rules, the CI gate
  // asserts them at zero over all 1,031 shapes, and a relaxed plan differs from a strict one
  // only in being less conventional — never in being illegal.
  //
  // Each rung gets FRESH domains. A nogood records "cell C cannot be in term T" observed
  // under the constraint set that was in force, and with a constraint gone the observation may
  // simply be false — carrying it forward hands the tier meant to rescue coverage a space up
  // to 40 guesses smaller than the search that just failed. Measured separately: five known
  // refusals survived a SIX-FOLD budget increase unchanged, so they were never short of time;
  // they were looking in a space that had been narrowed.
  //
  // Reached on NODES rather than on the clock, so the same input always gets the same rungs
  // with the same allowances and generation stays deterministic.
  // The four-course rule is NOT on this ladder. It is a hard requirement — a full term with
  // room the student is not using is a defect, not a preference — and the reason it looked
  // unsatisfiable was a wrong metric rather than a real conflict: it was enforced as a course
  // COUNT, so a term carrying a 16 SH studio was called thin when it is in fact full. See
  // `termIsFull`. Fixing the metric made the rule both satisfiable and stronger, which is
  // strictly better than relaxing it.
  //
  // What remains here is genuinely conventional: the same-requirement cap is the corpus
  // MAXIMUM rather than a limit anyone enforces, and the inherited slot cap is a courtesy
  // ("no worse than this program's own worst published term") over the corpus-wide 9 and 5.
  const RUNGS = [
    // FIRST, and it gives up nothing that matters: the same constraints, searched in a plain
    // order. A plan found here is as legal as one found above and merely less well sequenced
    // before phase 2 gets to it.
    { gave: "sequencing-preferences", shape, preferenceFree: true },
    // Only then a convention: the same-requirement cap is the corpus MAXIMUM rather than a
    // limit anyone enforces, and `shape: null` swaps this program's own worst published term
    // for the corpus-wide 9 and 5.
    { gave: "term-width", shape: null, wideTerms: true, preferenceFree: true },
    // ── Last: the four-course bar itself ────────────────────────────
    //
    // It is a CONVENTION, and the rest of the system already says so — `gatePlan` keeps
    // `thin` out of `ok` precisely because "CHART relaxes it where it is unsatisfiable", and
    // 4.2% of published full terms miss it too. But nothing on this ladder relaxed it: a
    // four-course rung came off and was never replaced, so a degree that could not satisfy
    // the convention got no plan at all.
    //
    // That is the wrong trade by a distance. A plan with one full term at three courses is
    // legal, followable, and reported as `thin` — a student can read it and register from
    // it. A refusal hands them the department's published plan instead, which this corpus
    // measures at 31.9% season violations. Refusing to print a slightly light term while
    // recommending a wrong one is not conservatism.
    //
    // Last on the ladder, so it is only ever reached once arrangement and width have both
    // failed: the bar still shapes every plan that can satisfy it.
    { gave: "four-course-bar", shape: null, wideTerms: true,
      enforceCardinality: false, preferenceFree: true },
  ];
  const given = [];
  for (let ri = 0; ri < RUNGS.length; ri++) {
    const rung = RUNGS[ri];
    if (totalNodes >= nodeBudget || now() > deadline) break;
    given.push(rung.gave);
    const r = attemptPlacement({
      plans: plans.map(p => ({ ...p, domain: [...p.domain] })),
      terms, ports, studentType, courseMap, repeatable,
      // This rung's RESERVED share, not half of whatever the tiers before it left. See
      // `TIER_SHARES`: a share of the remainder is not a reservation, and it is how rung 1
      // came to consume rung 2's allowance.
      nodeBudget: Math.max(1, Math.min(
        Math.floor(nodeBudget * (TIER_SHARES.rungs[ri] ?? 0.2)),
        nodeBudget - totalNodes)),
      precedence, now, deadline, cal, propagateChains, seed,
      shape: rung.shape,
      enforceCardinality: rung.enforceCardinality ?? true,
      preferenceFree: rung.preferenceFree ?? false,
      // Relaxed to the corpus bound, which is still a bound: it forbids only what no
      // published plan does.
      sameReqMax: rung.wideTerms ? Infinity : cal.sameRequirementPerTermMax,
    });
    totalNodes += r.nodes;
    if (r.ok) {
      return {
        ...r, nodes: totalNodes, restarts: maxRestarts,
        // ── Report what was ACTUALLY given up, not what used to be ────
        //
        // This was a hardcoded `true`, left behind when the four-course rung came off the
        // ladder. Neither remaining rung relaxes cardinality — `enforceCardinality` is true
        // for both — so the report claimed the four-course bound had been dropped in 27
        // plans when it had been dropped in none, and the full sweep duly printed
        // "four-course bound relaxed in 27 plans". The plans were fine; the sentence about
        // them was false, and it was the kind of false that gets quoted.
        //
        // Derived from the rung instead, so the flag stays truthful if a cardinality-
        // relaxing rung is ever added again and cannot go stale if one is removed.
        cardinalityRelaxed: rung.enforceCardinality === false,
        // Named so the report — and the student — can see WHICH convention was spent. A plan
        // that quietly stops following a rule it claims to follow is worse than one that says
        // so.
        relaxed: [...given],
      };
    }
    last = r.failure ? r : last;
  }

  // ── Last resort: pack it, largest first ─────────────────────────────
  //
  // Placing courses in terms is BIN PACKING, and the search never consulted the one
  // dimension bin packing turns on: size. Pack every full term to 16 SH with 4 SH courses
  // and a 6 SH course fits nowhere — 16+6 > 19 in every full term, 8+6 > 9.5 in every half —
  // so the search backtracks through the whole tree looking for room that a different ORDER
  // would simply have left. That is what "exhausted the node budget" was measuring: of 249
  // refusals, 132 ended with space still unexplored and only 12 were ever proved impossible,
  // and the instances are LOOSE — business_administration_bsba is 31 cells into 10 terms
  // with 22 SH and 19 slots spare, every domain 9 or 10 terms wide.
  //
  // First-fit decreasing solves eight of nine of those in 5-36 ms with no backtracking at
  // all. Raising the node budget tenfold rescued one.
  //
  // LAST, though, and that placement is the whole safety argument. Tried first it would
  // replace carefully sequenced plans with merely legal ones across the corpus; tried as a
  // variable ordering inside the search it disrupts the machinery the DFS depends on and
  // cost seven plans of 154 in the sample. Reached only when every rung has failed, it can
  // do exactly one thing: turn a refusal into a plan. Phase 2 then sequences it like any
  // other, and `relaxed` says how it was found.
  // ── Run unconditionally, because a fallback funded by LEFTOVERS is unreachable ──
  //
  // This was gated on `now() <= deadline`, and that is the same defect the relaxed tier had
  // sixty lines up, for the same reason: the tiers before it spend the whole budget BY
  // CONSTRUCTION — they escalate until they hit it — so the rescue never ran in precisely the
  // cases that needed rescuing. International Business exhausted the clock at 18,622 nodes
  // and 40 restarts, the packer was skipped, and the degree was refused; given 200 nodes so
  // the ladder failed early, the packer solved it immediately.
  //
  // Ungated is affordable in a way another search tier would not be. This is ONE greedy pass
  // per feedBar setting — O(cells x terms) plus a single witness, measured at 5-36 ms — so it
  // cannot run away with the clock the way a DFS can. The time budget exists to bound a
  // search whose cost is unpredictable; spending a fixed handful of milliseconds to turn a
  // refusal into a plan is what the budget was being saved FOR.
  let packerFailure = null;
  {
    const g = packDecreasing({ plans, terms, ports, studentType, courseMap, repeatable,
                               precedence, cal, shape });
    if (g.ok) {
      return { ...g, nodes: totalNodes, restarts: maxRestarts,
               cardinalityRelaxed: true, relaxed: [...given, "packed-largest-first"] };
    }
    // Kept beside the search's own failure rather than replacing it. The search says which
    // cell it could not place; the packer says whether ROOM or the courses themselves were
    // the wall, and a refusal that carries both is the one worth reading.
    packerFailure = g.failure ?? null;
  }

  // ── A diversified retry phase was built here, measured, and REMOVED ──
  //
  // The observation that motivated it is real and still stands: refusals were ending at
  // exactly 16,251 nodes in 181–688 ms — the ladder's own arithmetic, strict 5,000 + rung
  // 7,500 + rung 3,750 — so they stopped holding 19% of the node budget and 96% of the wall
  // clock unspent, simply because there was no rung left to spend it on.
  //
  // Six extra attempts were added, each varying the ARBITRARY tie-break in `byConstraint`
  // (cells identical on claim, domain width, candidate count and depth are ordered by cell id
  // for no reason but determinism). Node counts duly rose from 16,251 to 20,001, proving the
  // leftover was being spent — and over a 344-shape sample it rescued **zero** programs.
  //
  // Why, in hindsight: varying the LAST key of a five-key comparator only re-orders cells that
  // tie on all four keys before it, and few do. The "different" order was nearly the same
  // order, so the search revisited the same region more thoroughly instead of looking
  // elsewhere. Diversification is still the right idea for a heavy-tailed search; the VALUE
  // order (which term a cell tries first) is the thing that actually varies, and that is where
  // a future attempt should perturb.
  //
  // Recorded rather than silently dropped, because the measurement is the useful part: the
  // unused budget is NOT the reason these programs refuse.

  const f = last?.failure?.lastObstruction ?? last?.failure;
  if (f?.cell != null && f.kind && f.kind !== "search-budget-exhausted") {
    return {
      ok: false, nodes: totalNodes, restarts: maxRestarts,
      // Whether the SPACE ran out or the ALLOWANCE did. Measured, 37 of 71 search refusals
      // end early — several inside 200 ms of a 5,000 ms clock — and reporting all of them as
      // "budget exhausted" is what pointed the next round of work at search strength for
      // programs the search had already settled. The two need different answers: one wants a
      // better search, the other wants a different shape or a correction to the catalog.
      exhaustedSpace: last?.exhaustedSpace ?? false,
      failure: { ...f, detail: describe(f), exhausted: true, packer: packerFailure },
    };
  }
  return {
    ...last, nodes: totalNodes, restarts: maxRestarts,
    exhaustedSpace: last?.exhaustedSpace ?? false,
    failure: last?.failure ? { ...last.failure, packer: packerFailure } : last?.failure,
  };
}

function attemptPlacement({
  plans, terms, ports, studentType, courseMap,
  repeatable, nodeBudget, deadline, now, precedence, shape = null,
  enforceCardinality = true, cal = DEFAULT_CALIBRATION,
  // The same-requirement bound, overridable by the relaxation ladder. `Infinity` still leaves
  // the slot cap and the credit cap in force; it only stops the corpus MAXIMUM being treated
  // as a limit someone enforces.
  sameReqMax = cal.sameRequirementPerTermMax,
  // Order terms by position alone, dropping every sequencing preference. NOT a relaxation:
  // the constraints are identical. See `termPreference`.
  preferenceFree = false,
  // Where the department puts each course, when it publishes a plan. A branch HINT and
  // nothing else — see `src/engine/seed.js` for why it cannot affect legality.
  seed = null,
  // See `precedenceRoom`. Test-only when false; production is always true.
  propagateChains = true,
}) {
  const cap = terms.map(t => termCapacity(t, { creditMax: ports.creditMax, studentType }));
  const slotCap = terms.map(t => termSlotCap(t, shape));
  const unlockValue = unlockValues(unlockUniverse(plans), courseMap);
  const unlockOf = (plan) => unlockOfCell(plan, unlockValue);
  const isPool = isPoolCell;
  const majorSubjects = majorSubjectsOf(plans, courseMap);
  // Computed once per attempt, not per branch: it is a property of the cell set.
  const seedHints = assignSeedHints(plans, seed);
  const unlockBar = generatorBar(plans, courseMap, unlockValue, majorSubjects);
  /** Does this cell open up enough of the degree to earn an early slot? */
  const isGenerator = (plan) => unlockOf(plan) >= unlockBar;
  const isMajor = (plan) => majorSubjects.has(cellSubject(plan, courseMap));

  // ── Rule 4: a DEPTH elective is placed by comparing it to the MAJOR'S OWN courses ──
  //
  // A depth elective names no course, so it has no depth of its own — it has an ESTIMATE, and
  // that estimate means nothing in isolation. What makes it decidable is the comparand: the
  // depth of the courses this degree actually requires. One comparison, opposite outcomes:
  //
  //   shallow major   its chains bottom out early, so the estimate stands ABOVE them. The
  //                   elective competes for early slots and wins some — correct, because in
  //                   a degree like International Business the electives ARE the depth.
  //   deep major      its chains run past a generic elective, so the same estimate stands
  //                   BELOW them. The elective loses those contests and fills in around.
  //
  // ── Why CHAIN HEIGHT and not course level ───────────────────────────
  //
  // Measured over 351 degrees with an elective pool (`chart-probe --electives`). Course level
  // was the obvious candidate and it CANNOT carry the comparison: the median major level target
  // is 0.36 for International Business and 0.36 for Computer Science and Mathematics — the two
  // benchmarks chosen precisely because they are opposites — and it takes only 4 distinct values
  // across the whole corpus. A comparand that is constant tells every elective the same thing.
  //
  // Max in-plan chain height separates them (IB 2, CS+Math 3) and has a real spread: p10 1,
  // median 2, p90 4, max 7, over 8 distinct values. It is also the RIGHT quantity on the
  // argument's own terms — the rule talks about chains running past an elective, and a chain is
  // what this measures. `chainHeight` is the same function `termPreference` uses below, so the
  // two cannot disagree about what a chain is.
  //
  // MAX rather than median: the median is 0 for over half the corpus, because most named cells
  // are leaves whatever the degree's shape. A degree is deep if it HAS a long chain, not if the
  // typical course sits on one.
  const majorHeights = precedence ? chainHeight(plans, precedence) : new Map();
  const majorChainMax = plans
    .filter(p => p.cell.kind === "named" && isMajor(p))
    .reduce((m, p) => Math.max(m, majorHeights.get(p.cell.id) ?? 0), 0);
  /**
   * Does a depth elective outrank this degree's own courses?
   *
   * `<=`, so a degree whose deepest chain is exactly as tall as a generic advanced course lets
   * the elective compete — International Business, at 2 against the estimate's 2, is that case
   * and is the degree the rule was written for.
   */
  const depthElectivesCompete = majorChainMax <= GE_DEPTH_ESTIMATE;
  /**
   * A depth elective that has earned a place in the ordinary ordering.
   *
   * Breadth electives are never this: they are shallow by nature and rule 3 leans them late.
   * Neither is anything in a deep major, which is why rule 5 reads as almost a consequence of
   * this one — in a deep degree the comparison has already put the elective behind.
   */
  const isCompetingDepthElective = (plan) =>
    depthElectivesCompete
    && plan.cell.target === GENERAL_ELECTIVE
    && plan.cell.geRole === "depth";

  /**
   * Who gets first claim on a scarce early term.
   *
   * 0  a chain-bearing course — genuinely the most constrained, and everything else
   *    depends on it, so it cannot be displaced by a preference
   * 1  a major-subject pool — the depth a co-op employer reads, and the thing the
   *    published plans put LAST. This is the deliberate inversion
   * 2  everything else specific, including a major requirement that unlocks nothing
   * 3  fillers, handled above and unconditionally last
   *
   * A depth elective in a SHALLOW major ranks 1, with the major-subject pools. Rule 4's
   * comparison has put it above the degree's own courses, and 1 is where "the depth a co-op
   * employer reads" already sits — so it enters the ordering the engine already uses rather
   * than getting a tier of its own.
   */
  const claimRank = (plan) => {
    if (isCompetingDepthElective(plan)) return 1;
    if (isPool(plan)) return isMajor(plan) ? 1 : 2;
    return isGenerator(plan) ? 0 : 2;
  };
  const rank = new Map(plans.map(p => [p.cell.id, claimRank(p)]));
  const rankOf = (p) => rank.get(p.cell.id) ?? 2;

  // Deterministic order before any heuristic reorders: two runs must agree.
  //
  // `fillerOf` is what lets rule 4 reach the ordering at all. `byConstraint`'s first key puts
  // fillers last UNCONDITIONALLY, and a general elective is a filler by the only test available
  // there — `candidates === null`. So a depth elective could be ranked 1 all day and never be
  // compared on it, because the filler key decides first. Passing the predicate in keeps the
  // decision here, next to the comparison that makes it, instead of teaching a module-level
  // helper about elective roles.
  const fillerOf = (p) => p.candidates === null && !isCompetingDepthElective(p);
  const order = [...plans].sort((a, b) => byConstraint(a, b, terms.length, rankOf, fillerOf));

  const byId = new Map(plans.map(p => [p.cell.id, p]));
  const termOf = new Map();
  // ── Rule 5's index: which terms a MAJOR NAMED cell could still use ──
  //
  // Precomputed and then maintained incrementally, because the alternative is a scan. Written
  // first as a loop over `order` inside the term comparator, it was O(cells) per comparison
  // inside a sort that runs at every node — the same ~2,000-operations-per-node cost the Hall
  // propagator above was removed for. A counter per term is O(1) at the only place that reads it.
  //
  // Named cells only, and major subjects only. A choice cell guarantees neither branch, so it has
  // no claim to press; and a non-major requirement is not what rule 5 protects — the rule is that
  // an elective must not displace THE MAJOR, which is the depth a co-op recruiter reads.
  const majorWants = new Map();
  const majorUnplacedIn = new Array(terms.length).fill(0);
  for (const p of plans) {
    if (p.cell.kind !== "named" || !isMajor(p)) continue;
    const wants = (p.domain ?? []).filter(t => t >= 0 && t < terms.length);
    if (!wants.length) continue;
    majorWants.set(p.cell.id, wants);
    for (const t of wants) majorUnplacedIn[t] += 1;
  }
  const loadSH = new Array(terms.length).fill(0);
  const countIn = new Array(terms.length).fill(0);
  // Courses of at least 3 SH per term, which is a different count from the cells above:
  // a one-credit lab and a course are not two courses. See `underFilled`.
  const bigIn = new Array(terms.length).fill(0);
  // Credits held by REAL courses, tracked beside their count. `termIsFull` measures its slack
  // against this rather than the total load, so a term padded with labs is not mistaken for
  // one that is genuinely full — see `termIsFull`.
  const bigSH = new Array(terms.length).fill(0);
  // Tracked separately from the course count, and PER REQUIREMENT: a term at its
  // elective cap can still take a real course, and stacking four cells of one
  // requirement — four "General Elective" cards, or three "Mathematics Elective" — is
  // the specific thing that reads as unrealistic.
  //
  // Keyed by requirement target rather than by `~general`, because the departments do
  // not treat `~general` specially: measured, they hold 3+ cells of ANY one requirement
  // in 0.7% of terms, against CHART's 14.3%. A cell with no target is its own key, so
  // an unlabelled cell never crowds out anything but itself.
  const reqIn = terms.map(() => new Map());
  // ── An UNGUIDED cell is its own requirement, and a scarcer one ──────
  //
  // Every general elective shares one key, so `sameReqMax` already caps them at 4 a term —
  // and 4 is right, because departments do put 4 elective-bucket cells in a term. What they
  // almost never do is leave four of them UNGUIDED. Measured over 5,978 published study
  // terms: cells labelled only "Elective" or "General Elective" number ≤2 in 98.8% of terms,
  // 3 in 55, 4 in 14. Past two they buy the headroom by NAMING — "PSYC elective",
  // "Upper-division elective", "Foreign language core course".
  //
  // So the convention is not a limit on electives, it is a limit on how many cells a term
  // may leave unsaid. A cell bound to an unmet competency is named and counts under the
  // ordinary elective key; one that stands for nothing gets this stricter key, which is what
  // stops International Business printing four identical cards in a term three times over.
  //
  // Keyed rather than special-cased, so it rides the machinery that already exists — the
  // per-term count, the crowding comparator and the relaxation rung all treat it as one more
  // requirement, and `wideTerms` still lifts it when nothing else will fit.
  const UNGUIDED = "~general:unguided";
  // ── The GENERAL ELECTIVE bucket is capped harder than any other ────
  //
  // `sameRequirementPerTermMax` is 4 and correct for requirements in general: departments do
  // put four cells of one requirement in a term. General electives are the exception the
  // student notices, because four of them side by side is a term with nothing in it to read.
  //
  // Three, not two — and two was tried. Departments leave two or fewer cells unsaid in 98.8%
  // of 5,978 published terms, so two looks like the convention and it measured WORSE on every
  // axis: refusals 28 -> 30 and thin terms 6 -> 13 on the sample.
  //
  // The reason is an interaction worth stating, because the number looks safe on its own. A
  // general elective is 4 SH, so it IS a real course by `realCourseSH` and counts toward the
  // four-course bar. Capping the bucket at two starves that bar in exactly the degrees that
  // lean on electives to fill their terms — the rule meant to stop terms looking empty made
  // more of them genuinely short.
  // And THREE is the ceiling at every rung, including the loosest. Four cells of one ordinary
  // requirement is fine — four `Concentration` cards is a real semester with a real shape.
  // Four GENERAL ELECTIVES is not: it is a term with nothing in it to read, and it is the
  // specific thing the International Business benchmark showed. So unlike every other
  // requirement, this bucket does not widen when `wideTerms` lifts the general cap.
  const UNGUIDED_PER_TERM_MAX = UNGUIDED_PER_TERM_CAP;
  const UNGUIDED_RELAXED_MAX = UNGUIDED_PER_TERM_CAP;
  // EVERY general elective shares this key, labelled or not. Counting only the unlabelled
  // ones let a term hold three of those plus every breadth-labelled cell on top, which is
  // still four "General Elective" cards to the student — the bucket is what clumps, not the
  // wording on it.
  const reqKey = (cell) =>
    cell.target === GENERAL_ELECTIVE ? UNGUIDED : (cell.target ?? `#${cell.id}`);
  const reqCount = (ti, cell) => reqIn[ti].get(reqKey(cell)) ?? 0;
  /**
   * The per-term ceiling for THIS cell's requirement.
   *
   * `sameReqMax` is 4, the corpus maximum for cells of one requirement, and it stays 4 for
   * anything the plan can name. An unguided elective gets 3 instead: departments reach 3 in
   * 55 of 5,978 terms and 4 in 14, so 3 is inside what they do and 4 is the 0.2% tail CHART
   * was living in.
   *
   * The `wideTerms` rung lifts `sameReqMax` to Infinity, and this must NOT lift with it. A
   * first version tied the two and the cap silently vanished for every program that reached
   * that rung — International Business among them, which is how it went on printing four
   * identical cards in a term after the cap was added. Relaxed by ONE step instead, to the
   * corpus maximum: even at the loosest rung there is no evidence for a fifth unguided cell
   * in a term, so there is no reading of the corpus that licenses one.
   */
  const maxPerTerm = (cell) => {
    if (reqKey(cell) !== UNGUIDED) return sameReqMax;
    return Number.isFinite(sameReqMax)
      ? Math.min(sameReqMax, UNGUIDED_PER_TERM_MAX)
      : UNGUIDED_RELAXED_MAX;
  };
  let nodes = 0;
  let worstFailure = null;
  // Reporting only — never fed to nogood learning. See the `block` calls in `step`.
  let blockedBy = null;

  // How many cells each course could answer. Computed once over the BOUNDED cells
  // only — an unbounded cell admits everything, so counting it would flatten the
  // signal to a constant and tell the witness nothing.
  const contentionOf = buildContention(plans);

  const assignedCells = () => order
    .filter(p => termOf.has(p.cell.id))
    .map(p => ({ ...p.cell, term: termOf.get(p.cell.id) }));

  const runWitness = (checkPrereqs) => witnessPlan({
    cells: assignedCells(),
    // Season-prefiltered and truncated for the propagator; whole for the final,
    // prereq-aware witness, where truncation could hide the one candidate whose
    // prerequisites are actually met. domains.js `wideAtFor` has the argument.
    candidatesOf: checkPrereqs
      ? (c) => byId.get(c.id).candidates
      : (c, season) => byId.get(c.id).seasonOk.get(season) ?? null,
    terms, courseMap,
    offeringProbability: ports.offeringProbability,
      offered: ports.offered,
    repeatable, checkPrereqs, contention: contentionOf,
    // The propagator's lists are truncated, and a truncation may not be intersected with a
    // concentration option's pool — see `witnessPlan`. Tied to `checkPrereqs` because the two
    // callers are the same two, but stated separately: they are different claims, and a future
    // caller passing complete lists with `checkPrereqs: false` must not silently lose the
    // per-option check.
    candidatesComplete: checkPrereqs,
  });

  // ── Room is RESERVED for the electives, not left over ─────────────
  //
  // Fillers are placed last, so with no reservation the specific courses fill every
  // early term to the department's own target and the electives land wherever is
  // left — which is the final year, four at a time. Measured, real plans carry a
  // general elective in 56% of their terms; CHART managed 34%.
  //
  // The departments' `targetSH` is not the problem: their 19 SH first term ALREADY
  // includes their electives. Ours has to leave the same room, so a term's target for
  // a specific course is its stated target minus this term's share of the electives
  // still to come. An even share, because nothing in the corpus prefers any term.
  // ── And a reservation has to be a RANK, not a tie-break ───────────
  //
  // The first version subtracted the reserve inside `fill()`, which is the LAST term of
  // the sort — after earliest-first, which decides every comparison before it is
  // reached. So it changed nothing: CS+Math still filled year 1 to 19 SH and put seven
  // general electives in the last two terms. The hard cap is the registration limit, not
  // the department's target, so nothing else was stopping it either.
  //
  // As a rank it works, and it stays a preference: a term with no room left is tried
  // LAST rather than removed, so a program whose electives genuinely do not fit
  // anywhere else still gets a plan.
  const fillerSH = plans.filter(p => p.candidates === null)
    .reduce((n, p) => n + (p.cell.sh ?? 0), 0);
  const reserve = terms.map((t) => (t.optional ? 0 : fillerSH / Math.max(1,
    terms.filter(x => !x.optional).length)));

  // How full a term is relative to what the shape intends for it. `targetSH` is
  // the department's own stated intent; where a shape does not state one, an
  // equal share of total demand stands in, so a derived skeleton balances too.
  const evenShare = plans.reduce((n, p) => n + (p.cell.sh ?? 0), 0) / (terms.length || 1);
  const target = (ti) => terms[ti]?.targetSH || evenShare || 1;
  const fill = (ti, isFillerCell = false) => loadSH[ti] /
    Math.max(1, target(ti) - (isFillerCell ? 0 : reserve[ti]));

  const heightOf = precedence ? chainHeight(plans, precedence) : new Map();
  const span = Math.max(1, terms.length - 1);

  /**
   * Which terms to try, for one cell.
   *
   * Emptiest-first alone produced plans that were legal and visibly wrong: a
   * 3000-level Number Theory course in the second term, first-year Discrete
   * Structures in year two, a first-year seminar in year four. Load balance has no
   * opinion about sequencing, so it filled whatever happened to be empty.
   *
   * So a cell that unlocks a long chain takes the EARLIEST legal term, because every
   * term it slips costs the whole chain behind it — and racing up the chains is also
   * what puts real depth before the first co-op. A cell that unlocks nothing has no
   * such claim and goes where courses of its level conventionally sit, which is a
   * prior for the prerequisite edges the catalog never recorded rather than a rule of
   * its own. Load balance survives as the tie-break it should always have been.
   */
  // A term the published plan leaves empty is a last resort, whatever else prefers
  // it. Ranked ahead of every other consideration so the preference cannot be
  // outvoted by load balance or a level target.
  const optional = terms.map(t => (t.optional ? 1 : 0));
  const byOptional = (a, b) => optional[a] - optional[b];

  // Spreading beats position, for EVERY requirement and in BOTH branches below.
  //
  // A term already carrying `SAME_REQ_PER_TERM` cells of this cell's requirement is
  // tried only after every term that is not — which turns "four stacked in year 4" into
  // "one or two here and there" without forbidding the fourth outright.
  //
  // It has to outrank earliest-first, or the major branch defeats it: three Mathematics
  // Electives all legal from term 4 onwards all take term 4, which is exactly what
  // CS+Math did. It must NOT outrank the standing floor, which is about legality-in-
  // practice rather than taste.
  const crowded = (plan, ti) => (reqCount(ti, plan.cell) >= cal.sameRequirementPerTerm ? 1 : 0);

  /**
   * A full fall or spring still short of four real courses wants this cell; a term that
   * already has its four does not.
   *
   * ── The reason every earlier attempt at this was INERT ─────────────
   *
   * MEASURED over 94 programs: of 50 with a thin full term, **0** were short of courses
   * and **50** had courses that went elsewhere. 30 real courses for 24 slots, and still a
   * thin term. So it was never arithmetic — it was always ordering, and three separate
   * fixes failed to change the number at all.
   *
   * They failed for one reason. `Math.abs(ti / span - want)` is a near-continuous value,
   * so it almost never ties, so it decided every comparison and every rank below it was
   * dead code. Both `takesReserved` and this were ranked under it. Removing this rank
   * changed the measurement by nothing — 8.3% either way — which is the proof it was
   * never running.
   *
   * A tie-break only works where ties exist. So the level distance is truncated to WHOLE
   * TERMS (`levelGap`): two terms within one term of the level target are equally
   * conventional — which they genuinely are, `LEVEL_POSITION` being a median over 12,848
   * placements rather than a per-term prediction — and THAT is the tie in which "does
   * this fall still need a fourth course" gets to decide.
   *
   * The slot cap was never the missing bound either. It is an upper bound, taken from the
   * published plan's own worst term (often 5–7 courses), and load balance is by CREDITS.
   * A fall with three big courses at 17 SH is perfectly balanced by credit and perfectly
   * legal, and nothing in the system ever wanted a fourth course in it.
   */
  const underFilled = (ti) => {
    if ((terms[ti].weight ?? 1) < 1) return 1;      // a half term cannot satisfy the rule
    return termIsFull(bigIn[ti], loadSH[ti], cap[ti], cal, studentType, bigSH[ti]) ? 1 : 0;
  };

  /**
   * Distance from where this cell's level conventionally sits, in WHOLE TERMS.
   *
   * The truncation is the point: it manufactures the ties that `underFilled` and the
   * elective reserve need in order to have any effect at all. See above.
   */
  const levelGap = (ti, want) => Math.floor(Math.abs(ti / span - want) * span);

  /**
   * Would this small cell spend the credit a full term still needs for its real courses?
   *
   * The four-course bar is the principal rule for a full term and the credit envelope is
   * what limits the EXTRAS — you cannot take four courses each with a one-credit lab,
   * because that is 20 credits. The search had it the other way round: credits were the
   * only currency at placement, so a one- or two-credit cell was free to consume the
   * budget and the bar was left unsatisfiable afterwards. Measured, 60 thin full terms
   * have the courses to fix them sitting elsewhere, and the worst reads `2 real courses,
   * 16 SH` — eight of those credits are labs and seminars.
   *
   * A PREFERENCE, and that distinction is the whole lesson. Written first as a veto in
   * the placement loop it took International Business from a plan with a short spring to
   * no plan at all: removing options does not help a search find an arrangement, it makes
   * it fail. Here it steers and nothing is forbidden, so a degree whose small courses
   * genuinely have nowhere else to go still gets its plan.
   *
   * Zero for a term that already holds its four — labs and seminars belong exactly there.
   */
  const crowdsOutAReal = (plan, ti) => {
    if (bigCell(plan) || (terms[ti].weight ?? 1) < 1) return 0;
    const min = minCoursesFor(cal, studentType);
    if (min <= 0) return 0;                       // no such convention for graduates
    const owed = Math.max(0, min - bigIn[ti]);
    if (owed === 0) return 0;
    return loadSH[ti] + (plan.cell.sh ?? 0) + owed * cal.realCourseSH > cap[ti] + 0.01 ? 1 : 0;
  };

  /**
   * Would this cell take the room a later elective needs? A specific course prefers a
   * term that still has its share of elective space free; an elective ignores the
   * reserve, since the reserve exists for it.
   */
  const takesReserved = (plan, ti) => {
    if (plan.candidates === null) return 0;
    return loadSH[ti] + (plan.cell.sh ?? 0) > target(ti) - reserve[ti] ? 1 : 0;
  };

  /**
   * Rule 5: would this elective take a slot a major course still needs?
   *
   * The converse of `takesReserved`, and the counterweight to rule 4. Rule 4 lets a depth
   * elective compete for early terms in a shallow degree, which is right, and it creates the
   * risk this answers: an elective can go ANYWHERE, and a major course whose prerequisites are
   * now met has a reason to be exactly here. Measured on `computer_science_and_mathematics_bs`,
   * a reservation took Year 1 Summer 1 and CS 3100 ended up in Year 2 Fall.
   *
   * Two conditions, both necessary. The term must have no room left for a real course AFTER this
   * elective takes its slot — if it does, nothing is displaced and there is no contest. And some
   * still-unplaced major named cell must actually be able to use the term; a slot no major course
   * could occupy is not one an elective is taking from anything.
   *
   * ── A PREFERENCE, and this file has already paid for learning that ──
   *
   * The design note argues that a correct rule stated as a CONSTRAINT removes a class of
   * failures while a preference relocates it, and rule 2 is exactly that. Rule 5 is not, and the
   * evidence is two rungs up this same comparator: `crowdsOutAReal` was "written first as a veto
   * in the placement loop [and] took International Business from a plan with a short spring to no
   * plan at all". Removing options does not help a search find an arrangement.
   *
   * The difference between the two rules is what they bound. Rule 2 caps a term's contents, so it
   * can be checked against the term alone and a refusal is a real statement about the plan. Rule
   * 5 is about a cell that has not been placed yet, so as a veto it would forbid a placement on a
   * prediction — and when the prediction is wrong the student gets no plan instead of an
   * imperfect one. Conservative beats clever: this steers, and a degree whose electives genuinely
   * have nowhere else to go still gets its plan.
   */
  const yieldsToMajor = (plan, ti) => {
    if (plan.cell.target !== GENERAL_ELECTIVE) return 0;
    if (majorUnplacedIn[ti] <= 0) return 0;           // no major course wants this term
    const afterSH = loadSH[ti] + (plan.cell.sh ?? 0);
    const afterN = countIn[ti] + coursesInCell(plan.cell);
    // Room for one more real course afterwards means this elective displaces nothing.
    const roomLeft = afterN < slotCap[ti] && afterSH + cal.realCourseSH <= cap[ti] + 0.01;
    return roomLeft ? 0 : 1;
  };

  const termPreference = (plan) => {
    // ── FEASIBILITY MUST NOT DEPEND ON TASTE ────────────────────────
    //
    // This file's own header says phase 1 "does not try to find a GOOD one; that is phase 2's
    // job", and everything below this line contradicts it: level targets, a standing floor,
    // unlock ranking, pool reachable-share, an elective reserve, crowding, and demoting the
    // summers a department left blank. Phase 1 has been trying to produce a good plan, and
    // that is precisely how it sometimes produces NONE.
    //
    // Branch order cannot change what is legal — only which legal thing is found first, and
    // whether one is found inside the budget. So every preference here is a way to spend the
    // budget looking somewhere prettier, and when the pretty region holds no solution the
    // student gets nothing. Three of today's defects were exactly that and nothing else:
    // `optional` summers made Architecture unsolvable, the standing floor cost 15 points of
    // coverage, and `takesReserved` pulled a 4000-level pair into year 1.
    //
    // `preferenceFree` is the answer to that, and it is deliberately not a relaxation: the
    // constraints are identical on this pass. It orders terms by nothing but position, so the
    // search explores the whole space in a fixed, cheap order instead of the region our
    // measurements consider handsome. Sequencing is not lost — phase 2 owns it and verifies
    // every move against the same hard rules — it is simply approached from the other side.
    //
    // The property worth having: adding a sequencing preference can no longer make a program
    // unplannable. Which is the guarantee the priority order demands, since a student cannot
    // register for a plan that does not exist, and can perfectly well follow an ugly one.
    // ── The advisor's own answer, tried first ───────────────────────
    //
    // Ahead of `preferenceFree` deliberately, because it is not one of the tastes that
    // clause exists to strip. Those preferences guess at where a course belongs from level
    // conventions and unlock value; this one READS where a department actually put it, in a
    // plan we have measured to be legal. Ordering by distance to that term searches outward
    // from a known-good arrangement instead of from position 0, which is the difference
    // between finding it in the budget and exhausting it.
    //
    // Still only an order. A seeded term that precedence has already excluded is simply not
    // in `plan.domain` and never gets tried.
    // ── ONLY where the preferences have already been dropped ──────────
    //
    // This ran FIRST, ahead of every sequencing preference, and that was a bad trade made
    // without measuring the thing it traded away. The level and unlock orderings below are
    // what keep 4000-level courses late and high-unlock courses early — 12,848 measured
    // placements' worth — and a hint consulted before them silently replaces all of it.
    //
    // Computer Science BSCS is what it looks like from a student's chair: `CS 4530 or 4535` in
    // YEAR ONE SPRING, and CS 3000 — which unlocks most of the major — at the end. Both plans
    // are legal (CS 4535 records no prerequisites, so the witness is right), and both are
    // advice no advisor would give. The refusal and empty-term numbers I was watching did not
    // move, because those are not what this breaks.
    //
    // So the hint now applies only under `preferenceFree`, where the ladder has already given
    // the preferences up and the alternative is position order — there it is strictly better
    // information, and it is what rescues the saturated instances. Where preferences still
    // apply, they win, because they are measured and this is a guess.
    if (preferenceFree) {
      const seededTerm = seedHints.get(plan.cell.id) ?? null;
      return [...plan.domain].sort((a, b) => byOptional(a, b)
        || (seededTerm == null ? 0 : Math.abs(a - seededTerm) - Math.abs(b - seededTerm))
        || a - b);
    }
    const filler = plan.candidates === null;
    const f = (ti) => fill(ti, filler);
    // Where courses of this level conventionally sit, INSIDE the window precedence
    // already narrowed the cell to. Two mechanisms doing two jobs:
    //
    //   precedence   guarantees order, as a hard constraint, and narrows the domain
    //                to [earliest, latest] so a chain provably fits
    //   level        chooses WITHIN that window, from 12,848 measured placements
    //
    // Earliest-first was tried and is wrong, in an instructive way. It reads the
    // critical path as "start every chain immediately", when the actual claim is
    // "do not DELAY a chain past its slack". Industrial Engineering duly put
    // `MEIE 4701` and `IE 4530` — a senior capstone pair, chain height 1 — in the
    // first term of year 1, because they unlock something and the term was empty.
    //
    // Co-op depth is not sacrificed to this; it is the objective layer's rank-1 job
    // to pull major courses earlier inside a tolerance band, which is exactly what a
    // ranked list with bands is for. What the base plan owes it is a sane starting
    // point and empty early terms, and `isFiller` last is what supplies those.
    // A MAJOR course goes as early as its prerequisites allow. Everything else goes
    // where its level suggests, and a cell with no level at all — a general elective
    // — goes at the end.
    //
    // This is what the corpus actually does, and it took three wrong heuristics to
    // see it. CS+Math has 132 credits and barely 15 of them at 1000 level, while
    // year 1 holds 57: no arrangement makes year 1 all first-year courses. The
    // published plan fills it with CS 2000, CS 2100, CS 2800 and CS 3100 — MAJOR
    // depth, two and three levels up, in the first year. Ordering by level put
    // general electives there instead, which is the defect this engine exists to fix;
    // ordering by chain height put senior capstones there, because they unlock one
    // thing each.
    //
    // "As early as prerequisites allow" is safe because `plan.domain` has already
    // been narrowed to the precedence window, so earliest here cannot mean earlier
    // than legal.
    if (majorSubjects.has(cellSubject(plan, courseMap))) {
      // ── A major-subject POOL is placed by its reachable share ─────
      //
      // And this is a DELIBERATE departure from the corpus, recorded as such. Published
      // plans put major-subject pools at median position 0.67 and general electives at
      // 0.56 — their major electives come LATER than their free ones, behind terminal
      // requirements that come earlier. That ordering does not serve the student it is
      // written for: a co-op employer reads depth in the major, and a `Number Theory 1`
      // that unlocks nothing does not supply any, while the elective the student would
      // have chosen for that reason sits in the final term where no recruiter sees it.
      //
      // So a pool goes as EARLY as its share allows, not as early as it is legal. The
      // share is what stops that being nominal — see POOL_REACH_MIN.
      if (isPool(plan)) {
        const thin = (ti) => ((plan.reachAt?.[ti] ?? 1) < cal.poolReachMin ? 1 : 0);
        return [...plan.domain].sort((a, b) =>
          byOptional(a, b) || crowdsOutAReal(plan, a) - crowdsOutAReal(plan, b)
            || thin(a) - thin(b)
          || crowded(plan, a) - crowded(plan, b)
          || takesReserved(plan, a) - takesReserved(plan, b)
          || a - b || f(a) - f(b));
      }
      // ── A named major course, ranked by what it opens up ──────────
      //
      // A course that opens up little of the degree has no claim on an early slot and is
      // taking one from a course that does. Its own requirement still has to be met, so
      // it is not dropped — it is placed where its level says, which is later, and the
      // early terms it vacates are what let the electives above come forward.
      //
      // The bar is this program's own median, not zero. See `generatorBar`: a zero bar
      // ranked `MATH 3527`, which unlocks one pool candidate, alongside `CS 2000`, which
      // unlocks 57.
      if (!isGenerator(plan)) {
        // ── The level target outranks the elective reserve, HERE ONLY ──
        //
        // These two were the other way round, and it is what left `MATH 2341` — a
        // required major course with a 2000-level target of 0.36 — in the last term of
        // year 4. The reserve marks every term already at its credit target, and by the
        // time a below-bar cell is placed that is every early term and none of the late
        // ones, so the reserve alone chose the term and the level target never spoke.
        //
        // Changed in this branch only. The generator branch below wants the earliest
        // legal term and the reserve is the right tie-break there; the non-major branch
        // after it is dominated by general electives, whose `want` falls through to 1 and
        // for which the reserve is exactly the mechanism that spreads them. Reordering
        // all three at once was tried and cost the elective spread across the board.
        const want = cellLevelTarget(plan, courseMap, studentType) ?? 1;
        return [...plan.domain].sort((a, b) =>
          byOptional(a, b) || crowdsOutAReal(plan, a) - crowdsOutAReal(plan, b)
            || crowded(plan, a) - crowded(plan, b)
          || levelGap(a, want) - levelGap(b, want)
          || underFilled(a) - underFilled(b)
          || takesReserved(plan, a) - takesReserved(plan, b)
          || f(a) - f(b) || a - b);
      }
      // Earliest, but not before a real plan has ever put a course of this level.
      // The floor stands in for class standing, which the catalog states only in
      // prose and our data therefore does not have — without it, "as early as
      // possible" put a 4000-level CS course in the first term.
      // A PREFERENCE, expressed as ordering and never as a filter. Filtering the
      // domain to terms at or after the floor cost 15 percentage points of coverage
      // — 77.4% down to 62.6% — because it removed legal terms the search needed for
      // capacity and turned a taste into an infeasibility. Terms below the floor are
      // tried last, not excluded.
      const floor = cellLevelFloor(plan, courseMap, studentType) * span;
      return [...plan.domain].sort((a, b) =>
        byOptional(a, b) || crowdsOutAReal(plan, a) - crowdsOutAReal(plan, b)
          || (a < floor ? 1 : 0) - (b < floor ? 1 : 0)
        || crowded(plan, a) - crowded(plan, b)
        || takesReserved(plan, a) - takesReserved(plan, b)
        || a - b || f(a) - f(b));
    }
    // A cell with no claim on any term wants the END.
    //
    // Measured against the departments' own plans, "emptiest term" was losing the
    // argument this engine was built to win: CHART put 773 unnamed cells in the first
    // 30% of the plan against their 583, mean position 0.576 against 0.601. Being
    // placed last in the search ORDER is not the same as wanting the last TERM — the
    // early terms are the emptiest once every specific course has claimed its slot,
    // so load balance quietly walked the electives forward.
    //
    // ── What counts as having no claim, stated once ────────────────
    //
    // It was "a cell with no level at all", which meant only the general electives, and
    // that definition was too narrow by exactly one case. CS+Math's `Supporting Course`
    // is 11 options across 7 unrelated subjects, unlocks NOTHING in the degree, and
    // belongs to neither major — and it has a level target of 0.36 purely because its
    // option list contains some 2000-level courses. It was landing in year 1 ahead of
    // required major courses, and later, once the reserve was reordered, at the end only
    // by accident of load.
    //
    // The general rule: NOTHING IN THE DEGREE DEPENDS ON IT AND IT IS NOBODY'S MAJOR.
    // Such a requirement still has to be met, so it is not dropped — it simply has no
    // argument for any particular term, and the level of options the student did not
    // choose from is not such an argument. That is the same thing a general elective is,
    // so it is handled by the same line rather than a rule about "supporting courses".
    //
    // The check that this is the right cut, and not just a cut that moves the cell
    // complained about: `College Writing` (ENGW 1111 or 1102) unlocks 8 and so is NOT
    // filler, keeping the 0.00 target that puts first-year writing in year one, which
    // 100% of published plans do. `Advanced Writing` unlocks nothing and is nobody's
    // major, so it becomes filler and goes late — where the corpus puts it anyway
    // (median 0.78, p90 0.89).
    const noClaim = unlockOf(plan) === 0 && !majorSubjects.has(cellSubject(plan, courseMap));
    // A cell that carries its own target uses it. General electives USED to — a positional
    // ramp across the pool — and no longer do: see `deriveCells`, where the ramp was deleted
    // because a hand-fitted curve on top of a graph-derived ordering can only disagree with it.
    // The `??` is kept because the field is still part of the cell contract and a caller may
    // legitimately set one; nothing in the engine does today, so electives fall through to
    // `noClaim` and want the END, which is what rules 2 and 4 then argue with.
    const want = plan.cell.levelTarget
      ?? (noClaim ? 1 : (cellLevelTarget(plan, courseMap, studentType) ?? 1));
    return [...plan.domain].sort((a, b) =>
      byOptional(a, b) || crowdsOutAReal(plan, a) - crowdsOutAReal(plan, b)
        // Rule 5, ranked here on purpose. Below `crowdsOutAReal`, because a term that cannot
        // otherwise reach four real courses is a HARD criterion and rule 5 yields to it — the
        // alternative is a refused plan. Above the level target and load balance, because those
        // are about where a cell would look nice and this is about a major course losing a slot
        // it had a reason to hold.
        || yieldsToMajor(plan, a) - yieldsToMajor(plan, b)
        || crowded(plan, a) - crowded(plan, b)
      || levelGap(a, want) - levelGap(b, want)
      || underFilled(a) - underFilled(b)
      || takesReserved(plan, a) - takesReserved(plan, b)
      || f(a) - f(b) || a - b);
  };

  /**
   * Would putting `cellId` in term `ti` break an edge with a cell already placed?
   *
   * Checked in both directions. A predecessor already placed later, or a successor
   * already placed earlier, are equally fatal, and the search assigns in
   * most-constrained order rather than topological order — so a successor is
   * frequently placed before its predecessor.
   */
  const violatesPrecedence = (cellId, ti) => {
    if (!precedence) return false;
    for (const aId of precedence.before.get(cellId) ?? []) {
      const at = termOf.get(aId);
      if (at == null) continue;
      const same = precedence.concurrentOk.has(`${aId}|${cellId}`);
      if (same ? at <= ti : at < ti) continue;
      return true;
    }
    for (const bId of precedence.after.get(cellId) ?? []) {
      const bt = termOf.get(bId);
      if (bt == null) continue;
      const same = precedence.concurrentOk.has(`${cellId}|${bId}`);
      if (same ? ti <= bt : ti < bt) continue;
      return true;
    }
    return false;
  };

  // ── The per-term LOWER bound, as a propagator ─────────────────────
  //
  // Every other constraint here is an upper bound — a credit cap, a slot cap, a
  // same-requirement cap — and upper bounds prune monotonically: once a term is over, no
  // later placement can rescue it, so the search cuts immediately. "Four real courses in
  // every full fall and spring" is a LOWER bound, and that asymmetry is the whole reason
  // it resisted four separate fixes:
  //
  //   a PREFERENCE cannot guarantee it   preferences do not count things
  //   a REPAIR PASS acts too late        the search has already committed, so which cells
  //                                      remain movable is path-dependent — the flakiness
  //   a TIE-BREAK was literally dead     ranked under a continuous comparator that never
  //                                      ties, so it never ran. Removing it changed
  //                                      nothing, which is how it was found
  //
  // A lower bound is only VIOLATED at the end, but it becomes UNSATISFIABLE much earlier,
  // and counting is what detects that. This is the standard global-cardinality relaxation:
  // if a term in use still needs more courses than there are unplaced cells that could go
  // there, no completion can satisfy it, so the branch is dead now.
  //
  // Sound and incomplete, in that order. Sound because `need > possible` genuinely admits
  // no completion — nothing valid is ever cut. Incomplete because it reasons per term: two
  // terms each needing two, with three cells that could serve either, passes this and
  // fails Hall's condition. The exact version is a flow; this is the O(1) relaxation, and
  // it is the same trade `buildContention` already makes for `alldifferent`.
  //
  // `suffix[i][t]` counts the big cells at or after position i whose domain contains t.
  // Precomputed once per attempt because domains do not move inside one, so maintaining it
  // costs nothing per node.
  const bigCell = (p) => (p.cell.sh ?? 0) >= cal.realCourseSH;
  // Undergraduate only. A master's has no four-course convention — measured, 39% of published
  // graduate full terms carry zero or one course, and four 4 SH courses is its ENTIRE 16 SH
  // envelope — so enforcing it there imposes a habit those degrees do not have.
  const minCourses = minCoursesFor(cal, studentType);

  // ── The four-course rule has an UPPER bound too, and it is derivable ──
  //
  // Industrial Engineering is the case that shows why this matters. It has 32 real
  // courses, 6 full terms and 4 half terms:
  //
  //     6 full x 4 = 24 minimum        4 half x 2 = 8 maximum        24 + 8 = 32
  //
  // Exactly the number of courses. There is ZERO slack, so the distribution is FORCED:
  // every full term holds exactly four and every half term exactly two. A branch that
  // puts five in a full term is dead — some other full term must then hold three — and
  // the search was exploring those branches until the budget expired, then reporting
  // "search-budget-exhausted", which is a statement about the search and not the degree.
  //
  // The slack is a single subtraction and it bounds every term at once. Where a degree has
  // room, this is loose and costs nothing; where it is tight, it collapses the space.
  //
  // Sound: a term exceeding `min + slack` forces some other term below its minimum, by
  // counting alone. Nothing valid is cut.
  // A half term is an OPTIONAL consumer, and the first version of this got that wrong.
  // It computed the slack as
  //
  //     realTotal - (4 x fullTerms + 2 x halfTerms)
  //
  // which treats every summer as a term that MUST hold two courses. A summer can hold
  // zero. So on a five-year shape, with more summers than a four-year one, the slack went
  // NEGATIVE, the ceiling switched itself off, and the summers were free to take the
  // courses the falls needed — which is exactly the `Year 3 Fall — 3 courses` in the
  // five-year Industrial Engineering and Computer Science variants.
  //
  // The right statement: the full terms have a floor and the summers only get the SURPLUS.
  const fullCount = terms.filter(t => (t.weight ?? 1) >= 1).length;
  const realTotal = plans.filter(bigCell).length;
  const surplus = realTotal - minCourses * fullCount;
  // ── When the bar is ARITHMETICALLY unsatisfiable, it does not apply ──
  //
  // A negative surplus means the degree names fewer real courses than its full terms need. No
  // arrangement can give every full term four, so enforcing the bar refuses the degree over
  // arithmetic rather than over any plan — and refuses it for a convention its own department
  // does not follow. MEASURED, over the 20 shapes refusing this way:
  //
  //   health_science_bs                30 courses, 8 full terms need 32   short by 2
  //   health_science_and_comm_studies   31 courses, 8 full terms need 32   short by 1
  //   health_science_and_business_admin 29 courses, 10 full terms need 40  short by 11
  //
  // And the published plans for those degrees are duly light: `health_science_bs`'s own
  // four-year plan puts THREE of six full terms under four courses, one of them with two, and
  // its sibling variant has a Year 4 Spring holding one. `architectural_studies_and_design`
  // publishes a three-course Year 1 Fall.
  //
  // This is NOT the four-course rule being relaxed. It is the same structure the rule already
  // has twice over: `minCoursesFor` returns 0 for graduate degrees because they have no such
  // convention, and `termIsFull` passes a 16 SH studio term because no fourth course can fit.
  // A bar that cannot be met is not a bar, and the honest response is to plan and say so.
  // ── Counting says yes; REACHABILITY is the question ────────────────
  //
  // `surplus >= 0` asks whether enough real courses exist. It cannot ask whether they can get
  // where they are needed, and those come apart: a degree with 32 courses for 6 full terms has
  // surplus 8 and can still have no arrangement, because the courses that could fill a late
  // term are all locked early by season or prerequisite window. `barsReachable` settles it
  // exactly, by flow, in microseconds — see `cardinality.js` for why a `false` is a proof and
  // a `true` is only a licence to look.
  //
  // ── Computed, reported, and deliberately NOT used to pick a tier ────
  //
  // Gating `barSatisfiable` on it was tried and reverted, for a reason worth keeping. The
  // check reads DOMAINS, and `propagateChains` narrows domains — soundly, but it narrows
  // them. So the proof available depends on whether propagation ran, which made the chosen
  // rung depend on it too, and `chemical_engineering_bsche#2` duly came out differently with
  // propagation on and off. That breaks the design's §17.1 guarantee that a pruning
  // propagator never re-sequences a plan that already generated — a guarantee with an
  // invariant test behind it, and not one to weaken as a side effect of a diagnostic.
  //
  // Measured, gating it changed nothing anyway: the sample was identical either way. So it is
  // carried as a REASON — "no arrangement can give every full term four" is a far better
  // sentence than "budget exhausted", and it is a proof rather than a guess. Using it as a
  // propagator INSIDE the DFS is where it would earn its keep, and that is propagation-
  // neutral by construction because every branch sees the same domains.
  const barsAreReachable = barsReachable({
    plans, terms, realCourseSH: cal.realCourseSH, minCourses,
    slotCap: (ti) => slotCap[ti],
    // A summer has no floor of its own in the criteria, so none is imposed here; asking for
    // one would make instances look infeasible that the criteria would have accepted.
    halfTermCourses: () => 0,
  });
  const barSatisfiable = surplus >= 0;
  const bigCap = terms.map((t) => {
    // Not enough courses to give every full term four: the rule is unsatisfiable for this
    // shape, so no ceiling is imposed and the relaxed tier plans anyway.
    if (surplus < 0 || minCourses <= 0) return Infinity;
    return (t.weight ?? 1) >= 1
      ? minCourses + surplus                 // a full term may take extra, up to the surplus
      : Math.min(cal.halfTermCourses, surplus); // a summer gets only what is left over
  });
  /**
   * Does every full term meet the bar? The search's goal test, and deliberately a MIRROR of
   * `criteriaFailures` rather than an independent opinion about fullness.
   *
   * So it copies that function's exemptions exactly: a summer is skipped, because a half term
   * legitimately holds two courses and the criteria never judge one; an optional term is
   * skipped, because a department left it blank and `emit` will trim it. Judging either here
   * would refuse plans the criteria would have accepted, which is the same class of mistake
   * in the opposite direction.
   *
   * `termIsFull` and not `bigIn[ti] >= minCourses`, for the reason that function documents: a
   * term carrying a 16 SH studio has no room for a fourth course and is full at two.
   */
  const barsMet = () => {
    for (let ti = 0; ti < terms.length; ti++) {
      const t = terms[ti];
      if (t.work || t.unused || t.optional || (t.weight ?? 1) < 1) continue;
      if (!termIsFull(bigIn[ti], loadSH[ti], cap[ti], cal, studentType, bigSH[ti])) return false;
    }
    return true;
  };

  const suffix = new Array(order.length + 1);
  suffix[order.length] = new Array(terms.length).fill(0);
  for (let i = order.length - 1; i >= 0; i--) {
    const cur = suffix[i + 1].slice();
    if (bigCell(order[i])) for (const t of order[i].domain) cur[t] += 1;
    suffix[i] = cur;
  }

  /**
   * Can every full term still reach four, given what is left to place?
   *
   * An EMPTY full term is exempt, and deliberately: a term with no courses is a term the
   * student is not enrolled in, which is a different thing from a term with three. Once a
   * term holds one course it is committed to being used, and the bar applies.
   */
  const canStillFill = (nextIndex) => {
    // `barSatisfiable` was already consulted by `bigCap`, which switches its ceiling off for the
    // same reason, and NOT here — so the ceiling stopped constraining while this kept demanding
    // four courses in every used full term. That asymmetry is what refused 20 degrees whose own
    // departments publish light terms.
    if (!enforceCardinality || minCourses <= 0 || !barSatisfiable) return true;
    const possible = suffix[nextIndex];
    let totalNeed = 0;
    const needing = [];
    for (let t = 0; t < terms.length; t++) {
      if ((terms[t].weight ?? 1) < 1) continue;         // a half term holds two, not four
      if (bigIn[t] === 0) continue;                     // not in use; may stay that way
      // A term with no ROOM for another real course is already full, however few courses it
      // holds — a 16 SH studio term cannot reach four and needs nothing. See `termIsFull`.
      if (termIsFull(bigIn[t], loadSH[t], cap[t], cal, studentType, bigSH[t])) continue;
      const need = minCourses - bigIn[t];
      if (need <= 0) continue;
      if (need > possible[t]) return false;
      totalNeed += need;
      needing.push({ t, need });
    }
    if (!needing.length) return true;

    // ── Per term is the WEAK relaxation; Hall's condition is the real one ──
    //
    // Counting per term misses the case that actually blocks: two terms each needing two
    // more courses, with only three unplaced cells that could serve either, passes every
    // per-term check and is infeasible. That is Hall's condition, and it is what left
    // Industrial Engineering and Computer Science's "Four Years, Two Co-ops in
    // Spring/Summer First" refusing.
    //
    // Its arithmetic is IDENTICAL to the variant that succeeds — 6 full terms, 4 half, 32
    // real courses, 24 + 8 = 32 with zero slack — and the difference is which seasons
    // survive. Its co-ops sit on Spring and Summer 1, so almost no spring terms remain, and
    // a spring-only course has nowhere to go. Every near-miss branch had to be exhausted
    // before the search could know, and the budget ran out first: unsolved, not infeasible.
    //
    // The exact test is a bipartite matching between the slots still to fill and the cells
    // that could fill them, which is the same `bipartiteMatch` the distinctness constraint
    // already uses — `alldifferent` and global-cardinality are siblings, and this file was
    // using one of them and hand-rolling the other.
    //
    // ── Run only when it can bite ──────────────────────────────────
    //
    // The matching costs O(slots x cells) per node, ~30k operations, which is unaffordable
    // at every node and pointless where there is room: with plenty of spare cells the
    // per-term check above already decides. So it runs only when the remaining problem is
    // TIGHT — the slots to fill are within `HALL_SLACK` of the cells left to fill them.
    // For a degree with room it never runs; for one that is exactly tight it always does,
    // which is exactly where the pruning pays for itself.
    let avail = 0;
    for (let j = nextIndex; j < order.length; j++) if (bigCell(order[j])) avail += 1;
    if (totalNeed + HALL_SLACK < avail) return true;

    // ── Bounded, because its cost scales with the instance ────────────
    //
    // Kuhn's is O(V*E), so this is roughly `totalNeed * totalNeed * avail`. On a small plan
    // that is the ~30k operations it was budgeted at; on a 22-term program with 15 terms
    // still needing courses and 40 cells left it is ~144,000 — PER NODE. At 20,000 nodes that
    // is billions of operations, and the full sweep duly found a shape spending 168,000 ms
    // against a 5,000 ms budget.
    //
    // Skipping is SOUND. This is a propagator: it prunes branches that cannot lead to a
    // solution, and declining to prune costs search time, never correctness. The per-term
    // count above still runs, the final witness still verifies, and a plan that survives is
    // as legal as one from an instance small enough to check exactly. So the expensive case
    // gets the cheap check and the search works harder, which is the right way round — the
    // alternative is a frozen tab.
    if (totalNeed * totalNeed * avail > HALL_MAX_WORK) return true;

    const slots = [];
    for (const { t, need } of needing) {
      const servers = [];
      for (let j = nextIndex; j < order.length; j++) {
        const p = order[j];
        if (bigCell(p) && p.domain.includes(t)) servers.push(p.cell.id);
      }
      // A term needing more than the cells that can serve it is already dead, and the
      // per-term check above caught that; this is the cross-term version.
      for (let k = 0; k < need; k++) slots.push(servers);
    }
    return bipartiteMatch(slots).size === slots.length;
  };

  /**
   * Can every cell still to place get a seat in the room that is left?
   *
   * ── The other direction of the same argument ────────────────────────
   *
   * `canStillFill` asks whether each TERM can still reach its minimum. This asks whether
   * each CELL can still find a term, and both are Hall's condition — one over slots looking
   * for cells, one over cells looking for slots. Having only the first is why capacity
   * dead-ends were discovered by exhaustion instead of deduction: the search would place
   * cells happily until some later cell had nowhere legal left, then unwind, then walk into
   * the same wall by a different route.
   *
   * It matters most exactly where CHART struggles. Industrial Engineering and Computer
   * Science's "Spring/Summer First" variant is feasible on capacity, availability and depth
   * — a matching over the whole problem seats all 36 cells — yet the search could not find
   * an arrangement in 3,000,000 nodes. Its co-ops take Spring and Summer 1, so only TWO
   * spring terms remain against the sibling variant's four, and every spring-only course
   * competes for them while the prerequisite chains order around them. Those are precisely
   * the dead ends a cells-to-slots matching sees immediately and a per-cell domain check
   * never does.
   *
   * Slots are counted in COURSES, matching `termSlotCap`, and a cell needing two courses
   * takes two seats — a coreq group is one decision and two registrations.
   */
  const canStillSeat = (nextIndex) => {
    const remaining = order.length - nextIndex;
    if (remaining <= 0) return true;

    // Free seats per term, after what is already placed.
    let free = 0;
    const seats = terms.map((t, ti) => {
      const n = Math.max(0, slotCap[ti] - countIn[ti]);
      free += n;
      return n;
    });
    let want = 0;
    for (let j = nextIndex; j < order.length; j++) want += coursesInCell(order[j].cell);
    if (want > free) return false;                       // counting alone settles it

    // ── The matching version was built, measured, and dropped ─────────
    //
    // A full cells-to-slots matching here is the exact form of this constraint, and it did
    // not pay. Measured on the case it was built for — Industrial Engineering and Computer
    // Science's "Spring/Summer First" variant — it changed nothing: that instance is
    // FEASIBLE on capacity, availability and depth (a matching over the whole problem seats
    // all 36 cells), so a capacity-based propagator has nothing to prune. Its obstruction is
    // precedence interacting with only two remaining spring terms, which this cannot see.
    //
    // And it cost: ~2,000 operations at every node of every tight instance, which consumed
    // enough of the strict tier's node budget to push the five-year "Summer Second Half"
    // variant out of it and into the relaxed tier — turning a plan with four courses in
    // every full term into one with a thin term. A propagator that prunes nothing and
    // spends the budget is strictly worse than no propagator.
    //
    // What survives is the counting above, which is free and genuinely sound. The exact
    // check remains the right tool for a constraint that BINDS on capacity; this one does
    // not, and finding that out cost less than assuming it.
    for (let j = nextIndex; j < order.length; j++) {
      const p = order[j];
      const need = coursesInCell(p.cell);
      let open = 0;
      for (const t of p.domain) open += seats[t];
      if (open < need) return false;      // this cell alone has nowhere left to sit
    }
    return true;
  };

  // ── Precedence, propagated over the cells NOT yet placed ──────────
  //
  // `violatesPrecedence` checks edges against cells that already have a term, and
  // `criticalPath` narrowed every domain once before the search began. Between them sits the
  // case that actually blocks: a chain of three UNPLACED cells needs three distinct terms in
  // increasing order, and if the assignment so far has left only two terms where they can go,
  // that is decided now — but nothing notices until each of the three has been tried.
  //
  // Industrial Engineering and Computer Science's "Spring/Summer First" variant is exactly
  // this. Its co-ops take Spring and Summer 1, so two spring terms remain against the sibling
  // variant's four, and a spring-only chain has to thread them. The instance is FEASIBLE on
  // capacity, availability and depth — a matching seats all 36 cells — so no capacity
  // propagator has anything to prune, and the search could not find an arrangement in
  // 3,000,000 nodes. The obstruction is precedence interacting with the seasons that survive,
  // which is what this sees and nothing else does.
  //
  // It is the same longest-path computation `criticalPath` does, with one difference that is
  // the whole point: a PLACED cell contributes its actual term instead of its domain's
  // endpoint, so every bound tightens as the assignment grows.
  //
  // ── Why this is safe to run at every tier, including the strict one ──
  //
  // Because it PRUNES and never REWRITES. A propagator that narrowed `plan.domain` would
  // change `byConstraint`'s MRV ordering — it sorts on domain length — and therefore which
  // legal plan the search reaches first, which would silently re-sequence programs that
  // already generate. This only answers "is this branch dead", and pruning branches that
  // contain no solution cannot change the order in which SOLUTIONS are met. The plan a
  // succeeding program produces is identical; it is simply reached without the detour.
  //
  // Sound, so nothing valid is cut: every bound here is implied by the partial assignment and
  // the edges, and a cell with no term inside its own tightened window genuinely admits no
  // completion.
  const topo = (() => {
    if (!precedence) return [];
    const ids = order.map(p => p.cell.id);
    const idset = new Set(ids);
    const indeg = new Map(ids.map(id => [id, 0]));
    for (const id of ids) {
      for (const p of precedence.before.get(id) ?? []) {
        if (idset.has(p)) indeg.set(id, indeg.get(id) + 1);
      }
    }
    const queue = ids.filter(id => indeg.get(id) === 0).sort();
    const out = [];
    while (queue.length) {
      const id = queue.shift();
      out.push(id);
      for (const s of precedence.after.get(id) ?? []) {
        if (!idset.has(s)) continue;
        const d = indeg.get(s) - 1;
        indeg.set(s, d);
        if (d === 0) queue.push(s);
      }
    }
    // Cells in a precedence CYCLE are never emitted, and are therefore never propagated
    // through. A cycle means the data contradicts itself — `criticalPath` reports it — and
    // declining to deduce from a contradiction is the conservative choice: it costs pruning
    // and cannot cut a valid branch.
    return out;
  })();

  const domLo = new Map(plans.map(p => [p.cell.id, p.domain[0] ?? 0]));
  const domHi = new Map(plans.map(p =>
    [p.cell.id, p.domain[p.domain.length - 1] ?? terms.length - 1]));
  const domainOf = new Map(plans.map(p => [p.cell.id, p.domain]));
  // Allocated once. Two Maps per node at twenty thousand nodes is measurable churn.
  const pLo = new Map(), pHi = new Map();

  const precedenceRoom = () => {
    if (!propagateChains || !topo.length) return true;
    pLo.clear();
    pHi.clear();
    // Earliest, honouring predecessors — which precede `id` in `topo`, so they are done.
    for (const id of topo) {
      const at = termOf.get(id);
      if (at != null) { pLo.set(id, at); continue; }
      let v = domLo.get(id);
      for (const p of precedence.before.get(id) ?? []) {
        const pv = pLo.get(p);
        if (pv == null) continue;                       // a cycle member: no deduction
        const shifted = pv + (precedence.concurrentOk.has(`${p}|${id}`) ? 0 : 1);
        if (shifted > v) v = shifted;
      }
      pLo.set(id, v);
    }
    // Latest, honouring successors — which follow `id` in `topo`, hence the reverse sweep.
    for (let k = topo.length - 1; k >= 0; k--) {
      const id = topo[k];
      const at = termOf.get(id);
      if (at != null) { pHi.set(id, at); continue; }
      let v = domHi.get(id);
      for (const s of precedence.after.get(id) ?? []) {
        const sv = pHi.get(s);
        if (sv == null) continue;
        const shifted = sv - (precedence.concurrentOk.has(`${id}|${s}`) ? 0 : 1);
        if (shifted < v) v = shifted;
      }
      pHi.set(id, v);
    }
    for (const id of topo) {
      if (termOf.has(id)) continue;
      const a = pLo.get(id), b = pHi.get(id);
      // `>` and not `>=`: a cell whose earliest and latest coincide has exactly one legal
      // term, which is tight but perfectly satisfiable. An off-by-one here was tried as a
      // deliberate probe and cost 9 plans outright and re-sequenced 12 more — while GAINING
      // 2, which is the trap: an unsound propagator can raise the coverage number and break
      // twenty-one plans in the same change. See chart-propagator-neutral.test.js.
      if (a > b) return false;
      // The window alone is not enough: the cell also has to have a LEGAL term inside it,
      // and its domain already encodes availability. A chain that fits the calendar but
      // needs a spring the co-op cycle removed fails here and nowhere else.
      let any = false;
      for (const t of domainOf.get(id)) if (t >= a && t <= b) { any = true; break; }
      if (!any) return false;
    }
    return true;
  };

  // One place that commits an assignment and one that undoes it.
  //
  // These were four hand-copied five-line blocks, one per rejection path, and adding a fifth
  // propagator meant a fifth copy. That is the shape of bug this engine can least afford: an
  // undo that forgets one counter leaves the search reasoning about a term that does not
  // exist, and it would show up as a wrong plan rather than as a crash.
  const place = (c, ti) => {
    termOf.set(c.id, ti);
    loadSH[ti] += c.sh ?? 0;
    countIn[ti] += coursesInCell(c);
    if ((c.sh ?? 0) >= cal.realCourseSH) { bigIn[ti] += 1; bigSH[ti] += c.sh ?? 0; }
    reqIn[ti].set(reqKey(c), reqCount(ti, c) + 1);
    // Rule 5's counter. Decremented across the cell's WHOLE domain, not just the term it took:
    // the question `yieldsToMajor` asks is "can a major course still use this term", and a major
    // cell that is now placed can no longer use any of them.
    if (majorWants.has(c.id)) for (const t of majorWants.get(c.id)) majorUnplacedIn[t] -= 1;
  };
  const unplace = (c, ti) => {
    termOf.delete(c.id);
    loadSH[ti] -= c.sh ?? 0;
    countIn[ti] -= coursesInCell(c);
    if ((c.sh ?? 0) >= cal.realCourseSH) { bigIn[ti] -= 1; bigSH[ti] -= c.sh ?? 0; }
    reqIn[ti].set(reqKey(c), reqCount(ti, c) - 1);
    if (majorWants.has(c.id)) for (const t of majorWants.get(c.id)) majorUnplacedIn[t] += 1;
  };

  function step(i) {
    if (++nodes > nodeBudget) return "budget";
    // Checked every 64 nodes rather than every one: a clock read per node is
    // itself measurable at this node rate, and 64 nodes is well inside the budget.
    // Every 8 nodes, not every 64.
    //
    // The interval was chosen when a node was cheap, on the reasoning that a clock read per
    // node is itself measurable. It is not, next to what a node now costs: each one runs a
    // distinctness matching and, on a tight instance, a Hall matching too. So 63 nodes of
    // overshoot stopped being microseconds and became seconds — the full sweep found a shape
    // taking 168,000 ms against a 5,000 ms budget.
    //
    // `Date.now()` is tens of nanoseconds against a matching's hundreds of microseconds, so
    // this is free where it used to be worth avoiding, and it bounds the overshoot to eight
    // nodes instead of sixty-four. It does not affect DETERMINISM: the clock can only turn an
    // answer into a refusal, never into a different answer.
    if ((nodes & 7) === 0 && now() > deadline) return "time";
    if (i >= order.length) {
      // The one place prereq-reachability is checked: a complete assignment, where
      // every cell that could supply a prerequisite has a term.
      const w = runWitness(true);
      if (!w.ok) { worstFailure = w.failure; return false; }
      // ── The bar is part of the GOAL, not a report on the answer ──────
      //
      // This returned `true` the moment every cell had a term, which is the definition of a
      // complete assignment and NOT the definition of an acceptable plan. So the search
      // stopped at the first legal arrangement it stumbled on, `emit` built it, and
      // `criteriaFailures` refused it a phase later — and the student got nothing, for a
      // degree the search had already proved arrangeable.
      //
      // International Business is the case that made it undeniable. It has exactly 32 real
      // courses for exactly 32 slots, so the ONLY acceptable arrangement gives every full
      // term four and every summer two; there is no slack anywhere. The search duly found a
      // complete assignment that left Year 3 Fall empty and Year 4 Fall with none, declared
      // victory, and was overruled downstream.
      //
      // A search whose success test is weaker than the test its answer will face is not
      // searching for the right thing. Checking it HERE means a lopsided assignment
      // backtracks and the search keeps looking, which is exactly what it should have been
      // doing all along — and on a tight instance it is the difference between a plan and a
      // refusal, not merely a nicer plan.
      //
      // Only under `enforceCardinality`, so the last rung — which exists precisely because
      // some degrees cannot meet the bar — is unaffected and still answers.
      //
      // ── Gating it on `barSatisfiable` was TRIED, and measured worse ──
      //
      // The argument for it is good: the last rung relaxes the bar, so it can return a thin
      // plan, and because it SUCCEEDS the packer behind it is never asked — the same
      // preemption fixed one level up. The corpus disagreed. Refusals went 31 to 40 on the
      // sample while `fails-hard-criteria` stayed at exactly 21: it fixed none of the target
      // and cost nine plans.
      //
      // Which measures a DISAGREEMENT, not a rung. Those nine were thin by this check and
      // accepted by `criteriaFailures` on the emitted document, so the assignment-level mirror
      // is still stricter than the gate somewhere — the opposite direction from the co-op and
      // summer mismatches already corrected. Tightening the search against a rule the
      // authority does not enforce refuses plans a student could have followed.
      //
      // Find the disagreement first. Enforcing more strictly than the authority is not
      // conservatism; it is a second opinion wearing the same name.
      if (enforceCardinality && minCourses > 0 && !barsMet()) return false;
      return true;
    }

    const plan = order[i];
    const cell = plan.cell;
    if (!plan.domain.length) {
      worstFailure = { kind: "empty-domain", cell: cell.id, title: cell.title };
      return false;
    }

    for (const ti of termPreference(plan)) {
      // ── A branch cut here used to leave NO trace, and that is a reporting hole ──
      //
      // These five rejections are the cheap ones, and none of them recorded anything. A
      // program every one of whose branches dies on the credit cap therefore reached the end
      // of the ladder with `worstFailure` still null and was reported as
      // `search-budget-exhausted` — a statement about the search, for a program the search
      // had actually settled. Measured: 37 of 71 search refusals end EARLY, several in under
      // 200 ms against a 5,000 ms clock, and calling those "out of budget" is what sent the
      // next round of work at search strength instead of at the real obstruction.
      // (precedence.js already recorded the same complaint: "Bioengineering failed after
      // 20,000 nodes with NOTHING to report".)
      //
      // Kept in a SEPARATE variable from `worstFailure` on purpose. `worstFailure` feeds
      // nogood learning, which rewrites domains between restarts, so adding sources to it
      // would change which nogoods are learned and could re-sequence a program that restarts.
      // This one is consulted only when nothing better is known, and only for the message.
      const block = (kind) => { blockedBy = { kind, cell: cell.id, title: cell.title, term: ti }; };
      // Term credit envelope — the registration cap, which is hard.
      if (loadSH[ti] + (cell.sh ?? 0) > cap[ti]) { block("term-at-credit-cap"); continue; }
      // Eleven courses in one term fits inside 19 credits and is not a plan anyone
      // would follow. Bounded by the worst any published plan does.
      if (countIn[ti] + coursesInCell(cell) > slotCap[ti]) { block("term-at-slot-cap"); continue; }
      if (reqCount(ti, cell) + 1 > maxPerTerm(cell)) {
        block("too-many-of-one-requirement"); continue;
      }
      // The derived per-term ceiling on real courses. See `bigCap`: where the arithmetic
      // is exactly tight this forbids the five-in-a-term branches that are provably dead.
      if (enforceCardinality && bigCell(plan) && bigIn[ti] + 1 > bigCap[ti]) {
        block("term-at-its-course-ceiling"); continue;
      }
      // ── A small cell PREFERS a term that has its four already ────────
      //
      // Written first as a veto — "this 1 SH course may not go here" — and that was the wrong
      // shape entirely. Removing options does not help a search find an arrangement; it makes
      // it fail, and International Business went from a plan with a short spring to no plan at
      // all. A rule that turns a flawed plan into a refusal has made things worse, because the
      // fallback is the department's own plan and this corpus measures those at 31.9% season
      // violations.
      //
      // The same rule as a PREFERENCE lives in `termPreference` instead, where it steers
      // without forbidding: see `crowdsOutAReal`. Kept here as a comment because the veto is
      // an obvious idea and the next reader deserves to know it was tried and why it lost.
      // Precedence, forward-checked against what is already placed. This is what
      // turns discovering the prereq order from 20,000 nodes of backtracking into
      // a few dozen: the witness would catch a violation eventually, but only
      // after the whole plan was built on top of it.
      if (violatesPrecedence(cell.id, ti)) { block("prereq-order-with-what-is-placed"); continue; }

      place(cell, ti);

      // Cheapest deduction first, matchings last. `precedenceRoom` is two linear sweeps over
      // ~40 cells; `canStillFill` runs a matching. Ordering them this way means a branch the
      // chains already forbid never pays for a matching to find that out.
      const dead =
          !precedenceRoom()      ? { kind: "chain-has-no-room-left" }
        : !canStillSeat(i + 1)   ? { kind: "no-room-left-for-the-rest" }
        : !canStillFill(i + 1)   ? {
            kind: "full-term-cannot-reach-four",
            // The degree's own arithmetic against this shape, because the verdict alone is not
            // actionable and the arithmetic is. "32 real courses; 6 full terms need 24 and 4
            // half terms hold at most 8" is a sentence an advisor can check; "no legal
            // placement exists" is not. Free to attach: all three are already computed.
            realCourses: realTotal, fullTerms: fullCount, minCourses, surplus,
            // And whether the arithmetic is even the problem. `surplus >= 0` with
            // `barsReachable` false means the courses exist and cannot GET where they are
            // needed — a different diagnosis, and a proved one. See `cardinality.js`.
            reachable: barsAreReachable,
          }
        : null;
      if (dead) {
        worstFailure = worstFailure ?? { ...dead, cell: cell.id, title: cell.title, term: ti };
        unplace(cell, ti);
        continue;
      }

      // Propagate `alldifferent` over what is placed so far, plus named-course
      // prereq order. Sound on a partial assignment: candidate prereqs are
      // excluded, and a named prerequisite whose cell is not yet placed reads as
      // absent rather than as late, so no branch is cut for a fixable violation.
      const w = runWitness(false);
      if (w.ok) {
        const r = step(i + 1);
        if (r === true) return true;
        if (r === "budget" || r === "time") return r;
      } else {
        worstFailure = w.failure;
      }

      unplace(cell, ti);
    }
    return false;
  }

  const result = step(0);
  if (result === true) return { ok: true, termOf, nodes };
  if (result === "budget" || result === "time") {
    return {
      ok: false, nodes,
      failure: {
        kind: "search-budget-exhausted", nodes,
        // The last obstruction the search hit is far more useful than the budget
        // itself: it names a cell and a term the student can look at.
        detail: worstFailure
          ? `${describe(worstFailure)} (gave up after ${nodes} attempts)`
          : `no legal placement found within ${result === "time" ? "the time budget" : `${nodeBudget} nodes`}`,
        lastObstruction: worstFailure ?? null,
      },
    };
  }
  // ── The search EXHAUSTED THE SPACE, which is a different sentence ──
  //
  // Reaching here means `step` returned false rather than "budget" or "time": every branch was
  // explored and none led to a plan. That is a fact about the degree under these constraints,
  // not about our allowance, and it is worth marking as such — `exhaustedSpace` lets the
  // caller stop spending the rest of the budget on rungs that cannot help.
  //
  // `blockedBy` is the fallback message. Before it existed, a program whose every branch died
  // on the credit cap or the slot cap arrived here with `worstFailure` null and got
  // "no legal placement exists", which names nothing.
  return {
    ok: false, nodes, exhaustedSpace: true,
    failure: worstFailure
      ?? (blockedBy
        ? { ...blockedBy, detail: describe(blockedBy) }
        : { kind: "infeasible", detail: "no legal placement exists" }),
  };
}

/** One sentence about a witness failure, in terms a person can act on. */
export function describe(f) {
  if (!f) return "no legal placement exists";
  if (f.kind === "named-prereq") {
    return `${f.course} cannot be taken in ${f.termLabel} — its prerequisites are not met by then`;
  }
  if (f.kind === "over-subscribed") {
    return `${f.termLabel}: ${f.cells} cells there can only be answered by ${f.courses} distinct courses`;
  }
  if (f.kind === "no-candidate") {
    return `no course can answer "${f.title}" in ${f.termLabel}`;
  }
  if (f.kind === "empty-domain") return `"${f.title}" has no legal term`;
  if (f.kind === "chain-has-no-room-left") {
    return `placing "${f.title}" there leaves a prerequisite chain with no room in the terms `
      + `that remain`;
  }
  // The cheap rejections. Each names the wall the last branch died on, which is the only
  // thing known about a program whose every branch died the same way.
  if (f.kind === "term-at-credit-cap") {
    return `every term that could hold "${f.title}" is already at its credit cap`;
  }
  if (f.kind === "term-at-slot-cap") {
    return `every term that could hold "${f.title}" already holds as many courses as any `
      + `published plan does`;
  }
  if (f.kind === "too-many-of-one-requirement") {
    return `"${f.title}" would be the third or fourth cell of one requirement in the same term`;
  }
  if (f.kind === "term-at-its-course-ceiling") {
    return `"${f.title}" cannot go anywhere without leaving some other full term short of `
      + `four courses`;
  }
  if (f.kind === "full-term-cannot-reach-four" && f.realCourses != null) {
    const need = f.minCourses * f.fullTerms;
    return f.surplus < 0
      // The honest case: the degree does not contain enough courses for this shape, so the
      // convention is unsatisfiable here whatever the search does. That is a fact about the
      // published plan's length, not about our arrangement.
      ? `this degree names ${f.realCourses} courses of ${f.minCourses}+ credits, but `
        + `${f.fullTerms} full terms need ${need} to hold ${f.minCourses} each — `
        + `${need - f.realCourses} short, so some full term must run light`
      // Not "no arrangement exists" — that is a proof the search does not have. With
      // `surplus >= 0` the courses plainly COUNT, so the honest statement is that this
      // search did not find an arrangement, which is a different claim and the one the
      // evidence supports. Saying otherwise told readers a satisfiable degree was
      // impossible.
      : `${f.realCourses} courses across ${f.fullTerms} full terms leaves only `
        + `${f.surplus} spare, and none of the arrangements tried filled every full term`;
  }
  if (f.kind === "prereq-order-with-what-is-placed") {
    return `"${f.title}" cannot sit in any term that agrees with the courses already placed`;
  }
  return f.detail ?? "no legal placement exists";
}


/**
 * Search order: fewest legal terms first, then fewest candidates.
 *
 * The second key is the one that does the work here — see the header. A cell that
 * admits any course sorts last on BOTH keys, so it is placed into whatever room
 * is left rather than claiming a term a specific course needed.
 */
function byConstraint(a, b, termCount, rankOf = () => 0, fillerOf = isFiller) {
  // Fillers last. This is the ordering the whole engine exists for, and it must not
  // be left to emerge from a tie-break: the motivating complaint is that departments
  // spend the general electives before the first co-op, so the courses with
  // something to say about a degree claim their terms first and the electives take
  // what is left.
  //
  // Most-constrained-first would NOT deliver this on its own. The prereq DAG gives
  // 71% of the catalog depth 0, so a broad elective and a first-year requirement
  // look equally unconstrained, and which goes first comes down to how the
  // candidate counts happen to compare.
  //
  // ── "Unconditionally" was the word this key lost, and deliberately ──
  //
  // It read `unconditionally` for good reason, and rule 4 is the one condition worth admitting:
  // a DEPTH elective in a degree whose own chains are shallower than a generic advanced course
  // is not filler, because in such a degree the electives ARE the student's depth. Deciding that
  // needs the degree's chain heights, which this comparator cannot see, so the caller supplies
  // `fillerOf` and the default remains exactly the old behaviour.
  //
  // What has NOT changed: a breadth elective is still filler, and so is every elective in a deep
  // major. The founding complaint is about spending free credit before the first co-op on
  // nothing in particular, and a depth elective competing on the same ranking as a major pool is
  // not that — it is the inversion `claimRank` already makes for major-subject pools, extended
  // to the cells that carry depth in a degree with no chains of its own.
  const fa = fillerOf(a) ? 1 : 0, fb = fillerOf(b) ? 1 : 0;
  if (fa !== fb) return fa - fb;

  // ── Who claims a scarce early term, among the non-fillers ─────────
  //
  // Ordering by domain width alone decided this badly, and it is the reason a term
  // preference for early major electives changed nothing: a 247-candidate `Khoury
  // Approved Elective` has the widest domain of anything in the program, so it was
  // placed dead last among non-fillers — after every terminal major requirement had
  // already filled the early terms to the registration cap. By then the only room left
  // was year 4, whatever the pool preferred.
  //
  // So the claim is stated rather than inferred from width: chain-bearing courses first
  // (they are genuinely the most constrained), then major-subject pools, then the
  // requirements that unlock nothing. See `claimRank`.
  const ra = rankOf(a), rb = rankOf(b);
  if (ra !== rb) return ra - rb;

  const da = a.domain.length || termCount + 1;
  const db = b.domain.length || termCount + 1;
  if (da !== db) return da - db;
  const ca = a.candidates === null ? Infinity : a.candidates.length;
  const cb = b.candidates === null ? Infinity : b.candidates.length;
  if (ca !== cb) return ca - cb;
  // Deeper cells before shallower ones at equal width: a long chain has fewer
  // places to go even when the bound has not noticed.
  if (a.minDepth !== b.minDepth) return b.minDepth - a.minDepth;
  // Arbitrary, and only here because a total order is needed for determinism.
  //
  // Worth knowing if you are tempted to diversify the search by varying it: that was tried,
  // and it rescued nothing over a 344-shape sample. Re-ordering the last key of a five-key
  // comparator only moves cells that tie on all four before it, and few do — so the search
  // explored the same region more thoroughly rather than a different one. The VALUE order
  // (which term a cell tries first) is what actually varies between arrangements.
  return String(a.cell.id).localeCompare(String(b.cell.id));
}

/**
 * A cell with nothing specific to say about where it belongs.
 *
 * `~general` admits the whole catalog. A concentration cell is unresolved until the
 * student picks one. Both are placeholders the student will fill, and neither has a
 * prerequisite structure that could justify an early term.
 */
const isFiller = (p) => p.candidates === null;

/**
 * First-fit decreasing: assign every cell to a term, largest cell first.
 *
 * The constructive counterpart to `attemptPlacement`, and it exists because the two fail in
 * opposite directions. A DFS is strong where the instance is tight and the answer needs
 * proving; it is helpless where the instance is LOOSE and merely awkward, because with every
 * domain nine or ten terms wide there is nothing for MRV to grip and the global constraints —
 * credit sums, the four-course count, distinctness — only bite once a term is already full.
 * Then it backtracks over an exponential space to discover what ordering would have avoided.
 *
 * No backtracking here, deliberately. If one pass in size order cannot place a cell, this
 * says so and the caller keeps the search's own refusal, which is the more informative one.
 *
 * Verified the same way as everything else before it is returned: capacity, slots, precedence
 * and the witness. A plan from here is exactly as legal as one from the search — it is only
 * less thoughtfully sequenced, and phase 2 sequences it.
 */
function packDecreasing(args) {
  // Two passes, because one greedy is one guess. The first feeds the four-course bar — a
  // term still owing real courses is where a real course belongs — and the second ignores
  // it and simply balances. The bar is a convention and feasibility is not, so a pass that
  // chases it can strand a large cell that plain balance would have placed.
  //
  // Best-fit was tried as a third and is WORSE: packing terms tight strands the next large
  // cell, where balance keeps room in every term for it. 1 refusal became 3.
  const failures = [];
  // ── Three guesses, because size is not the only dimension ─────────
  //
  // The first two order by SIZE, which is the dimension a bin-packer's failures usually turn
  // on, and the comment in `packOnce` says so with a measurement behind it. International
  // Business is the counterexample that shows it is not the only one. Its "International
  // Experiential Learning" cell is 0 SH and legal in exactly FOUR terms; size-descending puts
  // it dead last, by which point all four are at their slot cap, and the packer refuses a
  // degree it can otherwise pack. The cell had nowhere to go because it was asked last.
  //
  // So the third pass orders by DOMAIN WIDTH — most-constrained first, the standard variable
  // ordering the DFS already uses as `byConstraint`. It runs third rather than first because
  // the size-ordered passes are the ones measured to produce better plans across the corpus;
  // this one exists only to answer where they have nothing to say. A pass that runs after two
  // failures can only ever turn a refusal into a plan.
  for (const { feedBar, narrowFirst, termMajor } of [
    { feedBar: true }, { feedBar: false }, { feedBar: true, narrowFirst: true },
    // Term-major, last: it answers the saturated instances the three orderings above cannot.
    { termMajor: true }, { termMajor: true, narrowFirst: true },
  ]) {
    const r = packOnce({ ...args, feedBar, narrowFirst, termMajor });
    if (r.ok) return r;
    failures.push({ feedBar: !!feedBar, narrowFirst: !!narrowFirst, termMajor: !!termMajor,
                    ...(r.failure ?? { kind: "unknown" }) });
  }
  // Both passes, kept: they fail differently — the bar-feeding pass can strand a large cell
  // that plain balance would have placed, and knowing WHICH pass hit WHICH wall is the
  // difference between "the distribution is wrong" and "the courses are not there".
  return { ok: false, failure: { kind: "packed-largest-first-failed", passes: failures } };
}

function packOnce({ plans, terms, ports, studentType, courseMap, repeatable,
                    precedence, cal, shape, feedBar = true, narrowFirst = false,
                    termMajor = false }) {
  const cap = terms.map(t => termCapacity(t, { creditMax: ports.creditMax, studentType }));
  const slots = terms.map(t => termSlotCap(t, shape));
  const loadSH = terms.map(() => 0), count = terms.map(() => 0), big = terms.map(() => 0);
  // General electives held per term. The packer checked credits, slots and precedence and
  // knew nothing about this, so it would happily stack four — and the criteria would then
  // refuse the plan it had just rescued. A fallback that produces plans the gate rejects is
  // not a fallback.
  const geIn = terms.map(() => 0);
  const isGE = (p) => p.cell.target === GENERAL_ELECTIVE;
  const minC = minCoursesFor(cal, studentType);
  const termOf = new Map();
  // What sits in each term, so a repair can ask who is in the way. An array rather than a
  // scan of `termOf`, because the repair runs per blocked cell and per candidate term.
  const held = terms.map(() => []);

  /**
   * Why this cell cannot go in this term, or null if it can.
   *
   * Factored out because the repair below has to ask the identical question — a repair that
   * checked a subset of these would place a cell the main loop would have rejected, which is
   * how a fallback starts emitting plans the gate refuses.
   */
  const blockedBy = (p, ti) => {
    const sh = p.cell.sh ?? 0, n = coursesInCell(p.cell);
    if (loadSH[ti] + sh > cap[ti] + 0.01) return "credit";
    if (count[ti] + n > slots[ti]) return "slots";
    if (isGE(p) && geIn[ti] + 1 > UNGUIDED_PER_TERM_CAP) return "ge";
    if (precedence) {
      const trial = new Map(termOf);
      trial.set(p.cell.id, ti);
      if (precedenceViolations(precedence, trial).length) return "precedence";
    }
    return null;
  };

  const put = (p, ti) => {
    termOf.set(p.cell.id, ti);
    loadSH[ti] += p.cell.sh ?? 0;
    count[ti] += coursesInCell(p.cell);
    if ((p.cell.sh ?? 0) >= cal.realCourseSH) big[ti] += 1;
    if (isGE(p)) geIn[ti] += 1;
    held[ti].push(p);
  };

  const lift = (p, ti) => {
    termOf.delete(p.cell.id);
    loadSH[ti] -= p.cell.sh ?? 0;
    count[ti] -= coursesInCell(p.cell);
    if ((p.cell.sh ?? 0) >= cal.realCourseSH) big[ti] -= 1;
    if (isGE(p)) geIn[ti] -= 1;
    held[ti] = held[ti].filter(x => x !== p);
  };

  /**
   * A cell has nowhere to go. Move ONE cell that is in its way somewhere else.
   *
   * ── Why a pure greedy needed this ───────────────────────────────────
   *
   * The packer places each cell once and never reconsiders, so a cell legal in four terms out
   * of fourteen loses them all to cells that could have gone anywhere. International Business
   * fails exactly there: `s2#0`, "International Experiential Learning", has a domain of four,
   * and by the time it is reached two of those terms are at their slot cap and two violate
   * precedence. The cells occupying them had alternatives; nothing asked them to take one.
   *
   * So this is min-conflicts, in its smallest useful form: for each term the blocked cell
   * could use, try lifting each occupant, and keep the swap if the blocked cell then fits AND
   * the occupant has a legal home elsewhere. Both halves are checked with `blockedBy`, so a
   * repaired arrangement obeys exactly what the main loop obeys.
   *
   * Depth ONE, deliberately. Chained eviction is a search, and a search is what the tiers
   * above already are — this is the fallback, and its value is that it terminates in bounded
   * time. Every candidate is tried at most once, so a repair costs O(terms x occupants x
   * terms) and cannot loop: `repairs` also caps the total, so a pathological instance cannot
   * turn the packer into a solver.
   */
  let repairs = 0;
  const repairBudget = plans.length;
  const repair = (p) => {
    if (repairs >= repairBudget) return false;
    for (const ti of p.domain) {
      // A stable order, so two runs repair identically. Determinism is a hard requirement
      // here: the monthly diff review depends on the same input giving the same plan.
      const occupants = [...held[ti]].sort((a, b) =>
        String(a.cell.id).localeCompare(String(b.cell.id)));
      for (const q of occupants) {
        lift(q, ti);
        if (blockedBy(p, ti) === null) {
          const alt = q.domain.find(x => x !== ti && blockedBy(q, x) === null);
          if (alt != null) { put(p, ti); put(q, alt); repairs++; return true; }
        }
        put(q, ti);
      }
    }
    return false;
  };

  // Size first — the dimension the whole failure turns on. Then the narrowest domain, then
  // the shallowest cell, so a first-year course claims its term before a senior one takes
  // the credits. Ties break on id, because determinism is a hard requirement here as
  // everywhere: two runs must produce the same plan.
  // Size first, and ONLY size. Putting requirements before electives was tried — it is what
  // `byConstraint` does, and with the bucket capped at three a full term needs a non-elective
  // to reach four courses, so the argument is good. It measured WORSE: thin terms 10 -> 16 on
  // the sample. Claiming the terms with requirements first packs them to the credit cap, and
  // the electives that would have completed a term then fit nowhere. In a packer, size is the
  // dimension that matters and everything else is noise.
  //
  // `narrowFirst` swaps the first two keys, and only the third pass sets it: a cell legal in
  // four terms out of fourteen has to claim one before the cells that could have gone
  // anywhere take them all. See `packDecreasing` for why this is a separate pass rather than
  // a change to the order above.
  let order = [...plans].sort((a, b) =>
    (narrowFirst
      ? (a.domain.length - b.domain.length) || ((b.cell.sh ?? 0) - (a.cell.sh ?? 0))
      : ((b.cell.sh ?? 0) - (a.cell.sh ?? 0)) || (a.domain.length - b.domain.length))
    || (a.minDepth ?? 0) - (b.minDepth ?? 0)
    || String(a.cell.id).localeCompare(String(b.cell.id)));

  // Why a branch died, for the cell that failed. The packer returned a bare `{ ok: false }`,
  // so a program it could not rescue reported nothing at all — and "the greedy also failed"
  // is the least useful sentence available when the question is whether room or the courses
  // themselves ran out.
  //
  // Reset PER CELL, and that is not a detail. Accumulated across the whole loop the first
  // version read `credit 69, slots 4` for a cell with four terms in its domain, which
  // invites exactly the wrong conclusion: 69 of those rejections belonged to other cells,
  // and all four of this one's were slots. A diagnostic that has to be discounted is worse
  // than none, because it is trusted.
  let blocked = { credit: 0, slots: 0, ge: 0, precedence: 0 };

  // ── TERM-MAJOR: give every term its bar before anyone gets a fifth course ──
  //
  // The cell-major loop below asks "where does this cell go", and its answer for an early
  // term is "here, there is room" — right up to the CREDIT cap. On a saturated degree that is
  // fatal: International Business has 32 real courses for exactly 32 slots, so a term that
  // takes five has taken one from a term that now cannot reach four, and the packer discovers
  // this only when a later cell has nowhere to go. Measured on IB: the blocked cell's four
  // terms were full of cells that all HAD alternatives, and none of those alternatives had
  // room either. Nothing local can repair a saturated arrangement.
  //
  // So this asks the other question — "what does this term still need" — which is how an
  // advisor builds a schedule and, more to the point, is the question the hard criteria are
  // stated in. Each term is filled to its bar and then left alone; the surplus is distributed
  // afterwards by the ordinary loop. Terms are visited in order so prerequisites land before
  // the courses that need them, and within a term the most-constrained cell goes first, which
  // is `byConstraint`'s reasoning applied to a greedy.
  //
  // It runs as one PASS among several rather than as a replacement, for the reason the
  // size-ordered passes are still first: they measure better on the corpus. This one exists
  // for the saturated instances they cannot express.
  if (termMajor) {
    const remaining = new Set(order);
    /** How many terms this cell could still legally occupy — its true freedom, now. */
    const freedom = (p) => p.domain.reduce((n, x) => n + (blockedBy(p, x) === null ? 1 : 0), 0);
    for (let ti = 0; ti < terms.length; ti++) {
      const t = terms[ti];
      if (t.work || t.unused) continue;
      // A full term owes four real courses; a summer owes the half-term convention. Neither
      // is a cap — the loop below may still add more — it is what this term must not be left
      // short of while cells are still available.
      const bar = (t.weight ?? 1) >= 1 ? minC : (cal.halfTermCourses ?? 0);
      while (bar > 0 && big[ti] < bar) {
        let pick = null;
        for (const p of remaining) {
          if ((p.cell.sh ?? 0) < cal.realCourseSH) continue;   // only real courses fill a bar
          if (!p.domain.includes(ti) || blockedBy(p, ti) !== null) continue;
          if (pick == null) { pick = p; continue; }
          const a = freedom(p), b = freedom(pick);
          if (a < b
            || (a === b && (p.cell.sh ?? 0) > (pick.cell.sh ?? 0))
            || (a === b && (p.cell.sh ?? 0) === (pick.cell.sh ?? 0)
                && String(p.cell.id).localeCompare(String(pick.cell.id)) < 0)) pick = p;
        }
        if (!pick) break;
        put(pick, ti);
        remaining.delete(pick);
      }
    }
    order = order.filter(p => remaining.has(p));
  }

  for (const p of order) {
    blocked = { credit: 0, slots: 0, ge: 0, precedence: 0 };
    const sh = p.cell.sh ?? 0, n = coursesInCell(p.cell);
    const isBig = sh >= cal.realCourseSH;
    let best = null, bestScore = Infinity;
    for (const ti of p.domain) {
      // Never a fourth general elective. Four reservations in a term is a real semester;
      // four "General Elective" cards is a term with nothing in it to read, and it is a hard
      // criterion, so packing one would only produce a plan the criteria refuse.
      const no = blockedBy(p, ti);
      if (no) { blocked[no]++; continue; }
      // Feed the four-course bar before balancing load: a term still owing real courses is
      // where a real course belongs, and after that the emptiest term keeps the plan level.
      const owes = feedBar && isBig && (terms[ti].weight ?? 1) >= 1 && minC > 0
        ? Math.max(0, minC - big[ti]) : 0;
      const score = -owes * 100 + loadSH[ti];
      if (score < bestScore) { bestScore = score; best = ti; }
    }
    // Nowhere to go. Before giving up, ask whether someone else is in the way who does not
    // need to be — the greedy's one blind spot, and a bounded question to answer.
    if (best == null && repair(p)) continue;
    // Still nowhere. Which cell, and what turned every one of its terms away.
    if (best == null) {
      // Per TERM, not just a tally. "slots 2, precedence 2" over a domain of four does not
      // say which two, nor whether the occupants of those terms could have moved — and that
      // is the whole question when deciding between a better order and a real search.
      const perTerm = p.domain.map(ti => ({
        term: ti, why: blockedBy(p, ti), holds: held[ti].length,
        // Could the occupants go anywhere else? If none can, no repair could ever help here
        // and the wall is genuine rather than an artefact of the order.
        movable: held[ti].filter(q => q.domain.some(x => x !== ti)).length,
      }));
      return { ok: false, failure: { kind: "packer-cell-has-no-term", cell: p.cell.id,
                                     title: p.cell.title, domain: p.domain.length,
                                     needs: coursesInCell(p.cell), sh: p.cell.sh ?? 0,
                                     blocked, repairs, perTerm } };
    }
    put(p, best);
  }

  const byId = new Map(plans.map(p => [p.cell.id, p]));
  const w = witnessPlan({
    cells: plans.map(p => ({ ...p.cell, term: termOf.get(p.cell.id) })),
    candidatesOf: (c) => byId.get(c.id).candidates,
    terms, courseMap,
    offeringProbability: ports.offeringProbability, offered: ports.offered,
    repeatable, checkPrereqs: true, contention: buildContention(plans),
  });
  // Every cell got a term and the arrangement still is not a plan: the courses to FILL those
  // reservations do not exist distinctly. A different failure entirely from running out of
  // room, and the one that says a better distribution would not have helped.
  if (!w.ok) {
    return { ok: false, failure: { kind: "packer-witness-failed", inner: w.failure ?? null,
                                   bars: barsOf(terms, big, minC) } };
  }
  return { ok: true, termOf, failure: null };
}

/** Which full terms the packed arrangement left short, for the failure report. */
function barsOf(terms, big, minC) {
  if (!(minC > 0)) return [];
  const short = [];
  for (let ti = 0; ti < terms.length; ti++) {
    const t = terms[ti];
    if (t.work || t.unused || t.optional || (t.weight ?? 1) < 1) continue;
    if (big[ti] < minC) short.push({ term: ti, big: big[ti], want: minC });
  }
  return short;
}

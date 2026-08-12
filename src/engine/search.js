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
import { chainHeight } from "./precedence.js";
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
export const DEFAULT_NODE_BUDGET = 20000;

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
  propagateChains = true,
}) {
  const deadline = now() + timeBudgetMs;
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
  const strictNodes = Math.max(300, Math.min(
    Math.floor(timeBudgetMs * NODES_PER_MS * STRICT_TIER_SHARE), nodeBudget));
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
      precedence, now, shape, cal, propagateChains,
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
  ];
  const given = [];
  for (const rung of RUNGS) {
    if (totalNodes >= nodeBudget || now() > deadline) break;
    given.push(rung.gave);
    const r = attemptPlacement({
      plans: plans.map(p => ({ ...p, domain: [...p.domain] })),
      terms, ports, studentType, courseMap, repeatable,
      nodeBudget: Math.max(1, Math.floor((nodeBudget - totalNodes) / 2)),
      precedence, now, deadline, cal, propagateChains,
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
      failure: { ...f, detail: describe(f), exhausted: true },
    };
  }
  return {
    ...last, nodes: totalNodes, restarts: maxRestarts,
    exhaustedSpace: last?.exhaustedSpace ?? false,
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
  // See `precedenceRoom`. Test-only when false; production is always true.
  propagateChains = true,
}) {
  const cap = terms.map(t => termCapacity(t, { creditMax: ports.creditMax, studentType }));
  const slotCap = terms.map(t => termSlotCap(t, shape));
  const unlockValue = unlockValues(unlockUniverse(plans), courseMap);
  const unlockOf = (plan) => unlockOfCell(plan, unlockValue);
  const isPool = isPoolCell;
  const majorSubjects = majorSubjectsOf(plans, courseMap);
  const unlockBar = generatorBar(plans, courseMap, unlockValue, majorSubjects);
  /** Does this cell open up enough of the degree to earn an early slot? */
  const isGenerator = (plan) => unlockOf(plan) >= unlockBar;
  const isMajor = (plan) => majorSubjects.has(cellSubject(plan, courseMap));

  /**
   * Who gets first claim on a scarce early term.
   *
   * 0  a chain-bearing course — genuinely the most constrained, and everything else
   *    depends on it, so it cannot be displaced by a preference
   * 1  a major-subject pool — the depth a co-op employer reads, and the thing the
   *    published plans put LAST. This is the deliberate inversion
   * 2  everything else specific, including a major requirement that unlocks nothing
   * 3  fillers, handled above and unconditionally last
   */
  const claimRank = (plan) => {
    if (isPool(plan)) return isMajor(plan) ? 1 : 2;
    return isGenerator(plan) ? 0 : 2;
  };
  const rank = new Map(plans.map(p => [p.cell.id, claimRank(p)]));
  const rankOf = (p) => rank.get(p.cell.id) ?? 2;

  // Deterministic order before any heuristic reorders: two runs must agree.
  const order = [...plans].sort((a, b) => byConstraint(a, b, terms.length, rankOf));

  const byId = new Map(plans.map(p => [p.cell.id, p]));
  const termOf = new Map();
  const loadSH = new Array(terms.length).fill(0);
  const countIn = new Array(terms.length).fill(0);
  // Courses of at least 3 SH per term, which is a different count from the cells above:
  // a one-credit lab and a course are not two courses. See `underFilled`.
  const bigIn = new Array(terms.length).fill(0);
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
  const reqKey = (cell) => cell.target ?? `#${cell.id}`;
  const reqCount = (ti, cell) => reqIn[ti].get(reqKey(cell)) ?? 0;
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
    return termIsFull(bigIn[ti], loadSH[ti], cap[ti], cal, studentType) ? 1 : 0;
  };

  /**
   * Distance from where this cell's level conventionally sits, in WHOLE TERMS.
   *
   * The truncation is the point: it manufactures the ties that `underFilled` and the
   * elective reserve need in order to have any effect at all. See above.
   */
  const levelGap = (ti, want) => Math.floor(Math.abs(ti / span - want) * span);

  /**
   * Would this cell take the room a later elective needs? A specific course prefers a
   * term that still has its share of elective space free; an elective ignores the
   * reserve, since the reserve exists for it.
   */
  const takesReserved = (plan, ti) => {
    if (plan.candidates === null) return 0;
    return loadSH[ti] + (plan.cell.sh ?? 0) > target(ti) - reserve[ti] ? 1 : 0;
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
    if (preferenceFree) {
      return [...plan.domain].sort((a, b) => byOptional(a, b) || a - b);
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
          byOptional(a, b) || thin(a) - thin(b)
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
          byOptional(a, b) || crowded(plan, a) - crowded(plan, b)
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
        byOptional(a, b) || (a < floor ? 1 : 0) - (b < floor ? 1 : 0)
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
    const want = noClaim ? 1 : (cellLevelTarget(plan, courseMap, studentType) ?? 1);
    return [...plan.domain].sort((a, b) =>
      byOptional(a, b) || crowded(plan, a) - crowded(plan, b)
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
  const bigCap = terms.map((t) => {
    // Not enough courses to give every full term four: the rule is unsatisfiable for this
    // shape, so no ceiling is imposed and the relaxed tier plans anyway.
    if (surplus < 0 || minCourses <= 0) return Infinity;
    return (t.weight ?? 1) >= 1
      ? minCourses + surplus                 // a full term may take extra, up to the surplus
      : Math.min(cal.halfTermCourses, surplus); // a summer gets only what is left over
  });
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
    if (!enforceCardinality || minCourses <= 0) return true;
    const possible = suffix[nextIndex];
    let totalNeed = 0;
    const needing = [];
    for (let t = 0; t < terms.length; t++) {
      if ((terms[t].weight ?? 1) < 1) continue;         // a half term holds two, not four
      if (bigIn[t] === 0) continue;                     // not in use; may stay that way
      // A term with no ROOM for another real course is already full, however few courses it
      // holds — a 16 SH studio term cannot reach four and needs nothing. See `termIsFull`.
      if (termIsFull(bigIn[t], loadSH[t], cap[t], cal, studentType)) continue;
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
    if ((c.sh ?? 0) >= cal.realCourseSH) bigIn[ti] += 1;
    reqIn[ti].set(reqKey(c), reqCount(ti, c) + 1);
  };
  const unplace = (c, ti) => {
    termOf.delete(c.id);
    loadSH[ti] -= c.sh ?? 0;
    countIn[ti] -= coursesInCell(c);
    if ((c.sh ?? 0) >= cal.realCourseSH) bigIn[ti] -= 1;
    reqIn[ti].set(reqKey(c), reqCount(ti, c) - 1);
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
      if (reqCount(ti, cell) + 1 > sameReqMax) { block("too-many-of-one-requirement"); continue; }
      // The derived per-term ceiling on real courses. See `bigCap`: where the arithmetic
      // is exactly tight this forbids the five-in-a-term branches that are provably dead.
      if (enforceCardinality && bigCell(plan) && bigIn[ti] + 1 > bigCap[ti]) {
        block("term-at-its-course-ceiling"); continue;
      }
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
        : !canStillFill(i + 1)   ? { kind: "full-term-cannot-reach-four" }
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
function byConstraint(a, b, termCount, rankOf = () => 0) {
  // Fillers last, unconditionally. This is the ordering the whole engine exists
  // for, and it must not be left to emerge from a tie-break: the motivating
  // complaint is that departments spend the general electives before the first
  // co-op, so the courses with something to say about a degree claim their terms
  // first and the electives take what is left.
  //
  // Most-constrained-first would NOT deliver this on its own. The prereq DAG gives
  // 71% of the catalog depth 0, so a broad elective and a first-year requirement
  // look equally unconstrained, and which goes first comes down to how the
  // candidate counts happen to compare.
  const fa = isFiller(a) ? 1 : 0, fb = isFiller(b) ? 1 : 0;
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

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

import { witnessPlan, buildContention } from "./witness.js";
import {
  termCapacity, termSlotCap, coursesInCell,
  SAME_REQ_PER_TERM, SAME_REQ_PER_TERM_MAX, POOL_REACH_MIN,
  FULL_TERM_MIN_COURSES, REAL_COURSE_SH,
} from "./domains.js";
import { chainHeight } from "./precedence.js";
import { HALF_TERM_COURSES } from "./shape.js";
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
 * Nodes phase 1 may expand before refusing. Measured: a program that succeeds uses
 * 34–36, so anything approaching this bound is not a slow success, it is a failure
 * being discovered the expensive way.
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
export const STRICT_TIER_NODES = 1200;

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
  precedence = null, maxRestarts = 40, shape = null,
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
  const strictNodes = Math.max(1, Math.min(STRICT_TIER_NODES, nodeBudget));
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
      precedence, now, shape,
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
  // Reached whenever the strict tiers are done, on nodes rather than on time, so the same
  // input always gets the same fallback attempt with the same allowance.
  {
    const r = attemptPlacement({
      plans: working, terms, ports, studentType, courseMap, repeatable,
      nodeBudget: Math.max(1, nodeBudget - totalNodes),
      precedence, now, shape, deadline,
      enforceCardinality: false,
    });
    totalNodes += r.nodes;
    if (r.ok) {
      return { ...r, nodes: totalNodes, restarts: maxRestarts, cardinalityRelaxed: true };
    }
    last = r.failure ? r : last;
  }

  const f = last?.failure?.lastObstruction ?? last?.failure;
  if (f?.cell != null && f.kind && f.kind !== "search-budget-exhausted") {
    return {
      ok: false, nodes: totalNodes, restarts: maxRestarts,
      failure: { ...f, detail: describe(f), exhausted: true },
    };
  }
  return { ...last, nodes: totalNodes, restarts: maxRestarts };
}

function attemptPlacement({
  plans, terms, ports, studentType, courseMap,
  repeatable, nodeBudget, deadline, now, precedence, shape = null,
  enforceCardinality = true,
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
  const crowded = (plan, ti) => (reqCount(ti, plan.cell) >= SAME_REQ_PER_TERM ? 1 : 0);

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
    return bigIn[ti] < FULL_TERM_MIN_COURSES ? 0 : 1;
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
        const thin = (ti) => ((plan.reachAt?.[ti] ?? 1) < POOL_REACH_MIN ? 1 : 0);
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
  const bigCell = (p) => (p.cell.sh ?? 0) >= REAL_COURSE_SH;

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
  const surplus = realTotal - FULL_TERM_MIN_COURSES * fullCount;
  const bigCap = terms.map((t) => {
    // Not enough courses to give every full term four: the rule is unsatisfiable for this
    // shape, so no ceiling is imposed and the relaxed tier plans anyway.
    if (surplus < 0) return Infinity;
    return (t.weight ?? 1) >= 1
      ? FULL_TERM_MIN_COURSES + surplus       // a full term may take extra, up to the surplus
      : Math.min(HALF_TERM_COURSES, surplus); // a summer gets only what is left over
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
    if (!enforceCardinality) return true;
    const possible = suffix[nextIndex];
    for (let t = 0; t < terms.length; t++) {
      if ((terms[t].weight ?? 1) < 1) continue;         // a half term holds two, not four
      if (bigIn[t] === 0) continue;                     // not in use; may stay that way
      const need = FULL_TERM_MIN_COURSES - bigIn[t];
      if (need > 0 && need > possible[t]) return false;
    }
    return true;
  };

  function step(i) {
    if (++nodes > nodeBudget) return "budget";
    // Checked every 64 nodes rather than every one: a clock read per node is
    // itself measurable at this node rate, and 64 nodes is well inside the budget.
    if ((nodes & 63) === 0 && now() > deadline) return "time";
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
      // Term credit envelope — the registration cap, which is hard.
      if (loadSH[ti] + (cell.sh ?? 0) > cap[ti]) continue;
      // Eleven courses in one term fits inside 19 credits and is not a plan anyone
      // would follow. Bounded by the worst any published plan does.
      if (countIn[ti] + coursesInCell(cell) > slotCap[ti]) continue;
      if (reqCount(ti, cell) + 1 > SAME_REQ_PER_TERM_MAX) continue;
      // The derived per-term ceiling on real courses. See `bigCap`: where the arithmetic
      // is exactly tight this forbids the five-in-a-term branches that are provably dead.
      if (enforceCardinality && bigCell(plan) && bigIn[ti] + 1 > bigCap[ti]) continue;
      // Precedence, forward-checked against what is already placed. This is what
      // turns discovering the prereq order from 20,000 nodes of backtracking into
      // a few dozen: the witness would catch a violation eventually, but only
      // after the whole plan was built on top of it.
      if (violatesPrecedence(cell.id, ti)) continue;

      termOf.set(cell.id, ti);
      loadSH[ti] += cell.sh ?? 0;
      countIn[ti] += coursesInCell(cell);
      if ((cell.sh ?? 0) >= REAL_COURSE_SH) bigIn[ti] += 1;
      reqIn[ti].set(reqKey(cell), reqCount(ti, cell) + 1);

      // The cardinality bound, before the witness because counting is free and a
      // matching is not.
      if (!canStillFill(i + 1)) {
        worstFailure = worstFailure ?? {
          kind: "full-term-cannot-reach-four", cell: cell.id, title: cell.title, term: ti,
        };
        termOf.delete(cell.id);
        loadSH[ti] -= cell.sh ?? 0;
        countIn[ti] -= coursesInCell(cell);
        if ((cell.sh ?? 0) >= REAL_COURSE_SH) bigIn[ti] -= 1;
        reqIn[ti].set(reqKey(cell), reqCount(ti, cell) - 1);
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

      termOf.delete(cell.id);
      loadSH[ti] -= cell.sh ?? 0;
      countIn[ti] -= coursesInCell(cell);
      if ((cell.sh ?? 0) >= REAL_COURSE_SH) bigIn[ti] -= 1;
      reqIn[ti].set(reqKey(cell), reqCount(ti, cell) - 1);
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
  return {
    ok: false, nodes,
    failure: worstFailure ?? { kind: "infeasible", detail: "no legal placement exists" },
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

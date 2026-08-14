// ═══════════════════════════════════════════════════════════════════
// CHART — Course Hierarchy And Requirement Timeline
//
// The one public entry point. Everything else in `src/engine/` is internal, so
// the component can be reasoned about — and in principle licensed — as a unit.
//
// CHART generates a Sample Plan of Study for a program: the same artifact the
// catalog publishes, so `applySamplePlan` consumes it unchanged and reservations,
// candidates, the grid, PDF export and share links all work with no new
// downstream code.
//
// The name claims structure and verification, not autonomy. CHART deliberately
// declines to decide roughly half of a plan — an elective cell is a reservation,
// and which course fills it stays the student's choice. What it guarantees is
// that a legal choice EXISTS, which is a different and more honest promise.
//
// ── The pipeline ───────────────────────────────────────────────────
//
//   demand     requirement sections → cells          (the inversion)
//   shape      the published plan's skeleton, or one derived
//   domains    which terms each cell could occupy
//   preflight  refuse now, in closed form, or not at all
//   search     place every cell, hard constraints only
//   objective  improve the sequencing within tolerance bands
//   emit       a plan.json grid, with reasons attached
//
// Refusal is a return value, not a throw: a program CHART cannot plan is a normal
// outcome, and the official plan still loads beside it.
// ═══════════════════════════════════════════════════════════════════

import { deriveCells, cellsSH, substitutePrereqs } from "./demand.js";
import { shapeFromPlan, defaultShape, studyTerms, firstWorkBoundary, extendShape } from "./shape.js";
import { seedFromPlan } from "./seed.js";
import { buildDomains, wideAtFor } from "./domains.js";
import { buildPrecedence, criticalPath } from "./precedence.js";
import { preflight, tightestTerms, MAX_DERIVED_GE_SHARE } from "./preflight.js";
import {
  placeCells, describe, DEFAULT_NODE_BUDGET, DEFAULT_TIME_BUDGET_MS,
  POOL_MIN_CANDIDATES, unlockUniverse, unlockOfCell, isPoolCell,
} from "./search.js";
import { unlockValues } from "./prereqDepth.js";
import { improve, DEFAULT_PREFERENCES } from "./objective.js";
import { emitPlan } from "./emit.js";
import { buildDepthIndex } from "./prereqDepth.js";
import { withDefaults } from "./ports.js";
import { withCalibration, minCoursesFor } from "./calibration.js";
import { realCourseCount } from "../core/coreqGroups.js";

/**
 * The most a prerequisite chain may stretch a plan, in terms.
 *
 * Four. Beyond that a "chain longer than the plan" is a data defect rather than a long
 * program — a cycle read as a chain, or a renumbered course pulling in a whole
 * unrelated sequence — and stretching to meet it produces a plan nobody would read.
 * Refusing is the better answer there, and it names the cell.
 */
export const MAX_EXTRA_TERMS = 4;

/**
 * Is this blocked cell STRANDED — unplaceable by any shape, rather than by this one?
 *
 * The distinction decides whether the degree still gets a plan (§4c). A cell whose
 * candidates run in no season at all cannot be rescued by choosing a different variant,
 * adding a summer or extending a year, so refusing the degree over it buys nothing. A cell
 * whose candidates run SOMEWHERE is a shape problem, and pointing the student at a variant
 * that works is a better answer than a plan with a hole in it.
 *
 * `no-catalog-course-answers-it` is stranded for the same reason by a different route: the
 * requirement names courses the catalog does not contain, so no season can help.
 *
 * Deliberately NOT stranded: `prereq-chain-longer-than-plan` and
 * `coop-prep-cannot-precede-the-coop`. Both are the SHAPE being too short or the co-op
 * sitting too early, both are fixable by stretching it, and dropping the cell would hide a
 * solvable problem behind a hole in the plan.
 */
export const isStranded = (x) =>
  x?.reason === "no-catalog-course-answers-it"
  || (x?.reason === "never-offered-in-any-term-this-plan-uses" && !(x?.seasons?.length));

export { DEFAULT_PREFERENCES } from "./objective.js";
export { permissivePorts } from "./ports.js";

/**
 * Generate a plan, or say why not.
 *
 * @param {object} args
 * @param {object} args.program        a parsed requirements.json
 * @param {object} [args.publishedPlan]  one entry of plan.json `plans[]`, whose
 *   SHAPE is inherited (§4). Absent, a skeleton is derived — the majority case:
 *   385 programs publish a plan and 1,014 have requirements.
 * @param {Record<string,object>} args.courseMap
 * @param {object} args.ports          see ports.js; missing members degrade permissively
 * @param {string} [args.studentType]  sets the credit envelope: 12–19 UG, 8–16 grad
 * @param {object} [args.preferences]  ranked objectives and thresholds
 * @param {object} [args.depthIndex]   a prebuilt depth index, to share across programs
 * @param {(id: string) => boolean} [args.repeatable]
 * @param {{before: string, after: string}[]} [args.observedOrder]
 *   prerequisites the catalog does not record but its own published plans agree on
 *   — `public/northeastern/plan-order.json`, from `scripts/derive-plan-order.js`.
 *   Injected rather than imported, because it is derived data with a confidence
 *   level and a caller is entitled to plan without it.
 * @param {number} [args.nodeBudget]
 * @returns {{plan: object, report: object} | {refused: {reason, detail, data?}}}
 */
export function generatePlan(args = {}) {
  const first = withPackerRetry(args);
  // ── Breadth guidance is a PREFERENCE, and this is what makes it one ──
  //
  // Binding an elective to an unmet competency gives it a real candidate set, which is the
  // whole point — an unbounded cell is invisible to every ordering signal. But a candidate
  // set is also a CONSTRAINT: the bound course has prerequisites, a season, and has to be
  // distinct from what the other bound cells take. Left hard it cost 12 plans, and a
  // guidance feature that refuses a program is strictly worse than no guidance at all.
  //
  // So a refusal is not the answer. It is the signal to try again without the guidance,
  // which is the same ladder logic `attemptPlacement` already uses one level down — and the
  // same instruction the audit that proposed this gave: never refuse a program over breadth.
  //
  // Skipped where it cannot help: a pre-flight refusal is about the requirement data, not
  // about where courses go, so re-deriving cells would produce the identical verdict at
  // twice the cost. `mostly-unlabelled` alone is 105 of the corpus's refusals.
  if (!first.refused || !first.refused.data?.breadthBound) return first;
  if (PREFLIGHT_REASONS.has(first.refused.reason)) return first;

  const again = withPackerRetry({ ...args, breadthGuidance: false });
  // The FIRST refusal is the one reported if both fail: it describes the degree, while the
  // retry's describes a degree we deliberately handicapped.
  if (again.refused) return first;
  return {
    ...again,
    report: {
      ...again.report,
      relaxed: [...(again.report?.relaxed ?? []), "breadth-guidance"],
    },
  };
}

/**
 * Try the ladder; if the criteria refuse what it built, try the PACKER before giving up.
 *
 * ── Why a criteria refusal is not the end of the attempt ─────────────
 *
 * The criteria are hard, so a plan that fails them cannot ship. That is a statement about
 * the PLAN, and it was being treated as a statement about the degree. The ladder's last rung
 * relaxes the four-course bar deliberately — it exists for degrees that cannot meet it — so
 * whenever that rung answers, its plan is at risk of failing the very rule the criteria
 * enforce. And because the search SUCCEEDED, `placeCells` returned, and the packer sitting
 * behind it was never reached: the fallback built to turn refusals into plans is unreachable
 * in exactly the case where the search's answer is unusable.
 *
 * International Business is that case exactly. The ladder's rung 3 produces a plan with an
 * empty Year 3 Fall and two three-course terms; the packer produces a compliant plan in 200
 * nodes. The degree was refused for the entire life of this engine because the working
 * constructor ran second and never got asked.
 *
 * So: a criteria refusal falls through to a different CONSTRUCTOR, not a re-run of the same
 * one. Retrying the ladder would be pointless — it is deterministic and would return the
 * identical plan.
 *
 * The first refusal is kept if both fail, for the same reason as the breadth retry: it
 * describes what the search found, which is the more informative complaint.
 */
function withPackerRetry(args) {
  const first = generateOnce(args);
  if (!first.refused || first.refused.reason !== "fails-hard-criteria") return first;
  const packed = generateOnce({ ...args, packOnly: true });
  return packed.refused ? first : packed;
}

/** Refusals decided before any course is placed, which breadth binding cannot have caused. */
const PREFLIGHT_REASONS = new Set([
  "no-requirements", "no-total-credits", "no-cells", "mostly-unlabelled",
  "no-study-terms", "does-not-fit", "sections-exceed-degree",
]);

function generateOnce({
  program, publishedPlan = null, courseMap = {}, ports: rawPorts = {},
  studentType = "undergraduate", preferences = DEFAULT_PREFERENCES,
  depthIndex = null, repeatable = () => false, nodeBudget = DEFAULT_NODE_BUDGET,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS, observedOrder = [], coopPrep = [],
  // Set only by `withPackerRetry`, after the ladder's plan was refused by the criteria.
  packOnly = false,
  now = () => Date.now(),
  // The student's concentration, by title, when they have picked one.
  //
  // 93 programs require a concentration and their pools are typically DISJOINT, so without the
  // pick a concentration cell can only carry the union of every option — which proves more than
  // any single concentration can deliver, and is why the cell also carries its options and the
  // witness quantifies over them. With the pick the cell carries one real pool and there is no
  // disjunction left, so the quantifier switches itself off. Resolved by title through
  // `concentrationResolve`, because the title is a concentration's only identity across saved
  // plans, share links and MCP.
  concentration = null,
  // The institution's measured conventions — four courses to a full term, where a
  // 3000-level course sits, what counts as a real course. Injected for the same reason
  // availability and co-op legality are: they are facts about Northeastern, not about
  // scheduling, and the engine holding them is what made `FULL_TERM_MIN_COURSES` get
  // applied to master's degrees. See calibration.js.
  calibration = {},
  // See the call site below. A test-only escape hatch for one propagator, not a tuning knob.
  propagateChains = true,
  // Set false by the retry in `generatePlan` when binding electives to unmet competencies is
  // what made the degree unplannable. Not a caller-facing option.
  breadthGuidance = true,
} = {}) {
  const cal = withCalibration(calibration);
  const prepSet = new Set(coopPrep);
  const ports = withDefaults(rawPorts);
  const depth = depthIndex ?? buildDepthIndex(courseMap);

  // ── 1. What the degree demands ──────────────────────────────────
  //
  // `concentration` is the student's pick, by title. With one, the concentration cells carry
  // that option's pool and every downstream reader — the prereq floor, the witness, the
  // reachable share, the depth scoring — becomes exact instead of averaged over five pools.
  // What a co-op earns the student without spending an elective on it. Read from the
  // PUBLISHED plan, because that is the only evidence this program has a co-op at all —
  // a derived shape carries none, so a program with no published plan credits nothing and
  // reserves one more breadth cell than it may need. Conservative in the safe direction:
  // an extra competency on the plan costs a slot, a missing one costs a graduation.
  const hasCoop = (publishedPlan?.years ?? []).some(y => (y?.terms ?? [])
    .some(t => JSON.stringify(t?.entries ?? []).includes("\"coop\":true")));
  const grantedAttributes = hasCoop ? (ports.coopGrantedAttrs?.({}) ?? []) : [];

  let { cells, notes, reconciliation } =
    deriveCells(program, { courseMap, repeatable, concentration, grantedAttributes,
                           breadthGuidance });
  // Reported on every refusal so `generatePlan` can tell a program that was handicapped by
  // breadth binding from one that was never bound at all, without re-deriving to find out.
  const breadthBound = cells.filter(c => c.nupath).length;


  // ── 2. The skeleton ─────────────────────────────────────────────
  const baseShape = publishedPlan
    ? shapeFromPlan(publishedPlan)
    : defaultShape({
        totalSH: cellsSH(cells),
        maxTermSH: ports.creditMax(studentType),
        // Aim below the cap, not at it: `protect slack` is a threshold this
        // design keeps, and a plan generated at the cap leaves no room to drop.
        targetTermSH: Math.min(ports.creditMax(studentType),
                               studentType === "graduate" ? 12 : 16),
      });
  // ── 3. Order among the courses this plan commits to ─────────────
  //
  // Before domains, because it supplies the depth floor they need. The catalog-wide
  // DAG says CS 2800 has depth 0; within a plan that also names CS 1800 it has
  // depth 1, and that difference is the whole of the sequencing bound.
  let precedence = buildPrecedence(cells, courseMap, { observed: observedOrder });

  // ── A prerequisite the degree never requires gets an elective slot ──
  //
  // `unscheduledPrereqs` is a real gap, not a nicety: the plan meets every requirement and
  // the student still cannot register, because a named course needs something the degree
  // lists nowhere. Such a course is free-elective credit for them, so a general-elective
  // slot is exactly the right currency — see `substitutePrereqs`.
  //
  // Rebuilt afterwards rather than patched: the new cell is a named course, so it has
  // prerequisites, depth and precedence edges of its own, and the index that has to know
  // about them is the one computed from the cells. Patching precedence in place is how the
  // two would drift.
  const subbed = substitutePrereqs(cells, precedence.unscheduledPrereqs, courseMap, depth);
  if (subbed.substituted.length) {
    cells = subbed.cells;
    precedence = buildPrecedence(cells, courseMap, { observed: observedOrder });
  }

  // ── 4. Where each cell could go, for a given shape ──────────────
  const layout = (sh) => {
    // How many REAL courses this degree has to place decides how many summers are surplus.
    const realCourses = cells.filter(c => (c.sh ?? 0) >= cal.realCourseSH).length;
    const ts = studyTerms({ ...sh, realCourses }, studentType, cal);
    const { plans, impossible } = buildDomains(cells, ts, {
      courseMap, depthOf: depth.depthOf,
      planDepthOf: precedence.planDepthOf,
      offeringProbability: ports.offeringProbability,
      offered: ports.offered,
      wideAt: wideAtFor(cells.length),
      coopPrep: prepSet.size ? prepSet : null,
      coopBoundary: firstWorkBoundary(sh),
      // So an undergraduate's pools are not answered by doctoral courses. See
      // `registrable` — this feeds both the witness and the reachable share.
      studentType,
      cal,
    });
    // Fold precedence into the domains, and catch a chain that cannot fit before the
    // search tries to discover it by exhaustion. Narrowing here also gives MRV a
    // sharper signal: a cell with four predecessors genuinely has fewer legal terms
    // than its own offering pattern suggests.
    const critical = criticalPath(plans, precedence);
    for (const p of plans) {
      const lo = critical.earliest.get(p.cell.id);
      const hi = critical.latest.get(p.cell.id);
      if (lo == null || hi == null) continue;
      const narrowed = p.domain.filter(t => t >= lo && t <= hi);
      if (narrowed.length) p.domain = narrowed;
    }

    // ── An unchosen concentration cannot be planned against the union ──
    //
    // Without a pick the cell's spec is the union of every option, and for a program whose
    // pools are disjoint the union proves far more than any one concentration can deliver:
    // CS BSCS matched three `Concentration` cells in one term with three courses drawn from
    // three DIFFERENT concentrations. Measured with an independent instrument over the emitted
    // documents, 21 of 77 concentration plans across 20 of 64 programs did this.
    //
    // ── Which is a QUANTIFIER defect, and was fixed as one ────────────
    //
    // A `concentrationCapacity` vector used to stand here, narrowing each cell's domain to the
    // terms where the tightest option had anything takeable. It is gone, and deleting it is
    // the fix rather than a regression, because three things were wrong with it at once:
    //
    //   it counted, and was applied as a UNARY domain filter, which cannot express "at most k
    //   of these cells here" no matter how good the counts are;
    //   its counts came from STATIC prereq depth, so it permitted 8 concentration cells at
    //   term 5 for CS BSCS where the arrangement admits 0, and blocked terms 1–2 where nothing
    //   wanted to go — measured cost, 2 plans, and it never bound where it mattered;
    //   and the constraint that actually bit hardest was SEASON, not depth. The
    //   architectural-studies plan put two cells in a summer half-term in which the Management
    //   concentration runs exactly one course. No prereq-depth bound could ever see that.
    //
    // The real statement is `∀ option, ∃ a filling`, and the witness is where feasibility is
    // defined, so that is where it now lives — checked over every arrangement `isLegal`
    // considers, against courses from ONE option, with season, prerequisites and distinctness
    // all quantified together. The pools travel on the cell (see `deriveCells`), so no call
    // site can forget to ask. An approximation of a rule, kept beside the exact rule, is just
    // a second thing to get wrong.
    return { terms: ts, plans, impossible, critical };
  };

  let shape = baseShape;
  let { terms, plans, impossible, critical } = layout(shape);

  // ── 4b. A chain longer than the plan stretches the PLAN ──────────
  //
  // A prerequisite chain is a fact; how many years a department prints is a
  // convention. 16 programs refused because a four-course chain would not fit three
  // published terms, and the useful output there is a four-term plan saying so, not
  // silence. Same ranking as the availability fix, one level up.
  //
  // One retry, sized from the deficit the critical path reports, and capped: a chain
  // that needs four more years than the degree publishes is a data defect rather than
  // a long program, and stretching to meet it would produce a plan nobody would read.
  // ── Both lists, because the refusal already reads both ────────────
  //
  // A cell can be reported unplaceable by either of two mechanisms, and they record the SAME
  // reason under different field names: `buildDomains` emits `prereq-chain-longer-than-plan`
  // when `minDepth >= terms.length`, and `criticalPath` emits it when the longest path does not
  // fit. Three lines below, `preflight` refuses on the UNION of the two — but the decision to
  // stretch read only `critical.impossible`, so a chain caught by domain construction never
  // triggered a retry at all. One list decided, both lists condemned.
  const blocked = [...impossible, ...critical.impossible];
  const chainDeficit = Math.max(0, ...blocked
    .filter(x => x.reason === "prereq-chain-longer-than-plan")
    // `earliest` is the critical path's field and `minDepth` is `buildDomains`'. Reading only
    // the first scored every domain-derived blockage as a zero deficit.
    .map(x => (x.earliest ?? x.minDepth ?? 0) - (terms.length - 1)));
  if (chainDeficit > 0 && chainDeficit <= MAX_EXTRA_TERMS) {
    const perYear = Math.max(1, terms.length / Math.max(1, shape.terms.length
      ? Math.max(...shape.terms.map(t => t.yearIndex)) + 1 : 1));
    const stretched = extendShape(shape, Math.ceil(chainDeficit / perYear));
    const retry = layout(stretched);
    // Only keep it if it actually helped. A stretch that solves nothing is a longer
    // plan for no reason.
    //
    // Judged on the union too, and MONOTONICALLY: the old test is kept as a second disjunct so
    // this can only ever accept MORE stretches than before, never fewer. Replacing it outright
    // would have risked rejecting a stretch that currently rescues a program — a coverage
    // regression smuggled in as a tidy-up, which is the shape of two of today's mistakes.
    const wasBlocked = impossible.length + critical.impossible.length;
    const nowBlocked = retry.impossible.length + retry.critical.impossible.length;
    if (nowBlocked < wasBlocked
        || retry.critical.impossible.length < critical.impossible.length) {
      shape = stretched;
      ({ terms, plans, impossible, critical } = retry);
    }
  }

  // ── 4c. A retired course must not cost the whole degree ──────────
  //
  // MEASURED: 65 of 89 refused shapes were blocked by exactly ONE cell, and the biggest
  // single cause is a requirement naming a course the catalog no longer runs. `CS 3700
  // Networks and Distributed Systems` blocks four cybersecurity degrees on its own — its
  // offering history ends Spring 2024, so every season reads below the availability bar,
  // while `CS 4700 Network Fundamentals` carries the same role with all seasons populated.
  // It was renumbered and the requirements still name the dead one.
  //
  // Refusing to SCHEDULE it is correct: the engine and the app agree it is unavailable, and
  // placing it anywhere would be a hard availability violation. Refusing the whole DEGREE
  // over it is not — 31 of 32 courses were placeable, and the student is told nothing.
  //
  // ── The cut is on `seasons`, not on the reason ──────────────────
  //
  // `never-offered-in-any-term-this-plan-uses` is SHAPE-DEPENDENT, and reading it as
  // "retired" would have been wrong. A course that runs only in fall looks identical to a
  // dead one when the chosen co-op cycle leaves no fall term free — and one of those is our
  // problem while the other is the catalog's. `seasons` already records where the
  // candidates DO run, so the two are distinguishable without new data.
  //
  // MEASURED over the 89 blocked cells: 81 run in NO season whatsoever, 8 run in fall. So
  // the stranded class is real and dominant, and the 8 stay refusals — a different published
  // variant would place them, which is a better answer than a plan with a hole in it.
  //
  // What this trades, stated plainly: "requirement coverage is true by construction" becomes
  // "true except where the catalog names a course that cannot be taken". That is a real
  // weakening of a guarantee, and the alternative was withholding an otherwise correct plan
  // over a defect in someone else's data. Auto-substituting `CS 4700` is NOT done: nothing
  // in the data says the two courses are the same requirement, and a wrong substitution is a
  // wrong plan.
  // ── Why the cell is REPLACED and not dropped ────────────────────
  //
  // Dropping it was the first attempt and it does not work, which a test caught rather than
  // a corpus run: the four-course rule is HARD, so removing one real course from a degree
  // whose full terms were exactly filled leaves a term with three and the whole plan is
  // refused for `full-term-cannot-reach-four`. The hole propagates — it also short-changes
  // the credit total and the shape's own term targets.
  //
  // So the cell keeps its size and its requirement and loses only its COURSE LIST. That is
  // not a fudge, it is what every other cell in a CHART plan already is: a reservation, not
  // a decision. An elective cell is unsatisfied until a course is placed in it, and a
  // requirement whose named course has been retired is in exactly that state — the student
  // will put whatever their advisor now approves into that slot. `substitutePrereqs` spends
  // an elective slot for the mirror-image problem, so this is the established currency here.
  //
  // Precedence is rebuilt rather than patched: the cell no longer names a course, so it has
  // no prerequisites, depth or edges of its own, and the index that has to know is the one
  // computed from the cells. Patching in place is how the two drift.
  const strandedInfo = impossible.filter(isStranded);
  if (strandedInfo.length) {
    const ids = new Set(strandedInfo.map(x => x.cell));
    // ── But a plan that is MOSTLY placeholder is worse than no plan ──
    //
    // If enough of a degree is stranded, emitting it produces the exact artifact the
    // pre-flight gate exists to refuse: authoritative-looking and empty of information.
    // Reusing `MAX_DERIVED_GE_SHARE` rather than inventing a second threshold, because it is
    // the same question about the same quantity — what share of this degree is a slot we
    // cannot name — and it was measured at the knee of the corpus distribution.
    const share = cellsSH(cells.filter(c => ids.has(c.id))) / Math.max(1, cellsSH(cells));
    if (share > MAX_DERIVED_GE_SHARE) {
      return {
        refused: {
          reason: "mostly-unschedulable",
          detail: `${Math.round(100 * share)}% of this degree's credits are requirements naming `
            + `courses that are no longer offered, so a generated plan would be mostly `
            + `placeholder. The catalog's own requirement list needs updating.`,
          data: { share, cells: strandedInfo.slice(0, 5), breadthBound },
        },
      };
    }
    cells = cells.map(c => (ids.has(c.id)
      // `kind: "open"` with no spec is what makes `candidatesFor` return null — the cell
      // admits any course. Keeping the ORIGINAL candidate list would reproduce the empty
      // domain that stranded it in the first place.
      ? { ...c, kind: "open", groups: null, spec: null, stranded: true }
      : c));
    precedence = buildPrecedence(cells, courseMap, { observed: observedOrder });
    ({ terms, plans, impossible, critical } = layout(shape));
  }

  // ── 5. Refuse now, cheaply, or commit to searching ──────────────
  const gate = preflight({
    program, programData: program, cells, shape, ports, studentType,
    impossible: [...impossible, ...critical.impossible],
  });
  // A gate result with `warn` is not a refusal — it is a discrepancy in the catalog
  // that the student should know about and that does not stop a plan being built.
  if (gate && !gate.warn) return { refused: gate };
  const warnings = gate?.warn ? [{ kind: gate.warn, ...gate.data }] : [];

  // ── 6. A legal plan ────────────────────────────────────────────
  const placed = placeCells({
    plans, terms, ports, studentType, courseMap, repeatable, nodeBudget, timeBudgetMs,
    precedence, shape, cal,
    // Where the department puts each course. A branch ORDER, not a constraint: it steers the
    // search toward an arrangement we know exists rather than toward position 0. See
    // `seed.js` — International Business exhausted the budget looking elsewhere.
    seed: seedFromPlan(publishedPlan),
    // Off only so the claim "a pruning propagator does not move an existing plan" can be
    // TESTED rather than argued — see `chart-propagator-neutral.test.js`. Production never
    // passes false, and the invariant it protects is the whole basis of §17's placement rule.
    propagateChains, packOnly,
    // Injectable so DETERMINISM can be tested as the property it is, rather than as a race
    // against the machine. With a frozen clock the search is bounded by nodes alone and the
    // same input must give the same plan; with the real clock a slow run can only ever
    // convert an answer into a refusal, never into a different answer.
    now,
  });
  if (!placed.ok) {
    // Name a term where the shape itself cannot hold what only it can hold. The
    // search's own failure is about a cell; this is about the calendar, and it is
    // the more useful sentence when both are true.
    const tight = tightestTerms({ plans, terms, ports, studentType });
    return {
      refused: {
        reason: placed.failure.kind,
        detail: tight.length
          ? `${tight[0].label} must hold ${tight[0].forcedSH} credits but allows ${tight[0].cap}.`
          : (placed.failure.detail ?? describe(placed.failure)),
        // `nodes` and `exhaustedSpace` make the refusal classifiable without re-running it:
        // a shape that stops after 400 nodes with the space exhausted is a different problem
        // from one that spends 20,000 and gives up, and the reason string alone conflated them.
        data: {
          ...placed.failure, tightestTerms: tight.slice(0, 3),
          nodes: placed.nodes, restarts: placed.restarts,
          exhaustedSpace: placed.exhaustedSpace ?? false,
          breadthBound,
        },
      },
    };
  }

  // ── 7. A better plan ───────────────────────────────────────────
  const improved = improve({
    plans, terms, termOf: placed.termOf, ports, studentType, courseMap,
    repeatable, preferences, precedence, shape, cal,
    boundary: firstWorkBoundary(shape),
    depthOf: depth.depthOf,
  });

  // ── 8. The artifact ────────────────────────────────────────────
  const plan = emitPlan({
    shape, plans, termOf: improved.termOf, program, courseMap,
    reasons: improved.reasons,
  });

  // ── 9. The criteria are HARD, so a plan that fails one is not offered ──
  //
  // See docs/chart-success-criteria.md. These are not quality metrics to report and
  // improve on: a full term that is not full, a semester the student is not enrolled in,
  // or a term that is nothing but unlabelled electives makes the plan one NU Map should
  // not put in front of a student. The sanctioned outcome for those is a refusal.
  //
  // Checked on the EMITTED document rather than on the assignment, for the same reason
  // `gatePlan` is: the artifact is what the student sees, and the two have disagreed
  // before — a co-op term with no marker read as an empty semester until `emit` was fixed.
  //
  // This is deliberately the last thing that happens. Everything before it exists to make
  // the plan pass; this only decides whether it did.
  const failed = criteriaFailures(plan, { studentType, cal, courseMap });
  if (failed.length) {
    return {
      refused: {
        reason: "fails-hard-criteria",
        detail: failed[0].detail,
        // How the plan was BUILT, carried with the verdict. Without it a criteria refusal
        // says a term came out empty and nothing about which tier emptied it — and the
        // tiers behave differently enough that the answer decides where the fix goes: the
        // DFS follows the seed hints and the last-resort packer does not.
        data: {
          failures: failed.slice(0, 4),
          relaxed: placed.relaxed ?? null,
          nodes: placed.nodes ?? null,
        },
      },
    };
  }

  return {
    plan,
    report: {
      cells: cells.length,
      cellsSH: cellsSH(cells),
      totalCreditsRequired: program?.totalCreditsRequired ?? null,
      // How many academic years the plan spans. A CALLER CONTRACT, not decoration:
      // `applySamplePlan` silently drops a year it has no semester for, so a five-year
      // grid loses a six-year plan's last year and reports `outside-timeline`. PharmD
      // is six years. Whoever calls CHART must supply a grid at least this long.
      years: shape.terms.length ? Math.max(...shape.terms.map(t => t.yearIndex)) + 1 : 0,
      studyTerms: terms.length,
      workTerms: shape.terms.filter(t => t.work).length,
      // Terms the student is EMPLOYED in, which is not the same count: a term carrying a
      // co-op and a course is not a work term and still emits a co-op cell. Reported so
      // the "no co-op is lost" invariant can stay an equality — against `workTerms` it
      // would have to weaken to `>=`, and a `>=` cannot notice a work term whose co-op
      // vanished while a mixed term supplied one.
      coopTerms: shape.terms.filter(t => t.work || t.coop).length,
      unusedTerms: shape.terms.filter(t => t.unused).length,
      shapeSource: shape.source,
      nodes: placed.nodes,
      // The four-course bar that ACTUALLY applies, after student type. Zero for a graduate
      // degree, which is the whole point of exposing it: the explainer stated "four courses in
      // every full fall and spring" to master's and PhD students, for whom it is false and
      // `canStillFill` never enforces it. A rule the reader can check has to be a rule that
      // applies to them.
      fullTermMinCourses: minCoursesFor(cal, studentType),
      // ── Does the four-course bar apply to THIS degree at all? ──────
      //
      // The same `surplus >= 0` test `attemptPlacement` uses: a degree with fewer real courses
      // than its full terms need cannot satisfy the bar however it is arranged, so the search
      // does not enforce it. Exposed so the explainer can OMIT the rule rather than state it
      // with an "unless" — a rule qualified into mush is worse than a rule left out, and 20
      // shapes are in exactly this position.
      fullTermBarApplies: minCoursesFor(cal, studentType) > 0
        && cells.filter(c => (c.sh ?? 0) >= cal.realCourseSH).length
           >= minCoursesFor(cal, studentType) * terms.filter(t => (t.weight ?? 1) >= 1).length,
      // ── Courses added that the degree never asked for ─────────────
      //
      // `substitutePrereqs` spends a free-elective slot on a prerequisite the degree lists
      // nowhere, because otherwise the plan meets every requirement and the student still
      // cannot register. That is the right call and it was entirely UNREPORTED: a course
      // appeared in the plan, the degree does not name it, and nothing said why.
      //
      // A decision the engine makes on the student's behalf has to be visible, which is the
      // same principle as `unschedulable` — silence about a choice is worse than the choice.
      substituted: subbed.substituted.map(x => ({
        course: x.course, forCourse: x.forCourse, sh: x.sh,
      })),
      // Which tier produced this plan. `true` means the four-courses-per-full-term bound
      // could not be met and was dropped — a fact about the degree's arithmetic against
      // this shape, and the difference between "thin term" and "thin term for a reason".
      cardinalityRelaxed: placed.cardinalityRelaxed ?? false,
      // ── Requirements this plan does NOT cover, and why ──────────
      //
      // The one place coverage is not true by construction (§4c). Empty for all but the
      // shapes the catalog strands, and it must be rendered wherever the plan is: a plan
      // silently missing a requirement is exactly the "looks authoritative and says
      // nothing" failure the pre-flight gate exists to prevent, and this would be a
      // smaller, sneakier version of it.
      unschedulable: strandedInfo.map(x => ({
        title: x.title, target: x.target, reason: x.reason,
        // The named course, when the cell had exactly one candidate — which is the common
        // case here, and the difference between "a requirement is unavailable" and
        // "CS 3700 is no longer offered".
        courses: x.courses ?? null,
        sh: x.sh ?? null,
      })),
      // WHICH conventions were spent to get a plan at all, in the order they were given up.
      // A plan that stops following a rule it claims to follow, without saying so, is worse
      // than one that says so.
      relaxed: placed.relaxed ?? [],
      moves: improved.moves,
      scores: improved.scores,
      thresholds: improved.thresholds,
      trades: improved.trades,
      notes, reconciliation, warnings,
      // Years added because a prerequisite chain did not fit what the department
      // publishes. A finding about the program, not a detail about the engine.
      extendedBy: shape.extendedBy ?? 0,
      // Terms the published plan leaves empty that this plan needed. Availability
      // never gives way, so where a course only runs in a season the department's
      // own plan skips, the SHAPE yields and says so. That is a statement a student
      // can act on — "your plan uses a summer the department's does not, because
      // X only runs then" — where a silently violated season is not.
      optionalTermsUsed: terms
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => t.optional &&
          [...improved.termOf.values()].includes(i))
        .map(({ t }) => `${t.label} ${t.termLabel}`.trim()),
      // Courses whose prerequisites this plan does not schedule at all. Not a
      // sequencing error — the student may meet them by transfer, AP or an
      // elective — but the student is entitled to know which they are.
      unscheduledPrereqs: precedence.unscheduledPrereqs,
      // Prerequisites the degree never requires, now scheduled into a free-elective slot.
      // Reported because a named course sitting in what the requirements call a general
      // elective needs an explanation, and "you cannot take X without this" is one.
      substitutedPrereqs: subbed.substituted,
      // A bound resting on prereq data we know is incomplete. Surfaced rather
      // than buried: it is the difference between a verified plan and a plausible
      // one, and the student is entitled to know which they have.
      approximateBounds: [...new Set(
        plans.flatMap(p => (p.candidates ?? []).filter(id => depth.approximate(id))),
      )].length,
      // Major electives actually pulled ahead of a low-unlock requirement.
      depthTrades: improved.depthTrades ?? [],
      // Requirements that took an early term back from a general elective, and from where.
      // Countable for the same reason: this pass answers the complaint CHART exists for, so
      // its effect has to be auditable rather than asserted.
      reclaimed: improved.reclaimed ?? [],
      // ── Is any major depth being left on the table? ───────────────
      //
      // The question a student cares about is not where a pool sits in the abstract, it
      // is whether something with LESS to say about the degree took an earlier slot from
      // it. Absolute earliness is not a defect: 34 cells and 10 terms means nearly every
      // cell "could" have been earlier in isolation, so measuring a pool against the
      // first term its share clears mostly measures arithmetic. That version reported
      // 58% of pools "late" and meant nothing.
      //
      // The comparative version is a real defect count: a major-subject elective placed
      // AFTER a requirement that unlocks nothing, where the two could simply trade
      // terms. Each such pair is depth a co-op recruiter would have seen and does not.
      //
      // ── An UPPER BOUND, not a defect count ────────────────────────
      //
      // This check is deliberately cheaper than `tradeDepth`, which applies these trades
      // and verifies each one against the full prereq-aware witness. So a pair reported
      // here may be one the witness legitimately rejects, and the count is a ceiling on
      // what is still available rather than a list of mistakes. Read the other way round
      // it is worth having: if this is ZERO, no trade exists under even the loose test,
      // which is a real guarantee.
      //
      // Recorded because the looser reading was nearly published as "43.6% of programs
      // still leave depth on the table", which the number does not say.
      depthLeftOnTable: (() => {
        const at = (p) => improved.termOf.get(p.cell.id);
        const cap = terms.map(t => t.targetSH || Infinity);
        const load = terms.map(() => 0);
        for (const p of plans) {
          const i = at(p);
          if (i != null) load[i] += p.cell.sh ?? 0;
        }
        const unlockValue = unlockValues(unlockUniverse(plans), courseMap);
        const pools = plans.filter(p => p.reachAt && isPoolCell(p));
        const flat = plans.filter(p => p.cell.groups && unlockOfCell(p, unlockValue) === 0);
        const pairs = [];
        for (const pool of pools) {
          const j = at(pool);
          if (j == null) continue;
          for (const t of flat) {
            const i = at(t);
            if (i == null || i >= j) continue;
            if (!pool.domain.includes(i) || !t.domain.includes(j)) continue;
            if ((pool.reachAt[i] ?? 1) < cal.poolReachMin) continue;
            const dsh = (pool.cell.sh ?? 0) - (t.cell.sh ?? 0);
            if (load[i] + dsh > cap[i] || load[j] - dsh > cap[j]) continue;
            pairs.push({ pool: pool.cell.title ?? "", flat: t.cell.title ?? "", from: j, to: i });
          }
        }
        return pairs;
      })(),
    },
  };
}

/**
 * The hard criteria, read off the emitted plan.
 *
 * `docs/chart-success-criteria.md` states three, and they are HARD: a plan that fails one
 * is not offered at all. The alternative — offering it with the failure reported — was the
 * standing behaviour and is what put a spring with three courses and two years of nothing
 * but "General Elective" in front of a student.
 *
 * A refusal is not free either: the fallback is the department's published plan, which this
 * corpus measures at 31.9% season violations. So this runs LAST, after every rung and the
 * packing fallback, and only decides whether the work succeeded.
 *
 * Half terms and co-op terms are exempt from the course count by construction — a summer
 * holds two, and a term spent employed is not a full course load. The four-course bar is an
 * undergraduate convention and `minCoursesFor` returns 0 for graduates, which switches the
 * first check off for them rather than inventing a rule their departments do not follow.
 */
function criteriaFailures(plan, { studentType, cal, courseMap }) {
  const out = [];
  let minCourses = minCoursesFor(cal, studentType);
  const flat = (es, acc = []) => { for (const e of es ?? []) { acc.push(e); flat(e.children, acc); } return acc; };
  // Bare "Elective"/"General Elective", with or without an aside. A NUPath code in
  // parentheses is guidance and does not count — see `chart-gate.js` `isUnguided`, which
  // this mirrors deliberately rather than importing, because scripts must not be a runtime
  // dependency of the engine.
  const unguided = (text) => {
    const m = /^(general\s+|open\s+|free\s+)?electives?\s*(\(([^)]*)\))?$/i
      .exec(String(text ?? "").trim());
    return !!m && !/^[A-Z]{2}$/.test((m[3] ?? "").trim());
  };

  // ── The bar has to be SATISFIABLE before it can be failed ────────
  //
  // A degree with sixteen real courses and five full terms cannot put four in each of them,
  // however it is arranged — that is a fact about the degree, not a defect in the plan, and
  // `attemptPlacement` already switches its own cardinality propagator off on exactly this
  // test. Refusing here would refuse the degree for being small, which is not what "every
  // full term must be full" means.
  //
  // Empty terms and all-elective terms are still failures for those degrees. Only the count
  // is waived, and only when no arrangement could have met it.
  if (minCourses > 0) {
    let real = 0, fulls = 0;
    for (const y of plan?.plans?.[0]?.years ?? []) for (const t of y.terms ?? []) {
      const es = flat(t.entries);
      if (es.some(e => e.coop) || /summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`)) continue;
      const cells = es.filter(e => !e.vacation && !e.heading);
      if (!cells.length) continue;
      fulls++;
      real += realCoursesIn(cells, courseMap, cal.realCourseSH);
    }
    if (real < fulls * minCourses) minCourses = 0;
  }

  for (const y of plan?.plans?.[0]?.years ?? []) {
    for (const t of y.terms ?? []) {
      const label = `${y.label ?? ""} ${t.term ?? ""}`.trim();
      const es = flat(t.entries);
      if (es.some(e => e.coop)) continue;                       // employed, not enrolled
      if (/summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`)) continue;
      const cells = es.filter(e => !e.vacation && !e.heading);

      // Criterion 1, worst case: a semester the student is not enrolled in.
      if (!cells.length) {
        out.push({ criterion: 1, term: label, detail: `${label} is empty — a semester you are not enrolled in.` });
        continue;
      }
      // Criterion 1: a full term carries four courses of at least `realCourseSH`.
      if (minCourses > 0) {
        const big = realCoursesIn(cells, courseMap, cal.realCourseSH);
        if (big < minCourses) {
          out.push({ criterion: 1, term: label,
                     detail: `${label} carries ${big} courses of ${cal.realCourseSH}+ credits, not ${minCourses}.` });
        }
      }
      // Criterion 3: a term that says nothing at all about what to take.
      if (cells.length && cells.every(e => unguided(e.text))) {
        out.push({ criterion: 3, term: label,
                   detail: `${label} is nothing but unlabelled electives.` });
      }
    }
  }
  return out;
}

/**
 * How many real courses a term's emitted entries amount to.
 *
 * Named entries are resolved to course ids so `realCourseCount` can merge corequisite
 * partners — two 2 SH halves of one course are one course, not two oddments. A reservation
 * names nothing, so it is counted on its own credit: it is one course the student will pick,
 * and it has no partners to merge with.
 */
function realCoursesIn(cells, courseMap, realCourseSH) {
  const named = [];
  let anonymous = 0;
  for (const e of cells) {
    const ids = e.options?.length === 1 ? e.options[0] : null;
    if (ids?.length) named.push({ id: ids[0], sh: e.sh ?? 0 });
    else if ((e.sh ?? 0) >= realCourseSH) anonymous += 1;
  }
  return realCourseCount(named, courseMap, realCourseSH) + anonymous;
}

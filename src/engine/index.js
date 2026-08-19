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

import { deriveCells, cellsSH, substitutePrereqs, withdrawWorkTermCells, assignRegistrations, GENERAL_ELECTIVE } from "./demand.js";
import { shapeFromPlan, defaultShape, studyTerms, firstWorkBoundary, extendShape } from "./shape.js";
import { seedFromPlan } from "./seed.js";
import {
  adoptEarlyTerms, applyEarlyTerms, EARLY_TERMS, FIRST_TERM_OVERLOAD_MAX,
} from "./earlyTerms.js";
import { buildDomains, wideAtFor, termCapacity } from "./domains.js";
import { buildPrecedence, criticalPath } from "./precedence.js";
import { preflight, tightestTerms, MAX_DERIVED_GE_SHARE } from "./preflight.js";
import {
  placeCells, describe, DEFAULT_NODE_BUDGET, DEFAULT_TIME_BUDGET_MS,
  POOL_MIN_CANDIDATES, unlockUniverse, unlockOfCell, isPoolCell,
} from "./search.js";
import { unlockValues } from "./prereqDepth.js";
import { improve, DEFAULT_PREFERENCES } from "./objective.js";
import { emitPlan, cellText } from "./emit.js";
import { buildDepthIndex } from "./prereqDepth.js";
import { withDefaults } from "./ports.js";
import { withCalibration, minCoursesFor } from "./calibration.js";
import { EXCLUSION } from "./trace.js";
import { cellSubject } from "./subjects.js";
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
// The output port, beside the input one. `src/engine/` is internal apart from this file, so a
// caller that wants to watch the search asks for the sink here rather than reaching in.
export { createTrace, NULL_TRACE, CAUSES, EXCLUSION, NODE } from "./trace.js";

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
  // ── Following the department may never COST a plan ────────────────
  //
  // Fixing the first four terms to the department's arrangement is a constraint, and
  // `docs/chart-success-criteria.md` §2 is explicit that a refusal is not a safe default:
  // the alternative a student is left with is the published plan itself, which this corpus
  // measures at 7.7% prereq-order and 31.9% season violations. Refusing to print a plan
  // while recommending a measurably wrong one is not conservatism.
  //
  // So a refusal is not the answer, it is the signal to try again without the arrangement —
  // the same shape as the breadth-guidance retry below, and for the same reason. One
  // fallback, not a ladder: the arrangement is either followed or it is not.
  //
  // Skipped where it cannot help. A pre-flight refusal is about the requirement DATA rather
  // than about where courses go, so re-deriving cells would reach the identical verdict at
  // twice the cost.
  if (first.refused && args.followDepartment !== false
      && !PREFLIGHT_REASONS.has(first.refused.reason)) {
    if (args.trace) args.trace.stage("retry", { because: "department-early-terms" });
    const own = generatePlan({ ...args, followDepartment: false });
    // The FIRST refusal is the one reported if both fail: it describes the degree, where the
    // retry's describes a degree we deliberately handicapped.
    if (!own.refused) {
      return {
        ...own,
        report: {
          ...own.report,
          relaxed: [...(own.report?.relaxed ?? []), "department-early-terms"],
        },
      };
    }
    return first;
  }
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

  // A retry is part of the process, so it is marked rather than hidden. Without this the
  // recorded node run would simply continue and the spine would show one search where there
  // were two, under different demand.
  if (args.trace) args.trace.stage("retry", { because: "breadth-guidance" });
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
  if (args.trace) args.trace.stage("retry", { because: "fails-hard-criteria" });
  const packed = generateOnce({ ...args, packOnly: true });
  if (!packed.refused) return packed;
  // ── Both passes refused, and the recording is still worth keeping ───
  //
  // This line used to mark the recording `stale`, on the reasoning that "`first`'s plan is the
  // answer" and the panel must not walk a reader through a plan they are not looking at. That
  // reasoning cannot apply HERE: we only reach this line because `packed.refused` as well, so
  // neither pass produced a plan and there is nothing for the recording to misrepresent. The
  // marker fired exclusively in the one case it did not describe, and `deriveModel` returned
  // null for it — blanking the process view for a refused degree, which is precisely the case
  // where the process is the only account there is.
  //
  // What the recording holds is the packer pass, end to end and internally consistent:
  // `narrowing-done → packer → packer-done → search-done → improve-done → refused`, ending in
  // the SAME reason this function returns. Measured on cyber-physical_systems_ms_(boston):
  // returned `fails-hard-criteria`, recorded `fails-hard-criteria`. Keeping it costs nothing
  // and is the only explanation the student gets.
  //
  // `first`'s refusal is still the one reported, for the reason given above — it describes what
  // the search found rather than what the packer did.
  return first;
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
  // Where the departments put each course, from `public/northeastern/plan-order.json`. Injected
  // like `observedOrder` and for the same reason: derived data carrying a support count, which a
  // caller is entitled to plan without. It is a FLOOR on how early a requirement may be
  // reclaimed and never a target — see `reclaimFromFiller`.
  positions = null,
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
  // A stand-in arrangement for a program whose department publishes no plan — 365 of the
  // 1,031 shapes, which until now had nothing for `seed.js` to read and started their
  // search at position 0.
  //
  // Built offline by `scripts/derive-early-donors.js` from structurally similar programs
  // that DO publish one, and injected for the same reason `observedOrder` is: derived
  // evidence with a confidence attached, which a caller is entitled to plan without. It
  // supplies CONTENT only. The shape still comes from `defaultShape`, because the donor's
  // co-op cycle is the donor's own.
  donorPlan = null,
  // ── The department plans the first four terms ─────────────────────
  //
  // Off only as the FALLBACK: fixing a term is a constraint, and a constraint can refuse a
  // degree that would otherwise have planned. `generatePlan` turns it off and retries rather
  // than letting that happen, and records `relaxed: ["department-early-terms"]` so a plan
  // built without the department's arrangement never silently claims to have followed it.
  // Production's first attempt is always true.
  followDepartment = true,
  // How many study terms the department plans. A measurement hatch in the spirit of
  // `propagateChains` — "following the department beats inferring from a course number" is a
  // claim about a corpus and has to be runnable both ways — not a tuning knob.
  earlyTerms = EARLY_TERMS,
  // ── Where the derivation view gets its material ───────────────────
  //
  // A recording sink from `src/engine/trace.js`, or null. Null is the production default for
  // every caller except the browser's "show me the process" panel, and it is what keeps
  // `verify-chart`'s 1,031 shapes unaffected.
  //
  // It is NOT part of the report and never reaches `plan.json`. A saturated program records
  // ~20,000 nodes, and the plan document is persisted, shared by link and diffed by the
  // monthly workflow — none of which wants a search log welded to it. CHART runs in the
  // browser, so the trace is recorded live, read by the panel, and dropped.
  trace = null,
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

  if (trace) trace.stage("demand");
  let { cells, notes, reconciliation } =
    deriveCells(program, { courseMap, repeatable, concentration, grantedAttributes,
                           breadthGuidance });
  // A work-experience requirement is RECORDED by a co-op block, not attended.
  // Taken out here — before precedence, domains or the search see it — because
  // every one of those layers would otherwise treat it as a course to schedule,
  // and did: International Business booked COOP 3948 as a Year 4 Fall class
  // beside the four co-op terms its own plan already carries. Withdrawing costs
  // no credit; these cells are charged 0 SH either way. See the function.
  const { cells: schedulable, withdrawn: workTermCells } =
    withdrawWorkTermCells(cells, ports.workExperience, hasCoop);
  cells = schedulable;
  if (workTermCells.length) {
    notes = [...notes, ...workTermCells.map(w => ({
      kind: "work-term-requirement", cell: w.id, title: w.title, keys: w.keys, why: w.why,
    }))];
  }
  if (trace) trace.stage("demand-done", { cells: cells.length, sh: cellsSH(cells),
                                          workTermCells: workTermCells.length });
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
  const subbed = substitutePrereqs(cells, precedence.unscheduledPrereqs, courseMap,
    { depthOf: depth.depthOf, workExperience: ports.workExperience });
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
      trace,
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
      if (narrowed.length) {
        // The second narrowing, and the only one the card's own data cannot explain: these
        // terms are legal for the card in isolation and illegal given what has to come before
        // and after it. Recorded separately for exactly that reason — collapsing it into
        // "before its prerequisites" would attribute a chain-wide bound to one course.
        if (trace && p.excluded) {
          for (const t of p.domain) {
            if (t < lo || t > hi) p.excluded.push({ term: t, reason: EXCLUSION.PRECEDENCE_WINDOW });
          }
        }
        p.domain = narrowed;
      }
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
      // Before any card is placed, so there is no search to show — but the stage is still emitted
      // so that every refusal path ends the same way. A `refused` stage missing on one route is
      // how the criteria refusal came to claim a stage had produced a plan.
      if (trace) trace.stage("refused", { reason: "mostly-unschedulable", share });
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
  if (gate && !gate.warn) {
    // The fourth and last refusal route. All four now emit the stage, which is the property worth
    // having: "a refused run has a `refused` stage" is checkable, where "most refusals do" is not.
    if (trace) trace.stage("refused", { reason: gate.reason ?? null, preflight: true });
    return { refused: gate };
  }
  const warnings = gate?.warn ? [{ kind: gate.warn, ...gate.data }] : [];

  // ── 5b. The department plans the first four terms ───────────────
  //
  // Here, and not earlier, because this is the first point at which the shape, the domains and
  // the precedence index are all final — a stretched shape or a stranded cell rebuilds the
  // layout, and a term fixed against a layout that was then thrown away would aim at nothing.
  //
  // `donorPlan` is the stand-in for a program whose department publishes nothing, and the
  // department's own plan always wins where there is one. Both are read the same way and
  // repaired the same way, which is the point of emitting the donor in a published plan's
  // shape: there is one mechanism here, not two.
  //
  // See `earlyTerms.js`. This narrows domains to a unit and so is the one thing in this
  // function that can turn a plan into a refusal — which is exactly why `generatePlan`
  // retries with `followDepartment: false` and says so in `report.relaxed`.
  const early = followDepartment
    ? adoptEarlyTerms({
        publishedPlan: publishedPlan ?? donorPlan, shape, plans, precedence,
        through: earlyTerms,
        // The SAME capacity the search enforces, read through the same function — any
        // disagreement would be silent, since we would fix an arrangement it then refuses.
        //
        // Except in the FIRST semester, where a department publishing over the cap is a
        // block schedule an advisor signs off rather than a term nobody can register for.
        // 4.0% of published first terms exceed 19 SH and no later term ever does; see
        // `FIRST_TERM_OVERLOAD_MAX` for why the allowance is 21 and why it stops there.
        capOf: (ti) => termCapacity(terms[ti], { creditMax: ports.creditMax, studentType }),
        // The CEILING on that allowance, not the allowance itself — `adoptEarlyTerms` raises
        // term 0 only as far as this department's own published load, so we can never invent
        // an overload for a program that publishes a normal first semester.
        firstTermOverload: FIRST_TERM_OVERLOAD_MAX * (terms[0]?.weight ?? 1),
      })
    : { placed: new Map(), moves: [], unplaced: [], load: new Map() };
  // ── Let the search hold what the department published ──────────────
  //
  // Raised to the load ACTUALLY adopted rather than to the allowance, so an overloaded first
  // semester carries the department's own courses and not one more of our choosing. Without
  // this the two ceilings disagree and every one of these programs still refuses: adoption
  // would fix 20 SH into a term the search caps at 19.
  //
  // Mutating the term is the same shape as the critical-path narrowing above, which edits
  // `plans` in place for the same reason — this is the layout being finalised, and `terms`
  // is the array the search is about to read.
  //
  // Recorded as well as applied, because `chart-hard-rules` puts the objection exactly
  // right: an over-cap term is "an overload petition the plan does not mention". The
  // petition is the student's to file and ours to disclose, so a first semester above the
  // ordinary cap has to SAY it is, in the panel and in the report.
  let earlyOverload = null;
  if (terms[0] && (early.load?.get(0) ?? 0) > 0) {
    const want = early.load.get(0);
    const base = termCapacity(terms[0], { creditMax: ports.creditMax, studentType });
    if (want > base) {
      terms[0].creditCeiling = want;
      earlyOverload = { term: 0, sh: want, cap: base };
    }
  }
  // The exclusion reason is recorded only when something is RECORDING — the same condition
  // the critical-path narrowing above uses. `verify-chart` generates 1,031 plans untraced in
  // the monthly workflow, and an exclusion row per term per fixed cell is pure cost there.
  const earlyFixed = applyEarlyTerms(plans, early.placed,
    trace ? EXCLUSION.DEPARTMENT_TERM : null);

  // ── 6. A legal plan ────────────────────────────────────────────
  //
  // The roster and the domains are recorded HERE and once, from the cell set and the layout the
  // search is about to be handed. Every earlier candidate — a shape that was stretched and the
  // stretch rejected, a layout rebuilt after a stranded cell — is gone by now, so the trace
  // cannot describe a narrowing that no plan was ever built from.
  if (trace) {
    // ── The SUBJECT travels on the roster, computed not guessed ────────
    //
    // The walkthrough colours each course by its subject, and a regex over the card title would
    // be a second, worse reading of something the engine already knows exactly: `cellSubject`
    // resolves a named cell to its one subject and a pool to its dominant one, and returns null
    // where a cell genuinely spans several. A title-scraping fallback would silently mis-colour
    // every `One of (…)` and every elective pool.
    trace.roster(plans.map(p => ({
      ...p.cell,
      candidates: p.candidates?.length ?? null,
      subject: cellSubject(p, courseMap),
      // ── The card reads EXACTLY as the preview's does ─────────────────
      //
      // `cellText` is `emit`'s own derivation, imported rather than repeated. This was a second
      // one — a course code only where a cell named exactly ONE course — and the two had drifted
      // apart in the way a second derivation always does: `CS 1800 and CS 1802` is a corequisite
      // pair the catalog prints as one cell, so it named two courses, scored `null`, and the
      // walkthrough drew a dashed placeholder reading "Computer Science Fundamental Courses"
      // beside a preview reading the two courses. A choice cell was wrong the same way, with the
      // section title standing where the preview prints `CS 4300 or 4100`.
      //
      // The nuance the old version was reaching for is real and is kept by `cellText` itself: an
      // elective pool still names nothing, because `cellText` falls through to the requirement's
      // label for an open cell. What it must not do is treat a cell the plan HAS decided as
      // undecided.
      text: cellText(p.cell, courseMap),
      // Is this a course the plan commits to, or a slot the student fills? The planner draws the
      // two differently — a coloured card against a dashed ghost — and the walkthrough has to make
      // the same call from the same fact rather than by parsing the string above. A `choice` cell
      // is a reservation here exactly as it is in the planner: the plan narrowed it, it did not
      // decide it.
      named: p.cell.kind === "named" && !!p.cell.groups?.[0]?.length,
      // ── ONE ENTRY PER COURSE, because that is what the board holds ───
      //
      // A named cell is one decision to the SEARCH — `CS 1800 and CS 1802` is placed as a unit,
      // and `mergeCoreqCells` exists to keep it that way. It is not one card to the STUDENT:
      // `applySamplePlan` writes a placement per course id, and both the preview and the
      // planner then split them by credit — `sh >= 3` to the main slots, `sh <= 2` to the
      // collapsed "other credits" strip. So the board shows CS 1800 as a course and CS 1802 in
      // the strip, and drawing them as one card is a picture of a plan nobody gets.
      //
      // The cell stays the unit of the recording — every card index in the node stream is a
      // cell index, and renumbering those is the corruption `trace.roster` documents. This is
      // the material for the VIEW to expand, which is the same transformation
      // `applySamplePlan` performs and in the same place: at the boundary between the plan and
      // the board.
      //
      // `title` here is the COURSE's, not the requirement's. Printing the requirement under a
      // course code reads "CS 1200 / Computer Science Overview" where the planner says
      // "CS 1200 / First Year Seminar".
      courses: p.cell.kind === "named"
        ? (p.cell.groups?.[0] ?? [])
            .filter(id => courseMap[id])
            .map(id => ({
              id,
              code: cellText({ kind: "named", groups: [[id]] }, courseMap),
              title: courseMap[id]?.title ?? "",
              sh: courseMap[id]?.sh ?? 0,
            }))
        : null,
      // ── The work terms, which `terms` cannot carry ──────────────────
      //
      // `terms` is `studyTerms(shape)`, and that filters employment out: there is nothing to
      // place in a term the student spends on co-op. The derivation view draws the whole plan
      // though, and a four-year degree drawn with its two co-ops missing is a picture of a
      // different degree. They go in as their own list so no term index moves.
    })), terms, shape.terms.filter(t => t.work));
    trace.domains(plans.map(p => ({
      id: p.cell.id, legal: p.domain, excluded: p.excluded ?? [],
    })));
    trace.stage("narrowing-done", {
      cards: plans.length,
      terms: terms.length,
      // The size of the space the search is entering, as the product of the domain widths. The
      // explainer already prints this figure from `criticalPath` windows; naming it at the
      // stage boundary is what lets the spine say what narrowing BOUGHT.
      legalPairs: plans.reduce((n, p) => n + p.domain.length, 0),
    });
  }
  const placed = placeCells({
    plans, terms, ports, studentType, courseMap, repeatable, nodeBudget, timeBudgetMs,
    precedence, shape, cal,
    // Foundationality against the whole catalog, off the shared depth index. It is what
    // decides whether a requirement outside the major is a prerequisite the rest of the
    // university stands on or a terminal course, and the degree's own requirement list
    // cannot answer that — see `noClaim`.
    catalogUnlock: depth.catalogUnlock,
    // Where the department puts each course. A branch ORDER, not a constraint: it steers the
    // search toward an arrangement we know exists rather than toward position 0. See
    // `seed.js` — International Business exhausted the budget looking elsewhere.
    //
    // `shape` is passed so the hint is indexed by year and season rather than by
    // position, which is what lets a BORROWED plan be read: its terms have to be
    // located in this program's shape, not in the donor's. It also fixes the same
    // mapping for a program's own plan, whose work terms used to shift every hint
    // after the first co-op — see seed.js.
    //
    // `donorPlan` is the stand-in for a program whose department publishes nothing,
    // and the department's own plan always wins where there is one.
    seed: seedFromPlan(publishedPlan ?? donorPlan, shape),
    // Off only so the claim "a pruning propagator does not move an existing plan" can be
    // TESTED rather than argued — see `chart-propagator-neutral.test.js`. Production never
    // passes false, and the invariant it protects is the whole basis of §17's placement rule.
    propagateChains, packOnly, trace,
    // Injectable so DETERMINISM can be tested as the property it is, rather than as a race
    // against the machine. With a frozen clock the search is bounded by nodes alone and the
    // same input must give the same plan; with the real clock a slow run can only ever
    // convert an answer into a refusal, never into a different answer.
    now,
  });
  if (!placed.ok) {
    // A refusal is a derivation too, and the more interesting one: it is the case where the
    // process is the ONLY thing there is to show, since there is no plan to read instead.
    if (trace) {
      trace.stage("refused", {
        reason: placed.failure?.kind ?? null,
        nodes: placed.nodes ?? 0,
        exhaustedSpace: placed.exhaustedSpace ?? false,
      });
    }
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
  if (trace) {
    trace.stage("search-done", {
      nodes: placed.nodes ?? 0,
      restarts: placed.restarts ?? 0,
      relaxed: [...(placed.relaxed ?? [])],
    });
  }
  const improved = improve({
    plans, terms, termOf: placed.termOf, ports, studentType, courseMap,
    repeatable, preferences, precedence, shape, cal,
    boundary: firstWorkBoundary(shape),
    depthOf: depth.depthOf,
    // The same index the search reads, so phase 1 and phase 2 cannot disagree about which
    // courses the rest of the university is built on. See `tradeFoundations`.
    catalogUnlock: depth.catalogUnlock,
    positions,
  });
  // ── Hill climbing is recorded from its RESULT, not instrumented ────
  //
  // Phase 2 is local search over COMPLETE assignments, so it has no tree, no depth and no
  // branch causes — the three things the search recording exists to capture. What it has is a
  // move count and a set of trades, both of which `improve` already returns. Instrumenting it
  // would add call sites to a hot loop to re-derive numbers that are handed back for free.
  //
  // The moves are worth showing because they are where a card's term actually CHANGES after the
  // search settled it, and the spine would otherwise imply the search's answer is the plan.
  if (trace) {
    trace.stage("improve-done", {
      moves: improved.moves ?? 0,
      trades: (improved.trades ?? []).length,
      reclaimed: (improved.reclaimed ?? []).length,
      depthTrades: (improved.depthTrades ?? []).length,
    });
    // The swaps themselves, so the walkthrough can play them out on the grid. Bounded by
    // construction (p50 4, max 18), and mapped to roster indices here rather than in the
    // reducer so the model never has to know about cell ids.
    trace.moves((improved.moveLog ?? [])
      .map(m => ({ pass: m.pass, card: trace.cardOf(m.cell), from: m.from, to: m.to }))
      .filter(m => m.card >= 0));
    // Where every card ended up, as roster index → term. The search's own answer and the
    // improved one can differ, and this is the improved one — the plan the student reads.
    trace.chosen([...improved.termOf.entries()]
      .map(([id, ti]) => [trace.cardOf(id), ti])
      .filter(([i]) => i >= 0));
  }

  // ── 8. The artifact ────────────────────────────────────────────
  //
  // Which course each co-op registers. Computed against the FINAL shape, not the
  // base one: `extendShape` can add years, and an index taken before that would
  // name the wrong term. A run is a maximal stretch of consecutive co-op terms —
  // the same merge `applySamplePlan` performs when it turns the grid back into
  // blocks — so Spring + Summer 1 is one six-month co-op, not two.
  const runStarts = [];
  shape.terms.forEach((t, i) => {
    const isCoop = !!(t.work || t.coop);
    const prevCoop = i > 0 && !!(shape.terms[i - 1].work || shape.terms[i - 1].coop);
    if (isCoop && !prevCoop) runStarts.push(i);
  });
  const registersAt = new Map();
  for (const a of assignRegistrations(workTermCells, runStarts.length, ports.workExperience, "coop")) {
    registersAt.set(runStarts[a.runIndex], a.key);
  }

  const plan = emitPlan({
    shape, plans, termOf: improved.termOf, program, courseMap,
    reasons: improved.reasons, registersAt,
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
    // ── A refusal HERE is the one a trace can most easily misreport ───
    //
    // The search succeeded, so the recording holds a solved arrangement — and without this stage
    // the derivation had no way to know the plan was thrown away afterwards. It duly marked the
    // stage that found the arrangement as "produced this plan" for a degree that got none, which
    // is a success claimed inside a refusal.
    //
    // Caught by `chart-derivation-neutral.test.js` on
    // `information_design_and_visualization_graduate_certificate`, whose ladder finds a complete
    // arrangement and whose packer then also fails.
    if (trace) {
      trace.stage("refused", {
        reason: "fails-hard-criteria",
        criterion: failed[0]?.criterion ?? null,
        nodes: placed.nodes ?? 0,
      });
    }
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
      // ── Which of the early terms are the department's, and which are corrections ──
      //
      // Reported rather than hidden because this is the engine CONTRADICTING the catalog, and
      // a student is entitled to know which of their first two years an advisor arranged and
      // which we moved out from under them. `source` is what the UI says out loud: a plan
      // modelled on similar programs must never be described as the department's own.
      earlyTerms: earlyTermsReport({
        followDepartment, publishedPlan, donorPlan, earlyTerms, earlyFixed, early,
        plans, terms, courseMap, overload: earlyOverload,
      }),
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
      // ── How this degree's free credit SPLITS ──────────────────────
      //
      // Rule 1 of `docs/chart-elective-rules.md`, per degree rather than in the abstract. The
      // explainer can then say "5 of your 11" instead of "about half", which is the difference
      // between a fact the reader can check against their own grid and a generality they cannot.
      //
      // `breadth` is how many free electives are set aside for NUPath competencies the major's
      // required courses do not already guarantee; `depth` is what is left for anything. Read off
      // the emitted cells rather than recomputed, so the panel and the plan cannot disagree.
      //
      // A note on what this number IS, since it is about to be shown to a student: it is a
      // planning ALLOWANCE, deliberately generous. Only NAMED courses count as guaranteeing a
      // code, so a competency the student happens to pick up from a choice cell is not credited,
      // and `attributes` covers 1,516 of 7,966 courses. Both push the same way — we may set aside
      // a slot that was not strictly needed, which costs a free choice rather than a graduation.
      generalElectives: (() => {
        const ge = cells.filter(c => c.target === GENERAL_ELECTIVE);
        if (!ge.length) return null;              // no pool: a rule about nothing
        return {
          total: ge.length,
          breadth: ge.filter(c => c.geRole === "breadth").length,
          depth: ge.filter(c => c.geRole === "depth").length,
        };
      })(),
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
/**
 * What to tell the student about who planned their first two years.
 *
 * The engine core stays free of presentation — `earlyTerms.js` speaks in cell ids and term
 * indices, because that is what it reasons about. Turning those into "CHEM 1211, moved from
 * Year 1 Fall" happens HERE, once, where the course map and the term labels already are.
 * Both the explainer and the MCP server read this, so a cell id would make each of them
 * re-derive the same label and disagree about it.
 *
 * `source` is the load-bearing field, and it is the one thing that must never be generous:
 * a plan modelled on OTHER programs may not be described as this department's, and a plan
 * built after the arrangement was dropped may not be described as the department's at all.
 */
function earlyTermsReport({
  followDepartment, publishedPlan, donorPlan, earlyTerms, earlyFixed, early,
  plans, terms, courseMap, overload = null,
}) {
  // A term as DATA, never as an English phrase. `termLabel` is the catalog's own wording and
  // says "Summer 1", which every locale renders as "Summer A" through `SEM_NAME_KEY` — so
  // baking a label here would ship the one string the terminology rule forbids, in all eight
  // languages at once. The UI composes the name; this says which term it is.
  const where = (ti) => {
    const t = terms?.[ti];
    return t ? { year: (t.yearIndex ?? 0) + 1, semTypeId: t.semTypeId ?? null } : null;
  };
  const cellOf = new Map((plans ?? []).map(p => [p.cell.id, p.cell]));
  const name = (id) => {
    const cell = cellOf.get(id);
    return cell ? cellText(cell, courseMap) : String(id);
  };
  return {
    // Not `publishedPlan ? …` alone: the fallback retry sets `followDepartment` false while
    // the published plan is still sitting right there in the arguments, and reporting
    // "department" for a plan we arranged ourselves is the one lie this field can tell.
    source: !followDepartment ? "chart"
      : publishedPlan ? "department"
      : donorPlan ? "similar-programs"
      : "chart",
    through: earlyTerms,
    fixed: earlyFixed,
    // Every course moved out of the term its department names, and why. Not truncated —
    // a correction is rare by construction, and a half-list reads as the whole one.
    moves: (early?.moves ?? []).map(m => ({
      ...m, course: name(m.cell), fromWhere: where(m.from), toWhere: where(m.to),
    })),
    // Named early and legal in no term at or after it, so handed back to the ordinary
    // search — the behaviour that predates all of this, and never an illegal placement.
    unplaced: (early?.unplaced ?? []).map(u => ({
      ...u, course: name(u.cell), fromWhere: where(u.from),
    })),
    // A first semester carrying more than the ordinary registration cap, because its
    // department publishes it that way. Never silent: this is a term the student may need
    // approval to register for, and a plan that quietly assumes the petition is granted has
    // told them something it does not know.
    overload: overload ? { ...overload, where: where(overload.term) } : null,
  };
}

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

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
import { buildDomains, wideAtFor, POOL_REACH_MIN, REAL_COURSE_SH } from "./domains.js";
import { buildPrecedence, criticalPath } from "./precedence.js";
import { preflight, tightestTerms } from "./preflight.js";
import {
  placeCells, describe, DEFAULT_NODE_BUDGET, DEFAULT_TIME_BUDGET_MS,
  POOL_MIN_CANDIDATES, unlockUniverse, unlockOfCell, isPoolCell,
} from "./search.js";
import { unlockValues } from "./prereqDepth.js";
import { improve, DEFAULT_PREFERENCES } from "./objective.js";
import { emitPlan } from "./emit.js";
import { buildDepthIndex } from "./prereqDepth.js";
import { withDefaults } from "./ports.js";

/**
 * The most a prerequisite chain may stretch a plan, in terms.
 *
 * Four. Beyond that a "chain longer than the plan" is a data defect rather than a long
 * program — a cycle read as a chain, or a renumbered course pulling in a whole
 * unrelated sequence — and stretching to meet it produces a plan nobody would read.
 * Refusing is the better answer there, and it names the cell.
 */
export const MAX_EXTRA_TERMS = 4;

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
export function generatePlan({
  program, publishedPlan = null, courseMap = {}, ports: rawPorts = {},
  studentType = "undergraduate", preferences = DEFAULT_PREFERENCES,
  depthIndex = null, repeatable = () => false, nodeBudget = DEFAULT_NODE_BUDGET,
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS, observedOrder = [], coopPrep = [],
  now = () => Date.now(),
} = {}) {
  const prepSet = new Set(coopPrep);
  const ports = withDefaults(rawPorts);
  const depth = depthIndex ?? buildDepthIndex(courseMap);

  // ── 1. What the degree demands ──────────────────────────────────
  let { cells, notes, reconciliation } = deriveCells(program, { courseMap, repeatable });

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
  //
  // How many REAL courses this degree has to place — cells of at least 3 SH — is what
  // decides whether the half-summers are needed at all. `studyTerms` uses it to mark a
  // summer optional once the full terms can absorb the degree, which is what keeps every
  // fall and spring at four. Counted here because the shape does not know the cells.
  const realCourses = cells.filter(c => (c.sh ?? 0) >= REAL_COURSE_SH).length;
  const layout = (sh) => {
    const ts = studyTerms({ ...sh, realCourses });
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
  const chainDeficit = Math.max(0, ...critical.impossible
    .filter(x => x.reason === "prereq-chain-longer-than-plan")
    .map(x => (x.earliest ?? 0) - (terms.length - 1)));
  if (chainDeficit > 0 && chainDeficit <= MAX_EXTRA_TERMS) {
    const perYear = Math.max(1, terms.length / Math.max(1, shape.terms.length
      ? Math.max(...shape.terms.map(t => t.yearIndex)) + 1 : 1));
    const stretched = extendShape(shape, Math.ceil(chainDeficit / perYear));
    const retry = layout(stretched);
    // Only keep it if it actually helped. A stretch that solves nothing is a longer
    // plan for no reason.
    if (retry.critical.impossible.length < critical.impossible.length) {
      shape = stretched;
      ({ terms, plans, impossible, critical } = retry);
    }
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
    precedence, shape,
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
        data: { ...placed.failure, tightestTerms: tight.slice(0, 3) },
      },
    };
  }

  // ── 7. A better plan ───────────────────────────────────────────
  const improved = improve({
    plans, terms, termOf: placed.termOf, ports, studentType, courseMap,
    repeatable, preferences, precedence, shape,
    boundary: firstWorkBoundary(shape),
    depthOf: depth.depthOf,
  });

  // ── 8. The artifact ────────────────────────────────────────────
  const plan = emitPlan({
    shape, plans, termOf: improved.termOf, program, courseMap,
    reasons: improved.reasons,
  });

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
      unusedTerms: shape.terms.filter(t => t.unused).length,
      shapeSource: shape.source,
      nodes: placed.nodes,
      // Which tier produced this plan. `true` means the four-courses-per-full-term bound
      // could not be met and was dropped — a fact about the degree's arithmetic against
      // this shape, and the difference between "thin term" and "thin term for a reason".
      cardinalityRelaxed: placed.cardinalityRelaxed ?? false,
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
            if ((pool.reachAt[i] ?? 1) < POOL_REACH_MIN) continue;
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

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

import { deriveCells, cellsSH } from "./demand.js";
import { shapeFromPlan, defaultShape, studyTerms, firstWorkBoundary } from "./shape.js";
import { buildDomains, wideAtFor } from "./domains.js";
import { buildPrecedence, criticalPath } from "./precedence.js";
import { preflight, tightestTerms } from "./preflight.js";
import { placeCells, describe, DEFAULT_NODE_BUDGET, DEFAULT_TIME_BUDGET_MS } from "./search.js";
import { improve, DEFAULT_PREFERENCES } from "./objective.js";
import { emitPlan } from "./emit.js";
import { buildDepthIndex } from "./prereqDepth.js";
import { withDefaults } from "./ports.js";

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
  timeBudgetMs = DEFAULT_TIME_BUDGET_MS, observedOrder = [],
} = {}) {
  const ports = withDefaults(rawPorts);
  const depth = depthIndex ?? buildDepthIndex(courseMap);

  // ── 1. What the degree demands ──────────────────────────────────
  const { cells, notes, reconciliation } = deriveCells(program, { courseMap, repeatable });

  // ── 2. The skeleton ─────────────────────────────────────────────
  const shape = publishedPlan
    ? shapeFromPlan(publishedPlan)
    : defaultShape({
        totalSH: cellsSH(cells),
        maxTermSH: ports.creditMax(studentType),
        // Aim below the cap, not at it: `protect slack` is a threshold this
        // design keeps, and a plan generated at the cap leaves no room to drop.
        targetTermSH: Math.min(ports.creditMax(studentType),
                               studentType === "graduate" ? 12 : 16),
      });
  const terms = studyTerms(shape);

  // ── 3. Order among the courses this plan commits to ─────────────
  //
  // Before domains, because it supplies the depth floor they need. The catalog-wide
  // DAG says CS 2800 has depth 0; within a plan that also names CS 1800 it has
  // depth 1, and that difference is the whole of the sequencing bound.
  const precedence = buildPrecedence(cells, courseMap, { observed: observedOrder });

  // ── 4. Where each cell could go ─────────────────────────────────
  const { plans, impossible } = buildDomains(cells, terms, {
    courseMap, depthOf: depth.depthOf,
    planDepthOf: precedence.planDepthOf,
    offeringProbability: ports.offeringProbability,
    wideAt: wideAtFor(cells.length),
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

  // ── 5. Refuse now, cheaply, or commit to searching ──────────────
  const refusal = preflight({
    program, programData: program, cells, shape, ports, studentType,
    impossible: [...impossible, ...critical.impossible],
  });
  if (refusal) return { refused: refusal };

  // ── 6. A legal plan ────────────────────────────────────────────
  const placed = placeCells({
    plans, terms, ports, studentType, courseMap, repeatable, nodeBudget, timeBudgetMs,
    precedence,
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
    repeatable, preferences, precedence,
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
      studyTerms: terms.length,
      workTerms: shape.terms.filter(t => t.work).length,
      unusedTerms: shape.terms.filter(t => t.unused).length,
      shapeSource: shape.source,
      nodes: placed.nodes,
      moves: improved.moves,
      scores: improved.scores,
      thresholds: improved.thresholds,
      trades: improved.trades,
      notes, reconciliation,
      // Cells CHART could only place by setting the availability constraint aside,
      // because every candidate is barred from every term this plan uses. Named
      // rather than counted, because "check these with the department" is the
      // action, and a number alone is not actionable.
      availabilityRelaxedCells: plans.filter(p => p.availabilityRelaxed).length,
      availabilityRelaxed: plans.filter(p => p.availabilityRelaxed)
        .map(p => ({ cell: p.cell.id, title: p.cell.title })),
      // Courses whose prerequisites this plan does not schedule at all. Not a
      // sequencing error — the student may meet them by transfer, AP or an
      // elective — but the student is entitled to know which they are.
      unscheduledPrereqs: precedence.unscheduledPrereqs,
      // A bound resting on prereq data we know is incomplete. Surfaced rather
      // than buried: it is the difference between a verified plan and a plausible
      // one, and the student is entitled to know which they have.
      approximateBounds: [...new Set(
        plans.flatMap(p => (p.candidates ?? []).filter(id => depth.approximate(id))),
      )].length,
    },
  };
}

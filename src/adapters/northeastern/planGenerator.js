// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/planGenerator  (implements IPlanGenerator)
//
// The only place that knows both CHART and Northeastern. `src/engine/` imports
// nothing from `src/adapters/`, so everything institution-specific — the credit
// envelope, offering history, co-op rules, the order recovered from published plans —
// is assembled here and injected.
//
// ── Two heavy things, built once ───────────────────────────────────
//
// The prereq depth index takes ~350 ms over the whole catalog, and `plan-order.json`
// is a fetch. Both are properties of the CATALOG rather than of any one program, so
// rebuilding them per generation would make the second plan as slow as the first for
// no reason. Cached against the courseMap identity, so a catalog reload invalidates
// them without anyone having to remember to.
// ═══════════════════════════════════════════════════════════════════

import { IPlanGenerator } from "../../ports/IPlanGenerator.js";
import { generatePlan, DEFAULT_PREFERENCES } from "../../engine/index.js";
import { buildDepthIndex } from "../../engine/prereqDepth.js";
import enginePorts from "./enginePorts.js";
import chartCalibration from "./chartCalibration.js";

/** Where the recovered order lives. Same origin as the rest of the catalog data. */
const PLAN_ORDER_URL = "/northeastern/plan-order.json";

let _depthFor = null;      // { courseMap, index }
let _orderPromise = null;

function depthIndexFor(courseMap) {
  if (_depthFor?.courseMap === courseMap) return _depthFor.index;
  _depthFor = { courseMap, index: buildDepthIndex(courseMap) };
  return _depthFor.index;
}

/**
 * Prerequisites the catalog does not record but its own published plans agree on.
 *
 * Fetched once and cached, and a failure degrades to an empty list rather than
 * blocking generation: without it CHART still orders everything the catalog states,
 * it just loses the calculus sequence it recovered. Degrading to less information
 * beats refusing to answer.
 */
function observedOrder() {
  if (!_orderPromise) {
    _orderPromise = fetch(PLAN_ORDER_URL)
      .then(r => (r.ok ? r.json() : null))
      .then(d => ({ edges: d?.edges ?? [], coopPrep: (d?.coopPrep ?? []).map(x => x.course) }))
      .catch(() => ({ edges: [], coopPrep: [] }));
  }
  return _orderPromise;
}

/** @type {import('../../ports/IPlanGenerator.js').IPlanGenerator} */
export default {
  /**
   * Optimistic on purpose — see the port. A program with parsed requirements and a
   * stated credit total is worth OFFERING to generate; whether it can actually be
   * planned is `generate`'s answer, and a control that vanishes after appearing is
   * worse than one that sometimes explains a refusal.
   */
  canGenerate(programKey, isGrad, programData) {
    if (!programKey || !programData) return false;
    return (programData.requirementSections?.length ?? 0) > 0
        && (programData.totalCreditsRequired ?? 0) > 0;
  },

  async generate({
    programKey, isGrad = false, programData, publishedPlan = null,
    studentType, preferences, courseMap,
  }) {
    if (!courseMap) {
      return { refused: { reason: "no-catalog", detail: "The course catalog has not loaded yet." } };
    }
    const order = await observedOrder();
    // Graduate PROGRAMS and graduate STUDENTS are the same thing here, and the
    // distinction matters: it sets the credit envelope (8–16 rather than 12–19) and
    // removes the class-standing floor, because a student admitted to a master's
    // takes 5000-level courses in their first term.
    const type = studentType ?? (isGrad ? "graduate" : "undergraduate");

    const out = generatePlan({
      program: programData,
      publishedPlan,
      courseMap,
      ports: enginePorts(courseMap),
      depthIndex: depthIndexFor(courseMap),
      observedOrder: order.edges,
      coopPrep: order.coopPrep,
      studentType: type,
      // Northeastern's measured conventions, OWNED by the adapter. The engine ships the same
      // values as a fallback so it works unwired, but they are institution facts and this is
      // where they belong — see chartCalibration.js.
      calibration: chartCalibration,
      preferences: preferences ?? DEFAULT_PREFERENCES,
      // A repeatable course legitimately answers two cells, and merging them would
      // schedule one registration where the program wants two. `courseNorm` has
      // already parsed this off the description; re-parsing it here would be a second
      // reading of the same prose that could disagree with the first.
      repeatable: (id) => !!courseMap[id]?.repeatable,
    });

    if (out.refused) return { refused: out.refused };
    return { plan: out.plan.plans[0], report: out.report };
  },

  defaultPreferences() { return DEFAULT_PREFERENCES; },
};

export { IPlanGenerator };

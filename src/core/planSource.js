// ═══════════════════════════════════════════════════════════════════
// PLAN SOURCE — which sample plan sources exist, and which one is selected
//
// One function, because the alternative was measured and it was bad. This
// decision used to live as seven interacting flags inside `SamplePlanOffer`:
// `hasSamplePlan`, `canGenerate`, `chartRefused`, `chartAvailable`,
// `chartSettled`, `somethingToShow` and `plansPending`, read by two effects that
// both assigned `source` and by a render that could return null while its own
// hooks kept running. Every bug in that area was a disagreement between two of
// them:
//
//   · the source reset to "catalog" unconditionally, so a program with no
//     catalog plan for its edition selected a DISABLED tab and the body showed
//     "loading…" for ever — nothing would ever resolve it;
//   · "loading" was claimed whenever no plan was in hand, including when no
//     fetch had been started;
//   · and the expensive one: generation was gated on the source alone, not on
//     whether the section was DISPLAYED, so a double major — for which the
//     section is deliberately hidden — ran a full CHART search anyway. Measured
//     on the 2027 edition: an 85.7-second main-thread freeze on page load.
//
// None of those were visible to any Node test, because all of them lived in a
// component body. That is the same lesson `editionChoice.js` records, and this
// is the same remedy: the decision is a pure function of six inputs, so it can
// be attacked directly and the component is left to draw the answer.
//
// ── The rule ───────────────────────────────────────────────────────
//
// Two sources, each independently available or not:
//
//   catalog  the department's published Sample Plan of Study, for THIS
//            program at THIS catalog year. Absent for a whole edition since
//            Northeastern moved the plans onto the colleges' own websites.
//   chart    generated. Available unless the program-level gate refuses
//            (`programRefusal`, which needs no student) or a generation that
//            actually ran came back with a refusal.
//
// A source that is unavailable is drawn GREY with a reason, never hidden — the
// reason is the useful part, and a control that silently disappears leaves the
// student wondering what they missed. When BOTH are unavailable there is nothing
// to choose between and nothing to show, and the section does not render.
//
// The selected source is always an AVAILABLE one. That is the invariant the
// original code could not hold, and it is one line here.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SourceState
 * @property {boolean} enabled  may be selected
 * @property {string|null} why  why not, when not enabled
 */

/**
 * @param {object} args
 * @param {boolean} args.hasCatalogPlan   a plan.json exists for this program AT THIS EDITION
 * @param {boolean} args.chartEligible    the program-level gate passes (`canGenerate`)
 * @param {object|null} [args.refusal]    a refusal from a generation that RAN
 * @param {string|null} [args.refusalText] that refusal, as a sentence for the student
 * @param {string} [args.chosen]          the source the student last chose
 * @param {boolean} [args.sectionHidden]  the caller hides the section for its own
 *                                        reasons (a double major), so nothing here
 *                                        may cause work to start
 * @returns {{show: boolean, source: string|null,
 *            catalog: SourceState, chart: SourceState,
 *            mayGenerate: boolean}}
 */
export function planSourceState({
  hasCatalogPlan = false,
  chartEligible = false,
  refusal = null,
  refusalText = null,
  chosen = "catalog",
  sectionHidden = false,
} = {}) {
  const chartEnabled = Boolean(chartEligible) && !refusal;

  const catalog = {
    enabled: Boolean(hasCatalogPlan),
    why: hasCatalogPlan ? null : "no-catalog-plan",
  };
  const chart = {
    enabled: chartEnabled,
    // A refusal that HAPPENED outranks the generic "not enough requirement
    // data": that sentence is about a program never worth trying, which is a
    // different fact and, when a real refusal exists, a wrong one.
    why: chartEnabled ? null : (refusal ? (refusalText ?? "refused") : "not-eligible"),
  };

  const show = !sectionHidden && (catalog.enabled || chart.enabled);

  // Never sit on a source that is not there. Preference order is the student's
  // choice first, then catalog, then chart — the catalog plan is the
  // department's own and outranks ours whenever both exist.
  let source = null;
  if (show) {
    if (chosen === "catalog" && catalog.enabled) source = "catalog";
    else if (chosen === "chart" && chart.enabled) source = "chart";
    else source = catalog.enabled ? "catalog" : "chart";
  }

  // The one output that starts work, and it is deliberately the narrowest.
  // Generation may begin ONLY for a section that is on screen with CHART
  // actually selected — the hidden-section case is the 85.7-second freeze.
  const mayGenerate = show && source === "chart" && Boolean(chartEligible) && !refusal;

  return { show, source, catalog, chart, mayGenerate };
}

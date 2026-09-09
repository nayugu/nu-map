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
 * @param {boolean} [args.chartHasPlan]   a generation has produced a usable plan.
 *                                        Not "has finished": a refusal finishes too,
 *                                        and finishing is not a reason to render.
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
  chartHasPlan = false,
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

  // CHART is the only source that has to be COMPUTED, so it is the only one that
  // can be "not yet".
  const chartPending = chart.enabled && !chartHasPlan;

  // ── Render as soon as SOME plan is known to exist ─────────────────
  //
  // Stated positively on purpose. The rule is not "wait until CHART finishes" —
  // finishing includes refusing, and a refusal is not a reason to render
  // anything. It is: a plan is on file, or a plan has been produced.
  //
  // With a catalog plan that is true immediately and the section appears at once,
  // whatever CHART is doing. With none — every program on the current edition,
  // since Northeastern moved Sample Plans of Study to the colleges' own websites
  // — the section waits, because whether CHART has a plan is not knowable without
  // generating one. The program-level refusals are already gone (`chartEligible`
  // asks the engine's own gate), so what is left depends on this student's terms
  // and credit cap, and `verify-chart --edition 2027` still refuses for roughly a
  // fifth of a stratified sample.
  //
  // Appearing, sitting busy and then vanishing is worse than never appearing: it
  // draws the eye to something that turns out not to be there, on a control the
  // student did not touch. Waiting costs nothing visible — there was nothing to
  // look at either way.
  const show = !sectionHidden && (catalog.enabled || chartHasPlan);

  // Never sit on a source that is not there. Preference order is the student's
  // choice first, then catalog, then chart — the catalog plan is the
  // department's own and outranks ours whenever both exist.
  let source = null;
  if (show) {
    if (chosen === "catalog" && catalog.enabled) source = "catalog";
    else if (chosen === "chart" && chart.enabled) source = "chart";
    else source = catalog.enabled ? "catalog" : "chart";
  }

  // ── Work starts BEFORE the section exists, deliberately ───────────
  //
  // This cannot be gated on `show`, and that is not an oversight: `show` waits
  // for the generation that `mayGenerate` starts, so gating one on the other is a
  // deadlock — the section would wait for ever for work that never began. It was
  // written that way once and the panel simply never appeared.
  //
  // What it IS gated on is `sectionHidden`, and that is the guard that matters:
  // a section the caller has hidden for its own reasons (a double major) must
  // never start a search. That case ran a full CHART search for a panel nobody
  // could see and froze the main thread for 85.7 seconds.
  //
  // Otherwise it begins as soon as CHART is the source the student would land on
  // — immediately when there is no catalog plan, and on their click when there
  // is. A refusal stops it: a source that already answered is not asked again.
  const wouldUseChart = chosen === "chart" || !catalog.enabled;
  const mayGenerate = !sectionHidden && chart.enabled && wouldUseChart;

  return { show, source, catalog, chart, mayGenerate, chartPending };
}

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
import { generatePlan, DEFAULT_PREFERENCES, createTrace } from "../../engine/index.js";
import { buildDepthIndex } from "../../engine/prereqDepth.js";
import { programIdentity } from "../../core/programIdentity.js";
import { parseMajorPathParts } from "../../data/programPaths.js";
import enginePorts from "./enginePorts.js";
import chartCalibration from "./chartCalibration.js";

/** Where the recovered order lives. Same origin as the rest of the catalog data. */
const PLAN_ORDER_URL = "/northeastern/plan-order.json";
/** First semesters borrowed from similar programs, for the 412 that publish no plan. */
const EARLY_DONORS_URL = "/northeastern/early-donors.json";

let _depthFor = null;      // { courseMap, index }
let _orderPromise = null;
let _donorPromise = null;

function depthIndexFor(courseMap) {
  if (_depthFor?.courseMap === courseMap) return _depthFor.index;
  _depthFor = { courseMap, index: buildDepthIndex(courseMap) };
  return _depthFor.index;
}

/**
 * Prerequisites the catalog does not record but its own published plans agree on.
 *
 * ── Why this one is NOT gated on the catalog edition ───────────────
 *
 * `early-donors.json` is, and the difference is the rule rather than a
 * judgement call about how much staleness to tolerate. This repo already draws
 * the line: program requirements are edition-partitioned and the course catalog
 * is NOT. A donor is a PROGRAM-level document — one edition's courses, credit
 * totals and sections — so lending it across a roll answers a different
 * question. What this file holds is COURSE-level: 224 edges saying MATH 1341
 * precedes MATH 1342, which courses precede a co-op, and where departments
 * typically put a course. Those are facts about courses, and courses are one
 * current snapshot with no edition to disagree with.
 *
 * It is also used as a floor and a prior, never as a target (see
 * `reclaimFromFiller`), so a stale observation delays a course rather than
 * requiring a wrong one.
 *
 * Worth knowing, because it cannot be refreshed: the artifact is derived from
 * published Sample Plans of Study, and NEU deleted those catalog-wide for
 * 2026-2027. These 2026 observations are the last that will ever be made unless
 * the departments' own plans become machine-readable.
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
      .then(d => ({ edges: d?.edges ?? [], coopPrep: (d?.coopPrep ?? []).map(x => x.course),
                    positions: d?.positions ?? null }))
      .catch(() => ({ edges: [], coopPrep: [], positions: null }));
  }
  return _orderPromise;
}

/**
 * A borrowed first four semesters, for a program whose department publishes none.
 *
 * Keyed by `programIdentity`, because neither a program's name nor its catalog url is
 * unique on its own. Degrades to nothing on failure, which is the behaviour before
 * donors existed and is always a legal answer.
 *
 * The `edition` travels with it because `programIdentity` is `name @ sourceUrl` and
 * carries NO year — see `donorFor`.
 */
function earlyDonors() {
  if (!_donorPromise) {
    _donorPromise = fetch(EARLY_DONORS_URL)
      .then(r => (r.ok ? r.json() : null))
      .then(d => ({ programs: d?.programs ?? {}, edition: Number(d?.edition) }))
      .catch(() => ({ programs: {}, edition: NaN }));
  }
  return _donorPromise;
}

/**
 * The donor plan for a program, but ONLY from that program's own catalog edition.
 *
 * A donor is a borrowed Sample Plan of Study, so it is a reading of one edition's
 * requirements — which courses, in which credit totals, satisfying which sections.
 * `programIdentity` cannot see that: it is `name @ sourceUrl`, both of which are
 * stable across a roll (measured: 506 of 651 undergraduate identities are shared
 * between the 2026 and 2027 trees). So a 2027 program looked up a donor derived
 * from 2026 plans and was handed one, silently, by a key that could not tell the
 * editions apart. Measured on the live artifact: 4 of the 651 undergraduate 2027
 * programs.
 *
 * That is small, and it is the same defect as serving a 2026 sample plan on a 2027
 * program — one layer down, where nothing on screen says the plan was borrowed at
 * all, let alone from another year. Refusing costs those 4 programs a borrowed
 * ordering and leaves them to the search, which is what every program without a
 * donor already gets. Degrade to less information, never to wrong information.
 *
 * An artifact with no `edition` lends to nobody: absent is not a match.
 */
function donorFor(donors, programKey, programData) {
  const want = parseMajorPathParts(String(programKey ?? ""))?.year;
  if (!Number.isFinite(want) || donors.edition !== want) return null;
  return donors.programs[programIdentity(programData)]?.plan ?? null;
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
    studentType, preferences, courseMap, concentration = null,
    // ── Recording the search, for the explainer's second page ────────
    //
    // On by default in the browser and off for every other caller, which is the right way
    // round: the Node MCP server and the Cloudflare worker generate plans for a machine to
    // read, and `verify-chart` generates 1,031 of them in the monthly workflow.
    //
    // Measured over the four benchmark shapes, the cost is inside run-to-run noise (−5% to
    // −2% of wall clock across three repeats, with one unreproduced +14% outlier). That
    // matters because the search refuses when its clock runs out, so a slow sink could turn
    // a plan into a refusal — which is why `chart-probe --trace` compares the emitted
    // documents rather than trusting the argument.
    trace: wantTrace = true,
  }) {
    if (!courseMap) {
      return { refused: { reason: "no-catalog", detail: "The course catalog has not loaded yet." } };
    }
    const order = await observedOrder();
    // Only consulted when the department publishes nothing — its own plan always wins,
    // and fetching donors for a program that has one is work whose result is discarded.
    const donorPlan = publishedPlan
      ? null
      : donorFor(await earlyDonors(), programKey, programData);
    // Graduate PROGRAMS and graduate STUDENTS are the same thing here, and the
    // distinction matters: it sets the credit envelope (8–16 rather than 12–19) and
    // removes the class-standing floor, because a student admitted to a master's
    // takes 5000-level courses in their first term.
    const type = studentType ?? (isGrad ? "graduate" : "undergraduate");

    const sink = wantTrace ? createTrace() : null;
    const out = generatePlan({
      trace: sink,
      program: programData,
      publishedPlan,
      donorPlan,
      courseMap,
      ports: enginePorts(courseMap),
      depthIndex: depthIndexFor(courseMap),
      observedOrder: order.edges,
      coopPrep: order.coopPrep,
      // Where departments put each course — a floor on how early a requirement may be
      // reclaimed, never a target. See `reclaimFromFiller`.
      positions: order.positions,
      studentType: type,
      // Resolved by title inside the engine, through `concentrationResolve` — the title is a
      // concentration's only identity across saved plans, share links and MCP, and a stale one
      // must degrade to the union rather than match the wrong option.
      concentration,
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

    // ── The recording travels BESIDE the plan, never inside it ───────
    //
    // Not in `report`, and not in the plan document. Both of those are persisted, shared by
    // link and diffed by the monthly workflow, and a saturated program's recording is ~24,000
    // node rows — a search log welded to an artifact that outlives the search. It rides on the
    // generate RESULT, which the panel reads and nothing stores.
    //
    // Carried on a refusal too, and that is the case where it matters most: a refused degree
    // has no plan to read instead, so the process is the only account of what happened.
    const derivation = sink ? sink.snapshot() : null;
    if (out.refused) return { refused: out.refused, derivation };
    return { plan: out.plan.plans[0], report: out.report, derivation };
  },

  defaultPreferences() { return DEFAULT_PREFERENCES; },
};

export { IPlanGenerator };

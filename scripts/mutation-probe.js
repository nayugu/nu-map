#!/usr/bin/env node
/**
 * mutation-probe.js — does a test actually FAIL when the code is broken?
 *
 * ── Why this is committed ───────────────────────────────────────────
 *
 * CLAUDE.md says tests that confirm are close to worthless here and the ones
 * that pay are hostile. Nothing in the repo could tell the difference, so
 * "hostile" was a claim about intent rather than a measured property. This
 * measures it: break the code on purpose, run the tests, and see whether they
 * notice. A mutant nothing kills is a hole in the suite.
 *
 * It earned its place on the free-elective work, where it found more than the
 * review did:
 *
 *   · four guards in `proseSectionSH` were each deletable with no test failing,
 *     because the tests used figures the plausibility ceiling caught first —
 *     they asserted the right outcomes for the wrong reason;
 *   · `minOptions`' "Electives Option" correction had no test at all;
 *   · and chasing one stubborn survivor turned up a REAL BUG: the total guard
 *     matched one phrasing of a degree total where `parseTotalCredits`
 *     recognises seven, so "A total of 42 semester hours are required" and the
 *     doctoral "a minimum of 28 … beyond the graduate degree" became phantom
 *     42 SH and 28 SH requirement sections on the smallest degrees in the
 *     catalog.
 *
 * ── Reading the output ──────────────────────────────────────────────
 *
 *   KILLED    a test failed. The guard is real and covered.
 *   SURVIVED  nothing failed. Either the suite has a hole, or the mutant is
 *             EQUIVALENT — it changes code without changing behaviour, and no
 *             test can kill it. Decide which; do not assume the first.
 *   SKIP      the anchor text is gone, so the mutant never applied. This is the
 *             failure mode that quietly turns the whole run green: a refactor
 *             moves a line and the mutant silently stops testing anything.
 *
 * ⚠ Mutants are applied to the WORKING TREE and reverted with `git checkout --`,
 * so uncommitted edits to a mutated file are destroyed, and a run against
 * uncommitted work measures HEAD instead of what you wrote. Both happened while
 * building this. It refuses to run on a dirty target file for that reason.
 *
 *   node scripts/mutation-probe.js                 # every mutant
 *   node scripts/mutation-probe.js --only credit   # names matching a substring
 *   node scripts/mutation-probe.js --list
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const DEMAND = "src/core/requirementDemand.js";
const PARSER = "scripts/lib/catalog-program-parser.js";
const RECORD = "scripts/lib/program-record.js";
const OVERLAP = "src/core/minorOverlap.js";
const MODEL   = "src/core/planModel.js";
const COURSE  = "src/core/courseModel.js";
const DESCCOREQ = "src/adapters/northeastern/descriptionCoreq.js";
const RETAIN  = "scripts/lib/course-retention.js";
const SCRAPER = "scripts/scrape-catalog.js";
const RETUNION = "scripts/derive-retired-union.js";
const PREREQ   = "scripts/lib/prereq-parse.js";
const BANK     = "src/ui/BankPanel.jsx";
const BANKRANK = "src/core/bankRank.js";
const PATHS    = "src/data/programPaths.js";
const GRADPANEL = "src/ui/GradPanel.jsx";
const CHOICE    = "src/core/editionChoice.js";
const LOADER    = "src/data/majorLoader.js";
const PLANNER   = "src/context/PlannerContext.jsx";

const INVARIANT  = "cd test/invariant && node --test requirement-credit-corpus.test.js";
const PROSE      = "cd test/contract  && node --test catalog-prose-sections.test.js";
const MAJORPARSE = "cd test/contract  && node --test major-parser.test.js";
const SUBTOTAL   = "cd test/contract  && node --test catalog-major-subtotal.test.js";
const UNITDEMAND = "cd test/unit      && node --test engine-demand.test.js engine-stated-cells.test.js";
const MINOR      = "cd test/unit      && node --test minor-overlap.test.js";
const UNLOCKS      = "cd test/unit      && node --test unlocked-courses.test.js";
const DESCOREQ_TEST = "cd test/unit      && node --test description-coreq.test.js";
const RETAIN_TEST   = "cd test/unit      && node --test course-retention.test.js";
const RETUNION_TEST = "cd test/unit      && node --test retired-union.test.js";
const PREREQ_TEST   = "cd test/unit      && node --test prereq-parse.test.js";
// A BROWSER command, because the ranking it guards is a React useMemo and
// nothing in Node evaluates a component body. Slow (it rebuilds), so these
// mutants are worth running with --only rather than in every sweep.
const RETIRED_UI    = "cd test/browser   && node --test retired-course.browser.test.js";
const BANKRANK_TEST = "cd test/unit      && node --test bank-rank.test.js";
const COHORT_TEST   = "cd test/unit      && node --test cohort-version.test.js";
const CHOICE_TEST   = "cd test/unit      && node --test edition-choice.test.js";
const PERSIST_TEST  = "cd test/invariant && node --test plan-persistence.test.js";
const RELOAD_UI     = "cd test/browser   && node --test plan-reload.browser.test.js";
// Also a BROWSER command, for the same reason as RETIRED_UI: the blank program
// box was a render-time defect that every Node test passed straight through.
const EDITION_UI    = "cd test/browser   && node --test catalog-edition.browser.test.js";

// The sample plan's edition tie. The RULE is pure and cheap to check; the two
// facts that need a render (a disabled source being selected, a "loading" that
// never resolves) are the browser file's only job.
const PLANKEY_TEST  = "cd test/unit      && node --test plan-key.test.js";
const SAMPLEPLAN_UI = "cd test/browser   && node --test sample-plan-edition.browser.test.js";
const OFFER     = "src/ui/SamplePlanOffer.jsx";
const GENERATOR = "src/adapters/northeastern/planGenerator.js";

// The source decision, and CHART running where the UI is not.
const PLANSRC_TEST = "cd test/unit      && node --test plan-source.test.js";
const WORKER_UI    = "cd test/browser   && node --test chart-worker.browser.test.js";
const PLANSRC   = "src/core/planSource.js";
const ENGINE    = "src/engine/index.js";

// The free-elective allowance. The RULE is pure; the CONSEQUENCE needs the
// corpus (does any shipped program print a figure it cannot support) and the
// rendered row needs a browser, because `GradPanel` carries its own copy of the
// section renderer and does not import planModel's.
const BINDING     = "src/core/requirementBinding.js";
const GRADREQ     = "src/core/gradRequirements.js";
const GE_TEST     = "cd test/unit      && node --test general-electives.test.js";

// A catalog page that is not a program. The rule is pure and the tests are hand-built
// records, so this is cheap to probe — which matters, because the tempting simplifications
// here each DELETE a real degree rather than merely admitting noise.
const NONPROG      = "scripts/lib/non-program-pages.js";
const RAILS        = "scripts/lib/scrape-rails.js";
const NONPROG_TEST = "cd test/unit      && node --test non-program-pages.test.js";
const RAILS_TEST   = "cd test/unit      && node --test scrape-rails.test.js";

// A program that got RENAMED across an edition roll — the identity a slug cannot keep.
// Probed with the corpus guard beside the unit test, because the tempting weakening of
// `isProgramPage` is one that makes the corpus assertion pass vacuously.
const WITNESS      = "scripts/lib/witness-carry.js";
const WITNESS_TEST = "cd test/unit      && node --test witness-carry.test.js";
const PROGRAMS_ARE_PROGRAMS = "cd test/invariant && node --test programs-are-programs.test.js";
const VERIFY_MAJORS = "scripts/verify-majors.js";
const RATCHET_TEST  = "cd test/unit      && node --test major-verify-ratchet.test.js";
const GE_CORPUS   = "cd test/invariant && node --test general-elective-allowance.test.js";
const GE_UI       = "cd test/browser   && node --test general-electives.browser.test.js";

/**
 * Each mutant is a plausible REGRESSION, not random noise: an inverted
 * tie-break, a deleted guard, a fallback restored. `from` must be unique in the
 * file — the runner checks — so a mutant cannot silently apply somewhere else.
 */
const MUTANTS = [
  // ── The unload save must not hold one render's state ─────────────
  // The real bug, restored: an inline handler inside an effect with no
  // dependencies, so it fires forever with the first render's plan and
  // overwrites the slot on the way out. Fifteen fields were losable this way.
  { name: "persist: the unload handler goes back to closing over state",
    file: PLANNER,
    from: "    const h = () => unloadSaveRef.current?.();",
    to:   "    const h = () => { saveState(storagePrefix, persistEnabled, { placements, reservations, specialTermPl, currentSemId, collapsedSubs, semOrders, offeredOverrides, shOverrides, bonusSH, placedOut: [...placedOut], substitutions, grades: gradesRaw, appliedTemplate, planId: activePlanId }); saveCurrentPlanToSlot(); };",
    run: [PERSIST_TEST, RELOAD_UI] },

  // The subtler version: the ref exists and is wired, but only ever points at
  // the FIRST render's save. Identical symptom, and the shape check alone
  // cannot see it — which is why the browser test exists.
  { name: "persist: the unload ref is pointed once instead of every render",
    file: PLANNER,
    from: "    unloadSaveRef.current = () => {",
    to:   "    if (!unloadSaveRef.current) unloadSaveRef.current = () => {",
    run: [RELOAD_UI] },

  // ── The catalog edition a cohort is offered ─────────────────────
  // The historic bug, restored verbatim: "newest" instead of "the cohort's".
  // It fired for 338 of 498 undergraduate majors for every cohort the app had.
  { name: "edition: the prompt goes back to offering the NEWEST edition",
    file: PATHS,
    from: "  const want = pickCatalogYear(siblings.map(e => e.year), cohortYear);",
    to:   "  const want = Math.max(...siblings.map(e => e.year));",
    run: [COHORT_TEST, EDITION_UI] },

  { name: "edition: a plan with no entry term is prompted anyway",
    file: PATHS,
    from: "  if (!Number.isFinite(cohortYear)) return null;\n",
    to:   "", run: [COHORT_TEST] },

  { name: "edition: the already-on-it bail is dropped (a prompt that never clears)",
    file: PATHS,
    from: "  if (want == null || want === current.year) return null;",
    to:   "  if (want == null) return null;",
    run: [COHORT_TEST, EDITION_UI] },

  { name: "edition: the sibling match goes folder-blind (offers a different degree)",
    file: PATHS,
    from: "    .filter(e => e.pp && e.pp.college === current.college && e.pp.folder === current.folder)\n    .map(e => ({ year: e.pp.year, path: e.p }))",
    to:   "    .filter(e => e.pp && e.pp.college === current.college)\n    .map(e => ({ year: e.pp.year, path: e.p }))",
    run: [COHORT_TEST] },

  // The render half. `findCohortVersion` can be perfectly correct and the box
  // still empties, because the display resolves through the FILTERED list —
  // which is what actually happened.
  { name: "edition: the program box resolves its name from the filtered list only",
    file: GRADPANEL,
    from: "    ? (allOptions.find(o => o.path === value) ?? (valueOption?.path === value ? valueOption : null))",
    to:   "    ? (allOptions.find(o => o.path === value) ?? null)",
    run: [EDITION_UI] },

  // `valueOption` is passed per call site, so the shared rule above can be
  // perfect while one combo is simply not wired. Cases A-C all pass with this
  // prop deleted; only the minor case sees it.
  // Caught from a SCREENSHOT, not a test: every other case here uses an exact
  // current-year path, so all of them matched in `allOptions` and none could
  // see it. A plan on an edition we no longer hold canonicalises to a different
  // path, the identity check fails, and every program box renders empty.
  { name: "edition: describeProgram answers with the canonical path, not the caller's",
    file: LOADER,
    from: "  return { ...option, path };",
    to:   "  return option;",
    run: [EDITION_UI] },

  { name: "edition: the minor combo stops being told what it has selected",
    file: GRADPANEL,
    from: " valueOption={describeProgram?.(val) ?? null}",
    to:   "", run: [EDITION_UI] },

  { name: "edition: the second major loses its year selector",
    file: GRADPANEL,
    from: "                  <EditionRow path={major2Path} cohortYear={cohortYear} onChange={setMajor2Path} />\n",
    to:   "", run: [EDITION_UI] },

  // The slip a shared component invites: right row, wrong setter. It still
  // renders and still changes an edition — the FIRST major's. Invisible to any
  // assertion keyed on the year rather than on which program moved.
  { name: "edition: the second major's selector moves the first major",
    file: GRADPANEL,
    from: "<EditionRow path={major2Path} cohortYear={cohortYear} onChange={setMajor2Path} />",
    to:   "<EditionRow path={major2Path} cohortYear={cohortYear} onChange={setSelPath} />",
    run: [EDITION_UI] },

  { name: "edition: minors lose their year selector",
    file: GRADPANEL,
    from: "                    <EditionRow path={val} cohortYear={cohortYear} onChange={set} />\n",
    to:   "", run: [EDITION_UI] },

  // ── The rules, now that they are not inside a component ──────────
  // These two used to be mutated in GradPanel.jsx and measured by the browser
  // suite, at a 13s rebuild plus a page boot EACH. They are decisions about a
  // small object, and they moved to core/editionChoice.js for exactly that
  // reason: 0.11s instead of minutes, and the same assertions.
  //
  // A single-option dropdown implies a choice the student does not have, and
  // would appear on 180 undergraduate and all 524 graduate programs.
  { name: "edition: the row renders for a program held in ONE edition",
    file: CHOICE,
    from: "  if (options.length < 2) return null;",
    to:   "  if (options.length < 1) return null;",
    run: [CHOICE_TEST] },

  // The hint must be silent for a correctly pinned student — the 338-of-498
  // regression, in its new form.
  { name: "edition: the cohort hint shows even when the plan is on its own edition",
    file: CHOICE,
    from: "    hint:    off ? (cohortLabel || null) : null,",
    to:   "    hint:    cohortLabel || null,",
    run: [CHOICE_TEST] },

  // The hint and the reset must name the SAME edition. Split sources would let
  // the control recommend one year and hand over another.
  { name: "edition: the reset ignores the cohort and goes to the newest edition",
    file: CHOICE,
    from: "    resetTo: off ? cohortPath : null,",
    to:   "    resetTo: off ? options[options.length - 1].path : null,",
    run: [CHOICE_TEST] },

  { name: "edition: a missing year renders as '-1-0' rather than as nothing",
    file: PATHS,
    from: "  return Number.isInteger(y) && y > 1000 ? `${y - 1}-${y}` : \"\";",
    to:   "  return Number.isFinite(y) ? `${y - 1}-${y}` : \"\";",
    run: [COHORT_TEST] },

  // ── The source decision, and CHART off the main thread ────────────
  { name: "chart: a hidden section generates anyway (the 85.7s freeze)",
    file: PLANSRC,
    from: "  const mayGenerate = !sectionHidden && chart.enabled && wouldUseChart;",
    to:   "  const mayGenerate = chart.enabled && wouldUseChart;",
    run: [PLANSRC_TEST] },

  { name: "chart: the section renders before CHART has answered (flash and vanish)",
    file: PLANSRC,
    from: "  const show = !sectionHidden && (catalog.enabled || chartHasPlan);",
    to:   "  const show = !sectionHidden && (catalog.enabled || chart.enabled);",
    run: [PLANSRC_TEST] },

  { name: "chart: a catalog plan is made to wait on CHART too",
    file: PLANSRC,
    from: "  const show = !sectionHidden && (catalog.enabled || chartHasPlan);",
    to:   "  const show = !sectionHidden && chartHasPlan;",
    run: [PLANSRC_TEST] },

  { name: "chart: 'has a plan' degrades to 'finished without refusing'",
    file: OFFER,
    from: "    chartHasPlan: !!gen && !gen.refused && !gen.cancelled && !!gen.plan,",
    to:   "    chartHasPlan: !!gen && !gen.refused,",
    run: [PLANSRC_TEST, WORKER_UI],
    // `gen` is null at the start of every program change, so dropping `!genBusy`
    // only differs during the window where a generation is running and `gen` is
    // stale-null — which the reset effect closes in the same commit. Marked, not
    // dropped: a KILL here means a test finally covers that window.
    equivalent: true },

  { name: "chart: a disabled source can be selected",
    file: PLANSRC,
    from: "    else source = catalog.enabled ? \"catalog\" : \"chart\";",
    to:   "    else source = \"catalog\";",
    run: [PLANSRC_TEST, SAMPLEPLAN_UI] },

  { name: "chart: a refusal no longer greys its tab",
    file: PLANSRC,
    from: "  const chartEnabled = Boolean(chartEligible) && !refusal;",
    to:   "  const chartEnabled = Boolean(chartEligible);",
    run: [PLANSRC_TEST] },

  // ⚠ Re-anchored after `show` stopped asking whether CHART could still be
  // running and started asking whether it HAS a plan. It reported SKIP for one
  // run, which is exactly the failure this probe exits non-zero for: the mutant
  // applied nowhere and the sweep would have gone on looking green.
  { name: "chart: the section renders with neither source available",
    file: PLANSRC,
    from: "  const show = !sectionHidden && (catalog.enabled || chartHasPlan);",
    to:   "  const show = !sectionHidden;",
    run: [PLANSRC_TEST] },

  { name: "chart: the retry ladder gets a fresh clock again (87s)",
    file: ENGINE,
    from: "      if (outOfTime()) break;",
    to:   "      if (false) break;",
    run: [WORKER_UI],
    // The ladder only runs when the FIRST attempt refuses, and the browser case
    // that exercises it is bounded by the worker timeout rather than by this —
    // which is the point of having two clocks. Marked rather than dropped: a KILL
    // here means a test finally covers the unbounded ladder directly.
    equivalent: true },

  { name: "chart: the search runs on the main thread again",
    file: GENERATOR,
    from: "    if (WORKER_OK) {",
    to:   "    if (false) {",
    run: [WORKER_UI] },

  { name: "chart: switching subject no longer cancels the running search",
    file: OFFER,
    from: "    return () => { live = false; cancelIdle(); planGenerator.cancel?.(); };",
    to:   "    return () => { live = false; cancelIdle(); };",
    run: [WORKER_UI] },

  { name: "chart: a cancelled answer is shown for the program that replaced it",
    file: OFFER,
    from: "      .then(r => { if (live && !r?.cancelled) setGen(r); })",
    to:   "      .then(r => { if (live) setGen(r); })",
    run: [WORKER_UI] },

  // ── The sample plan's edition tie ─────────────────────────────────
  { name: "sample plan: the plan is migrated across editions, as it used to be",
    file: PATHS,
    from: "  const canonical = resolveInMap(programMap, p, parseMajorPathParts) ?? p;\n" +
          "  const wanted = String(canonical).replace(/requirements\\.json$/, \"plan.json\");\n" +
          "  return planMap[wanted] ? wanted : null;",
    to:   "  const canonical = resolveInMap(programMap, p, parseMajorPathParts) ?? p;\n" +
          "  const wanted = String(canonical).replace(/requirements\\.json$/, \"plan.json\");\n" +
          "  return planMap[wanted] ? wanted : resolveInMap(planMap, wanted, parseMajorPathParts);",
    run: [PLANKEY_TEST, SAMPLEPLAN_UI] },

  { name: "sample plan: the plan stops following its requirements (no canonicalize)",
    file: PATHS,
    from: "  const canonical = resolveInMap(programMap, p, parseMajorPathParts) ?? p;",
    to:   "  const canonical = p;",
    run: [PLANKEY_TEST] },

  { name: "sample plan: a program object instead of a path throws instead of answering",
    file: PATHS,
    from: "  const p = typeof path === \"string\" ? path : \"\";",
    to:   "  const p = path;",
    run: [PLANKEY_TEST] },

  { name: "sample plan: the source resets onto the catalog even when there is none",
    file: OFFER,
    from: "    setSource(hasSamplePlan ? \"catalog\" : \"chart\");",
    to:   "    setSource(\"catalog\");",
    run: [SAMPLEPLAN_UI] },

  { name: "sample plan: 'loading' is claimed for a fetch that was never started",
    file: OFFER,
    from: "  const plansPending = hasSamplePlan && plans === null;",
    to:   "  const plansPending = plans === null;",
    run: [SAMPLEPLAN_UI],
    // SURVIVED on first run, and it is equivalent — checked rather than
    // assumed, because the tempting reading was "the browser case is too weak".
    //
    // `plansPending` is only ever read on the branch where the source is NOT
    // chart, and the source default beside it guarantees catalog is selected
    // only when a plan exists. So with that fix in place there is no state a
    // user can reach where the two guards disagree: the one frame between mount
    // (source initialises to "catalog") and the reset effect is the entire
    // difference, and a frame is not a render a test can hold still.
    //
    // Kept rather than deleted as redundant, and this is the judgement: the two
    // guards state different things. One says "do not select a source that is
    // not there", the other says "do not claim to be loading something you
    // never asked for". The second is what makes the first's failure visible
    // instead of silent, which is the whole shape of the bug this pair fixes.
    // A KILL here later means the source default has been loosened.
    equivalent: true },

  { name: "sample plan: a donor is lent across catalog editions",
    file: GENERATOR,
    from: "  if (!Number.isFinite(want) || donors.edition !== want) return null;",
    to:   "  if (!Number.isFinite(want)) return null;",
    run: [SAMPLEPLAN_UI],
    // Not expected to be observable from the panel: CS BSCS publishes a plan in
    // 2026 and is not one of the 47 programs with a donor, so no rendered case
    // reaches this branch. Kept as a marked mutant rather than dropped — a
    // future KILL here means a test finally covers the donor path, which is
    // itself the signal.
    equivalent: true },

  { name: "edition: the label names the directory year, not the academic year",
    file: PATHS,
    from: "  return Number.isInteger(y) && y > 1000 ? `${y - 1}-${y}` : \"\";",
    to:   "  return Number.isInteger(y) && y > 1000 ? `${y}-${y + 1}` : \"\";",
    run: [COHORT_TEST, EDITION_UI] },

  { name: "edition: the selector offers every edition held, not this program's",
    file: PATHS,
    from: "    .filter(e => e.pp && e.pp.college === current.college && e.pp.folder === current.folder)\n    .map(e => ({ year: e.pp.year, path: e.p }))",
    to:   "    .filter(e => e.pp)\n    .map(e => ({ year: e.pp.year, path: e.p }))",
    run: [COHORT_TEST] },

  // ── A retired course ranks below its live twin, and stays findable ──
  // The rung-order mutants run the fast UNIT suite; only the two that are
  // genuinely about rendering pay for a browser rebuild. That split is not
  // tidiness — the second mutant below SURVIVED the whole browser suite when
  // the comparator was inline in BankPanel.jsx, because the natural browser
  // test for it ("type the retired course's code, it comes first") matches
  // exactly one course and so cannot observe an ordering at all. Moving the
  // comparator into core/bankRank.js is what made it killable.
  { name: "retired: the search tie-break ignores retirement (the 292/389 regression)",
    file: BANKRANK,
    from: "    || retiredRank(a.c) - retiredRank(b.c)\n",
    to:   "", run: [BANKRANK_TEST, RETIRED_UI] },

  { name: "retired: demotion outranks relevance (a code query buries its own course)",
    file: BANKRANK,
    from: "    b.score - a.score\n    || retiredRank(a.c) - retiredRank(b.c)\n",
    to:   "    retiredRank(a.c) - retiredRank(b.c)\n    || b.score - a.score\n",
    run: [BANKRANK_TEST] },

  { name: "retired: the rung's sign is flipped, promoting every retired course",
    file: BANKRANK,
    from: "export const retiredRank = (course) => (course?.retired ? 1 : 0);",
    to:   "export const retiredRank = (course) => (course?.retired ? 0 : 1);",
    run: [BANKRANK_TEST] },

  { name: "retired: an absent `retired` field stops meaning live",
    file: BANKRANK,
    from: "export const retiredRank = (course) => (course?.retired ? 1 : 0);",
    to:   "export const retiredRank = (course) => (course.retired ? 1 : 0);",
    run: [BANKRANK_TEST] },

  { name: "retired: demotion becomes a FILTER (courses students took vanish)",
    file: BANK,
    from: "    list = list.filter(c => !c.coop);",
    to:   "    list = list.filter(c => !c.coop && !c.retired);", run: [RETIRED_UI] },

  // ── A section's credit is read, not estimated ───────────────────
  { name: "credit: OR takes the MAX branch, not the min", file: DEMAND,
    from: "const req = Math.min(...kids.map(k => k.req));",
    to:   "const req = Math.max(...kids.map(k => k.req));", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: OR satisfaction is UNCAPPED (branches sum)", file: DEMAND,
    from: "return { req, sat: Math.min(req, Math.max(...kids.map(k => k.sat))) };",
    to:   "return { req, sat: kids.reduce((n, k) => n + k.sat, 0) };", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: COURSE ignores its real credits (back to the modal unit)", file: DEMAND,
    from: "const req = sh(node.key) ?? unit;",
    to:   "const req = unit;", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: AND counts as ONE entry, not the sum of its courses", file: DEMAND,
    from: "return { req: parts.reduce((n, k) => n + k.req, 0),\n             sat: parts.reduce((n, k) => n + k.sat, 0) };",
    to:   "return { req: unit, sat: allocSection?.sat ? unit : 0 };", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: XOM ignores the registrar's threshold", file: DEMAND,
    from: "return { req: node.reqSh ?? 0, sat: Math.min(node.reqSh ?? 0, node.satSh ?? 0) };",
    to:   "return { req: unit, sat: node?.sat ? unit : 0 };", run: [INVARIANT, UNITDEMAND] },

  { name: "credit: a childless section forgets its stated credit", file: DEMAND,
    from: "const req = allocSection?.statedSH > 0\n      ? allocSection.statedSH\n      : (allocSection?.minRequired ?? allocSection?.total ?? 0) * unit;",
    to:   "const req = (allocSection?.minRequired ?? allocSection?.total ?? 0) * unit;",
    run: [INVARIANT, UNITDEMAND] },

  // KNOWN EQUIVALENT, kept deliberately. `minRequirementCount >= children.length`
  // on every shipped section, so "the N cheapest of N" sums the same set as
  // "all of them". It survives because it cannot be killed, which is exactly
  // what the pick-N tripwire test records — if this ever starts being KILLED,
  // the corpus has gained a pick-N section and that branch now decides credit.
  { name: "credit: every section takes the pick-N path [EQUIVALENT]", file: DEMAND,
    from: "  if (min >= kids.length) {",
    to:   "  if (false) {", run: [INVARIANT, UNITDEMAND], equivalent: true },

  // ── Prose sections, and the restatements they must refuse ───────
  { name: "prose: the major SUBTOTAL is no longer refused", file: PARSER,
    from: "  if (/\\b(?:in|for|toward)\\s+the\\s+major\\b/i.test(text)) return null;",
    to:   "", run: [PROSE] },

  { name: "prose: the degree TOTAL is no longer refused", file: PARSER,
    from: "  if (statedTotalIn(text, profile)) return null;",
    to:   "", run: [PROSE] },

  { name: "prose: the total guard reverts to its own smaller pattern", file: PARSER,
    from: "  if (statedTotalIn(text, profile)) return null;",
    to:   "  if (/\\btotal\\s+(?:semester\\s+hours?|credits?)\\s+required\\b/i.test(text)) return null;",
    run: [PROSE] },

  { name: "prose: a GPA sentence is no longer refused", file: PARSER,
    from: "  if (/\\bGPA\\b/i.test(text)) return null;",
    to:   "", run: [PROSE] },

  { name: "prose: the plausibility ceiling is removed", file: PARSER,
    from: "  return sh > 0 && sh <= 60 ? sh : null;",
    to:   "  return sh > 0 ? sh : null;", run: [PROSE] },

  { name: "prose: sections are dropped instead of emitted", file: PARSER,
    from: "      const sh = proseSectionSH(title, adjacentParas(headingIdx), profile);",
    to:   "      const sh = null && proseSectionSH(title, adjacentParas(headingIdx), profile);",
    run: [PROSE] },

  { name: "prose: the 'Electives Option' minOptions correction is reverted", file: PARSER,
    from: "  if (minOptions === 0 &&\n      concentrationOptions.some(o => /\\belectives?\\s+option\\b/i.test(o.title ?? ''))) {\n    minOptions = 1;\n  }",
    to:   "", run: [PROSE] },

  // ── The major subtotal, as a floor ──────────────────────────────
  { name: "floor: the subtotal is ADDED instead of used as a floor", file: RECORD,
    from: "  const gap = subtotal - demand;\n  if (gap <= 0) return null;",
    to:   "  const gap = subtotal;\n  if (gap <= 0) return null;", run: [SUBTOTAL] },

  { name: "floor: fires even when the parse already meets the subtotal", file: RECORD,
    from: "  if (gap <= 0) return null;",
    to:   "  if (gap < -999) return null;", run: [SUBTOTAL] },

  { name: "floor: guesses with no catalog instead of declining", file: RECORD,
    from: "  if (!subtotal || !courseMap || !Object.keys(courseMap).length) return null;",
    to:   "  if (!subtotal) return null;\n  courseMap = courseMap ?? {};", run: [SUBTOTAL] },

  { name: "floor: the emitted section enumerates a phantom course", file: RECORD,
    from: "    requirements: [],\n    notes: [`The catalog states ${subtotal} semester hours in the major. `",
    to:   "    requirements: [{ type: 'COURSE', subject: 'PHIL', classId: 9999 }],\n    notes: [`The catalog states ${subtotal} semester hours in the major. `",
    run: [SUBTOTAL] },

  { name: "subtotal: the plausibility bound is removed", file: PARSER,
    from: "      if (Number.isFinite(n) && n >= 12 && n <= 90) return n;",
    to:   "      if (Number.isFinite(n)) return n;", run: [SUBTOTAL] },

  // ── The 50% cap on double counting a minor ──────────────────────
  //
  // Four of these SKIPPED the first time they were re-run, because the
  // major-side release moved their anchors — the exact failure this probe exits
  // non-zero on. Re-anchored, and the release has its own mutants below.
  { name: "minor: the cap is a floor, not a ceiling (comparison flipped)", file: OVERLAP,
    from: "  const over = dependentSH - capSH > EPS;",
    to:   "  const over = capSH - dependentSH > EPS;", run: [MINOR] },

  { name: "minor: the cap is the whole requirement, not half of it", file: OVERLAP,
    from: "  const capSH = requiredSH * MINOR_SHARE_FRACTION;",
    to:   "  const capSH = requiredSH;", run: [MINOR] },

  { name: "minor: the verdict reverts to the plain shared sum", file: OVERLAP,
    from: "  const over = dependentSH - capSH > EPS;",
    to:   "  const over = sharedSH - capSH > EPS;", run: [MINOR] },

  { name: "minor: a course the major does not claim is counted as shared", file: OVERLAP,
    from: "  const sharedKeys  = [...claimed].filter(k => major.has(k)).sort();",
    to:   "  const sharedKeys  = [...claimed].sort();", run: [MINOR] },

  { name: "minor: General Electives counts as a minor requirement", file: OVERLAP,
    from: "    section => section && section.title !== \"Required General Electives\"",
    to:   "    section => Boolean(section)", run: [MINOR] },

  { name: "minor: the withheld allocation is skipped (unique credit assumed zero)", file: OVERLAP,
    from: "  let uniqueSH = minorWithout(charged);",
    to:   "  let uniqueSH = 0;", run: [MINOR] },

  // ── Transfer and advanced standing share the same ceiling ───────
  { name: "minor: transfer credit gets its own budget instead of sharing one", file: OVERLAP,
    from: "  const charged = new Set([...major, ...outside]);",
    to:   "  const charged = new Set([...major]);", run: [MINOR] },

  { name: "minor: outside credit is charged even when the major already claims it", file: OVERLAP,
    from: "  const outsideOnly = [...claimed].filter(k => outside.has(k) && !major.has(k)).sort();",
    to:   "  const outsideOnly = [...claimed].filter(k => outside.has(k)).sort();", run: [MINOR] },

  { name: "minor: transfer credit becomes releasable like the major's", file: OVERLAP,
    from: "      const stillCharged = new Set([...charged].filter(\n        k => outside.has(k) || !releasedKeys.includes(k)));",
    to:   "      const stillCharged = new Set([...charged].filter(\n        k => !releasedKeys.includes(k)));", run: [MINOR] },

  { name: "minor: an ordinary grade counts as transferred", file: OVERLAP,
    from: "    if (grade === TRANSFER_GRADE) add(pid);",
    to:   "    if (grade != null) add(pid);", run: [MINOR] },

  { name: "minor: placed-out courses stop counting as advanced standing", file: OVERLAP,
    from: "  for (const id of placedOut ?? []) add(id);",
    to:   "", run: [MINOR] },

  // ── The major-side release ──────────────────────────────────────
  { name: "minor: the release runs whether or not the cap is exceeded", file: OVERLAP,
    from: "  if (dependentSH - capSH > EPS && typeof majorClaim === \"function\" && sharedKeys.length) {",
    to:   "  if (typeof majorClaim === \"function\" && sharedKeys.length) {", run: [MINOR] },

  { name: "minor: releases are tested one at a time, not accumulated", file: OVERLAP,
    from: "    const without = new Set(placed);\n    for (const r of released) without.delete(r);\n    without.delete(key);",
    to:   "    const without = new Set(placed);\n    without.delete(key);", run: [MINOR] },

  { name: "minor: the release compares TOTALS instead of per-section credit", file: OVERLAP,
    from: "    if (next.sat.every((sh, i) => sh >= base.sat[i] - EPS)) released.push(key);",
    to:   "    const sum = a => a.reduce((n, x) => n + x, 0);\n"
        + "    if (sum(next.sat) >= sum(base.sat) - EPS) released.push(key);", run: [MINOR] },

  { name: "minor: a throwing majorClaim takes the panel down with it", file: OVERLAP,
    from: "  const ask = (set) => { try { return majorClaim(set); } catch { return null; } };",
    to:   "  const ask = (set) => majorClaim(set);", run: [MINOR] },

  // ── majorClaimOf: one owner for "what the majors claim" ─────────
  // Load-bearing for three callers now — the panel, the board's badge and the
  // printed report — and the first two MUST agree, because a student can see
  // both at once.
  { name: "minor: the concentration is left out of the major's claim", file: OVERLAP,
    from: "      if (concentration) {",
    to:   "      if (false) {", run: [MINOR] },

  { name: "minor: the claim reports ONE total instead of per-section credit", file: OVERLAP,
    from: "      for (const s of all) sat.push(satisfiedOf(s, DEFAULT_UNIT_SH, courseMap));",
    to:   "      sat.push(all.reduce((n, s) => n + satisfiedOf(s, DEFAULT_UNIT_SH, courseMap), 0));",
    run: [MINOR] },

  { name: "minor: a junk program entry reaches the allocator", file: OVERLAP,
    from: "  const list = (programs ?? []).filter(p => p?.data);",
    to:   "  const list = programs ?? [];", run: [MINOR] },

  { name: "minor: a malformed majorClaim is trusted rather than declined", file: OVERLAP,
    from: "    if (!next || !Array.isArray(next.sat) || next.sat.length !== base.sat.length) continue;",
    to:   "    if (!next || !Array.isArray(next.sat)) continue;", run: [MINOR] },

  { name: "minor: a course with no credit on record is charged the default 4", file: OVERLAP,
    from: "  const sharedSH  = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 0), 0);",
    to:   "  const sharedSH  = sharedKeys.reduce((n, k) => n + (courseMap[k]?.sh ?? 4), 0);",
    run: [MINOR] },

  { name: "minor: the printed note announces a breach that is not one", file: MODEL,
    from: "  return share.over",
    to:   "  return true", run: [MINOR] },

  // ── UNLOCKS lists a COURSE, not an edge, and never a coreq ──────
  { name: "unlocks: the dedup is defeated (every edge becomes a row)", file: COURSE,
    from: "    if (seen.has(e.to)) continue;",
    to:   "", run: [UNLOCKS] },

  { name: "unlocks: corequisites are listed here again (the doubled lab)", file: COURSE,
    from: "    if (e.type === \"corequisite\" || e.type === \"corequisite-viol\") continue;",
    to:   "", run: [UNLOCKS] },

  { name: "unlocks: incoming prerequisites and self-edges are listed too", file: COURSE,
    from: "    if (e.from !== id || e.to === id) continue;",
    to:   "    if (e.from !== id && e.to !== id) continue;", run: [UNLOCKS] },

  // ── A corequisite stated in the description ─────────────────────
  // KNOWN EQUIVALENT, and the probe is what proved it. Deleting the "or" guard
  // changes nothing today: the operand list is split on commas and " and "
  // only, so any "or" stays INSIDE a segment ("or other 4-SH research course",
  // "PHYS 1151 or PHYS 1153") and that segment then fails the bare-code test,
  // which refuses the whole sentence anyway. So the BIOC 4900 test asserts the
  // right outcome for the wrong reason, which is worth knowing. The guard stays
  // because it becomes load-bearing the moment anyone adds "or" to the
  // separators — and a KILL here is the signal that they did.
  { name: "coreq prose: a CHOICE is read as a conjunction", file: DESCCOREQ,
    from: "  if (/\\bor\\b/i.test(body)) return [];",
    to:   "", run: [DESCOREQ_TEST], equivalent: true },

  { name: "coreq prose: prose among the operands is skipped, not refused", file: DESCCOREQ,
    from: "    if (!c) return [];                       // residue: refuse the sentence",
    to:   "    if (!c) continue;", run: [DESCOREQ_TEST] },

  { name: "coreq prose: a course becomes its own corequisite", file: DESCCOREQ,
    from: "    if (id === String(selfId).toUpperCase()) continue;   // never its own coreq",
    to:   "", run: [DESCOREQ_TEST] },

  { name: "coreq prose: the merge is a fallback, not a union", file: DESCCOREQ,
    from: "  for (const r of [...(Array.isArray(labelled) ? labelled : []),\n                   ...parseDescriptionCoreqs(description, selfId)]) {",
    to:   "  for (const r of (Array.isArray(labelled) ? labelled : [])) {", run: [DESCOREQ_TEST] },

  { name: "total: the shared reader loses the doctoral form", file: PARSER,
    from: "    [new RegExp(`a\\\\s+minimum\\\\s+of\\\\s+${N}\\\\s+${UNIT}[^.]*?beyond\\\\s+the\\\\s+(?:under)?graduate\\\\s+degree`, 'i'),",
    to:   "    [new RegExp(`__never_matches__`, 'i'),", run: [MAJORPARSE, PROSE] },

  // ── Course retention across a catalog edition roll ──────────────
  //
  // This module runs inside an unattended job that REPLACES the course
  // catalog, so each mutant below is a way it could do damage rather than
  // merely be wrong: slander a live course, unbound the file's growth, or
  // disarm the shrink rail that makes an operator look at a roll at all.

  { name: "retain: the shrink rail counts retained courses too", file: RETAIN,
    from: "  return courses.filter(c => c && typeof c === \"object\" && !c.retired).length;",
    to:   "  return courses.filter(c => c && typeof c === \"object\").length;", run: [RETAIN_TEST] },

  { name: "retain: a failed subject is retired like any other absence", file: RETAIN,
    from: "    if (failed.has(String(c.subject ?? \"\").replace(/\\s+/g, \"\").toUpperCase())) continue;",
    to:   "", run: [RETAIN_TEST] },

  { name: "retain: everything absent is kept, referenced or not", file: RETAIN,
    from: "    if (!need.has(key)) { dropped.push(key); continue; }",
    to:   "", run: [RETAIN_TEST] },

  { name: "retain: retiredSince is re-dated on every run", file: RETAIN,
    from: "      retiredSince: typeof c.retiredSince === \"string\" && c.retiredSince ? c.retiredSince : stamp,",
    to:   "      retiredSince: stamp,", run: [RETAIN_TEST] },

  { name: "retain: a revived course keeps its retirement marker", file: RETAIN,
    from: "    if (c && typeof c === \"object\" && (c.retired || c.retiredSince)) {",
    to:   "    if (false) {", run: [RETAIN_TEST] },

  { name: "retain: duplicate keys in the snapshot duplicate the entry", file: RETAIN,
    from: "    if (seen.has(key)) continue;",
    to:   "", run: [RETAIN_TEST] },

  { name: "retain: a malformed tree key protects a fictional course", file: RETAIN,
    from: "          const m = /^([A-Za-z]+)\\s*([0-9][0-9A-Za-z]*)$/.exec(String(raw ?? \"\").trim());\n          const key = m ? normalizeKey(m[1], m[2]) : null;",
    to:   "          const key = String(raw ?? \"\").trim().toUpperCase() || null;", run: [RETAIN_TEST] },

  { name: "retain: an unreadable requirements.json fails the scrape", file: RETAIN,
    from: "      let program;\n      try {\n        program = JSON.parse(io.readFile(path));\n      } catch {\n        unreadable++;\n        io.warn?.(`could not read ${path} — its courses are not protected this run`);\n        continue;\n      }",
    to:   "      const program = JSON.parse(io.readFile(path));", run: [RETAIN_TEST] },

  { name: "retain: a half-key is accepted as a key", file: RETAIN,
    from: "  return s && n ? `${s}${n}` : null;",
    to:   "  return `${s}${n}`;", run: [RETAIN_TEST] },

  // The wiring, which the pure functions cannot hold on their own.
  { name: "retain/wiring: the rail counts the committed file raw again", file: SCRAPER,
    from: "      const prevCount = activeCourseCount(JSON.parse(readFileSync(CATALOG_OUT, \"utf8\")));",
    to:   "      const prevCount = JSON.parse(readFileSync(CATALOG_OUT, \"utf8\")).length;",
    run: [RETAIN_TEST] },

  { name: "retain/wiring: the rail compares raw lengths again", file: SCRAPER,
    from: "      const liveCount = activeCourseCount(out);\n      if (prevCount > 0 && liveCount < floor) {",
    to:   "      const liveCount = out.length;\n      if (prevCount > 0 && out.length < floor) {",
    run: [RETAIN_TEST] },

  { name: "retain/wiring: runRotate keeps a stale retirement marker", file: SCRAPER,
    from: "        retired: undefined, retiredSince: undefined,\n        title:        cat.title        || prev.title,",
    to:   "        title:        cat.title        || prev.title,", run: [RETAIN_TEST] },

  { name: "retain/wiring: runSubjects keeps a stale retirement marker", file: SCRAPER,
    from: "          retired: undefined, retiredSince: undefined,\n          title:        cat.title        || prev.title,",
    to:   "          title:        cat.title        || prev.title,", run: [RETAIN_TEST] },

  // ── The retired union: a plan's courses survive the edition roll ──
  //
  // This module reports "0 courses" against the repo as it stands — the frozen
  // 2026 snapshot IS the shipped catalog — so every one of these mutants is
  // invisible to a report-only run and can only be caught by the simulated
  // roll in the unit test. That is precisely what they are here to verify.
  { name: "union: a course still in the catalog is ALSO reported retired", file: RETUNION,
    from: "    if (current.has(key)) continue;          // still published — not retired",
    to:   "", run: [RETUNION_TEST] },

  // Isolated to the RECORD: `from` is still updated, so fidelity stays correct
  // and this can only be killed by a test that checks which edition's copy of
  // the course survived. A cruder mutant that dropped both would die for the
  // wrong reason and tell us nothing about that.
  { name: "union: the OLDEST edition's record wins, not the newest", file: RETUNION,
    from: "      if (prior) { prior.record = c; prior.from = year; prior.editions.add(year); }",
    to:   "      if (prior) { prior.from = year; prior.editions.add(year); }", run: [RETUNION_TEST] },

  { name: "union: fidelity is taken from the span's START, not the record's edition", file: RETUNION,
    from: "        fidelity: fidelityOfEdition(from),",
    to:   "        fidelity: fidelityOfEdition(years[0]),", run: [RETUNION_TEST] },

  { name: "union: every record is assumed full fidelity", file: RETUNION,
    from: "        fidelity: fidelityOfEdition(from),",
    to:   "        fidelity: \"full\",", run: [RETUNION_TEST] },

  { name: "union: editions are used in directory order, unsorted", file: RETUNION,
    from: "  const ordered = [...snapshots].sort((a, b) => a.year - b.year);",
    to:   "  const ordered = [...snapshots];", run: [RETUNION_TEST] },

  // ── Legacy (Mills) course numbers in prereq text ────────────────────────
  //
  // This defect reached main: an unreadable OR-branch parsed to nothing and
  // left the operator on BOTH sides, corrupting 513 prereq trees. These
  // mutants exist because the bug was invisible to every unit test at the
  // time — the suite asserted what the parser produced for inputs that parsed,
  // and said nothing about a tree coming back malformed.
  { name: "prereq: a legacy course number stops being note-worthy", file: PREREQ,
    from: "  NOTE_SIGNAL.test(note) || SCORE_GATE.test(note) || LEGACY_COURSE.test(note);",
    to:   "  NOTE_SIGNAL.test(note) || SCORE_GATE.test(note);", run: [PREREQ_TEST] },

  // The half of the fix that LOOKED complete. Reverting only the cleanNote
  // guard still leaves 4-digit-subject legacy codes working, so a test that
  // checked one example of the fix would pass here — it has to reach a
  // two-letter subject specifically.
  { name: "prereq: cleanNote's word guard drops two-letter legacy subjects", file: PREREQ,
    from: "  return /[a-z]{3,}/i.test(s) || LEGACY_COURSE.test(s) ? s : null;",
    to:   "  return /[a-z]{3,}/i.test(s) ? s : null;", run: [PREREQ_TEST] },

  // The dangerous direction. If the anchor goes, a REAL four-digit course
  // becomes inert prose and every prereq in the catalog stops being enforced —
  // a silent, catalog-wide disarming rather than a visible break.
  { name: "prereq: LEGACY_COURSE loses its anchors and swallows real codes", file: PREREQ,
    from: "const LEGACY_COURSE = /^(?:[A-Z]{2,6}\\s+\\d{2,3}[A-Z]{0,2}\\s*)+$/;",
    to:   "const LEGACY_COURSE = /(?:[A-Z]{2,6}\\s+\\d{2,3}[A-Z]{0,2}\\s*)+/;", run: [PREREQ_TEST] },

  { name: "union: a stale retiredSince rides along beside the lifespan", file: RETUNION,
    from: "    const { retired: _r, retiredSince: _s, ...clean } = record;",
    to:   "    const clean = record;", run: [RETUNION_TEST] },

  { name: "union: lifespan claims every edition held, not the ones that carried it", file: RETUNION,
    from: "        firstEdition: years[0],\n        lastEdition:  years[years.length - 1],\n        editions:     years,",
    to:   "        firstEdition: ordered[0]?.year,\n        lastEdition:  ordered[ordered.length - 1]?.year,\n        editions:     ordered.map(e => e.year),", run: [RETUNION_TEST] },

  // ── The free-elective allowance ─────────────────────────────────
  // The historic bug restored verbatim. `?? 0` takes a residual against a total
  // the record does not carry, and the result is indistinguishable from a
  // measured zero — which the audit then drew as a TICKED, fully-barred
  // "0/0 SH" on 472 of 1,722 shipped programs.
  { name: "electives: the allowance goes back to treating a missing total as zero",
    file: BINDING,
    from: "  const total = programData?.totalCreditsRequired;\n  if (!(Number.isFinite(total) && total > 0)) return null;\n  return Math.max(0, total - demand);",
    to:   "  return Math.max(0, (programData?.totalCreditsRequired ?? 0) - demand);",
    run: [GE_TEST, GE_CORPUS] },

  // The subtler half: the rule is right but the accessor collapses it again on
  // the way out, which is where it lived for a year the first time.
  { name: "electives: generalElectiveSHOf collapses the unknown back to 0",
    file: BINDING,
    from: "  const total = programData?.totalCreditsRequired;\n  if (!(Number.isFinite(total) && total > 0)) return null;\n  const ge = obligationsOf",
    to:   "  const ge = obligationsOf",
    run: [GE_TEST, GE_CORPUS] },

  // A row is kept when it carries a fact. Dropping the placed-credit arm is the
  // tempting simplification ("just hide it when it is zero") and it deletes the
  // case that matters most: credit on a degree with no room for it.
  { name: "electives: the worth-showing rule forgets placed credit",
    file: GRADREQ,
    from: "  if (Number.isFinite(req) && req > 0) return true;\n  return (section.placedSH ?? 0) > 0;",
    to:   "  return Number.isFinite(req) && req > 0;",
    run: [GE_TEST, GE_CORPUS] },

  // ...and the opposite mistake: showing everything again. Only the RENDER can
  // see this one, which is why the browser file exists — and why GradPanel
  // needs its own mutant despite planModel carrying the same rule.
  { name: "electives: the panel stops filtering the empty row",
    file: GRADPANEL,
    from: "const keepSection = (sec) =>\n  sec?.title !== \"General Electives\" || generalElectivesWorthShowing(sec);",
    to:   "const keepSection = () => true;",
    run: [GE_UI] },

  // The bar and the tick, which are the whole visible defect. `sat` is
  // unconditionally true on this section, so losing the unknown branch restores
  // a satisfied requirement on a degree we never measured.
  { name: "electives: an unknown allowance renders as a measured zero again",
    file: GRADPANEL,
    from: "  const allowanceUnknown = isGeneralElectives\n    && !(Number.isFinite(sec.requiredSH) && sec.requiredSH >= 0);",
    to:   "  const allowanceUnknown = false;",
    run: [GE_UI] },

  // ── A page that is not a program ────────────────────────────────
  // Each mutant is one of the simpler rules that was measured and REFUSED, restored. They
  // matter because they fail in the expensive direction: every one of them deletes a degree
  // a student can be admitted to, rather than merely admitting a noise row.
  { name: "non-program: the credential rescue is dropped (deletes the dual degrees)",
    file: NONPROG,
    from: "  return tables > 0 || titleNamesCredential(data?.name);",
    to:   "  return tables > 0;",
    run: [NONPROG_TEST] },

  // The anchor is what makes a match a READING of NEU's title convention rather than a
  // keyword hit. Unanchored it admits four registrar policy pages that merely discuss
  // certificates.
  { name: "non-program: the comma/slash anchor is dropped",
    file: NONPROG,
    from: "const AFTER_SEPARATOR = /[,/]\\s*([A-Za-z]+)/g;",
    to:   "const AFTER_SEPARATOR = /([A-Za-z]+)/g;",
    run: [NONPROG_TEST] },

  // Absent is not zero. A record that never counted its tables is one this filter has no
  // evidence about; reading that as "no tables" deletes it.
  { name: "non-program: an absent tablesPresent is read as zero",
    file: NONPROG,
    from: "  if (tables == null) return true;",
    to:   "  if (tables == null) return false;",
    run: [NONPROG_TEST] },

  // The bulk guard. Without it, a markup change at NEU makes `tablesPresent` read 0
  // catalog-wide and this filter discards every degree we ship, while every other rail sees
  // a well-formed, internally consistent run of nothing.
  { name: "non-program: the bulk rail stops refusing a catalog-wide collapse",
    file: NONPROG,
    from: "  if (!discovered || dropped <= discovered * MAX_DROP_RATIO) return { ok: true, reason: null };",
    to:   "  return { ok: true, reason: null };\n  if (!discovered) return { ok: true, reason: null };",
    run: [NONPROG_TEST] },

  // A withdrawal is not a vanish — but the exemption must not become a hole. Reading the
  // NEW record instead of the previous one is the plausible mistake, and it would let a
  // genuine fleet-wide regression through: every program that stopped parsing would be
  // exempted for having stopped parsing.
  { name: "rails: withdrawal is judged on the NEW record, not the committed one",
    file: RAILS,
    from: "      if (!wasProgram(previous.get(k))) { withdrawn.push(k); return false; }",
    to:   "      if (!wasProgram(results.get(k) ?? previous.get(k))) { withdrawn.push(k); return false; }",
    run: [RAILS_TEST] },

  // ── A program that got RENAMED across an edition roll ──────────────
  //
  // The witness gates whether a `shared` section is EMITTED or SKIPPED, so every
  // mutant here is a silently deleted requirement rather than a cosmetic loss.

  // The ordering that matters. A rename entry is a fallback for a folder that is not
  // there — if it can override, a stale entry replaces a real witness with a retired
  // program's, and the record says nothing about which one it used.
  { name: "witness: a rename entry OVERRIDES the program's own folder",
    file: WITNESS,
    from: "  const candidates = wasAt ? [`${college}/${slug}`, wasAt] : [`${college}/${slug}`];",
    to:   "  const candidates = wasAt ? [wasAt, `${college}/${slug}`] : [`${college}/${slug}`];",
    run: [WITNESS_TEST] },

  // The table is keyed on the edition the rename appeared in, which is what makes it
  // self-limiting. Ignoring the year applies a 2027 rename to every edition forever.
  { name: "witness: a rename applies to every edition, not the one it happened in",
    file: WITNESS,
    from: "  return RENAMED[year]?.[`${college}/${slug}`] ?? null;",
    to:   "  return Object.values(RENAMED).map(t => t[`${college}/${slug}`]).find(Boolean) ?? null;",
    run: [WITNESS_TEST] },

  // Half a rail is the shape this whole family of bugs takes. A dead KEY means the
  // witness is not being carried for a program that exists; nothing else reports it,
  // because the evidence is an absence.
  { name: "witness: renameOrphans stops reporting a key this run never parsed",
    file: WITNESS,
    from: "    if (!here.has(now)) deadKeys.push(now);",
    to:   "    if (false) deadKeys.push(now);",
    run: [WITNESS_TEST] },

  // ...and the other half. A dead VALUE is an entry that can never fire at all.
  { name: "witness: renameOrphans stops reporting a missing predecessor",
    file: WITNESS,
    from: "    if (!found) deadValues.push(`${now} ← ${before}`);",
    to:   "    if (false) deadValues.push(`${now} ← ${before}`);",
    run: [WITNESS_TEST] },

  // The lookback bound, on the rail side. An entry pointing outside the window reads as
  // healthy while `inheritWitness` can never reach it — the two must agree or the rail
  // certifies something that does not work.
  { name: "witness: renameOrphans accepts a predecessor outside the lookback window",
    file: WITNESS,
    from: "      .filter(n => /^\\d{4}$/.test(n) && Number(n) < year && Number(n) >= year - MAX_LOOKBACK)",
    to:   "      .filter(n => /^\\d{4}$/.test(n) && Number(n) < year)",
    run: [WITNESS_TEST] },

  // The third table keyed on a slug. Dropping the rename fallback puts the ratchet back
  // to where it was on the 2027 roll: every renamed program compared against nothing,
  // on the one run against markup nobody has looked at yet.
  { name: "ratchet: a renamed program escapes the baseline comparison",
    file: VERIFY_MAJORS,
    from: "      const alt = m ? (byShape.get(`${m[1]}/${m[3]}`)\n                    ?? (wasAt ? byShape.get(`${m[1]}/${wasAt}`) : null)) : null;",
    to:   "      const alt = m ? byShape.get(`${m[1]}/${m[3]}`) : null;",
    run: [RATCHET_TEST] },

  // ...and the tree gate on it. `RENAMED` carries `college/slug` with no tree segment and
  // `engineering` exists in both, so without this a graduate program is ratcheted against
  // an undergraduate degree that merely shares a folder name.
  { name: "ratchet: the rename fallback reaches across trees",
    file: VERIFY_MAJORS,
    from: "      const wasAt = m && m[1] === 'undergraduate'",
    to:   "      const wasAt = m && m[1] !== null",
    run: [RATCHET_TEST] },

  // The corpus guard for the non-program rule. Its own assertion is satisfied by an
  // `isProgramPage` that never returns false, which is exactly the weakening a future
  // "make the build pass" edit would reach for.
  { name: "programs-are-programs: the rule stops discriminating",
    file: NONPROG,
    from: "  return tables > 0 || titleNamesCredential(data?.name);",
    to:   "  return true;",
    run: [PROGRAMS_ARE_PROGRAMS] },
];

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const selected = only ? MUTANTS.filter(m => m.name.includes(only)) : MUTANTS;

if (argv.includes("--list")) {
  for (const m of MUTANTS) console.log(`${m.equivalent ? "[equiv] " : "        "}${m.name}`);
  process.exit(0);
}

// A dirty target file would be reverted by `git checkout --`, destroying the
// work AND measuring HEAD rather than what the operator wrote. Both happened
// while this was being built, and the second is the dangerous one: the run
// looks like it passed judgement on your change when it never saw it.
const files = [...new Set(selected.map(m => m.file))];
const dirty = execSync(`git status --porcelain -- ${files.join(" ")}`, { cwd: ROOT })
  .toString().trim();
if (dirty) {
  console.error(`refusing to run: uncommitted changes in a file this mutates.\n${dirty}\n`
    + `Mutants are reverted with \`git checkout --\`, so this would discard that work and\n`
    + `measure HEAD instead of what you wrote. Commit or stash first.`);
  process.exit(2);
}

const restore = () => execSync(`git checkout -- ${files.join(" ")}`, { cwd: ROOT });

let killed = 0;
const survived = [], skipped = [];
for (const m of selected) {
  restore();
  const path = join(ROOT, m.file);
  const src = readFileSync(path, "utf8");
  const hits = src.split(m.from).length - 1;
  if (hits === 0) { skipped.push(m.name); console.log(`SKIP     ${m.name}   (anchor gone — this mutant tests nothing)`); continue; }
  if (hits > 1)   { skipped.push(m.name); console.log(`SKIP     ${m.name}   (anchor matches ${hits}x — not unique)`); continue; }
  writeFileSync(path, src.replace(m.from, m.to));
  let by = null;
  for (const cmd of m.run) {
    try { execSync(cmd, { cwd: ROOT, stdio: "pipe" }); }
    catch { by = cmd.split("node --test ")[1]; break; }
  }
  if (by) { killed++; console.log(`KILLED   ${m.name}   (by ${by})`); }
  else if (m.equivalent) { killed++; console.log(`survived ${m.name}   — expected: equivalent mutant`); }
  else { survived.push(m.name); console.log(`SURVIVED ${m.name}   <-- NOTHING CAUGHT THIS`); }
}
restore();

console.log(`\n${killed}/${selected.length} accounted for`);
if (survived.length) {
  console.log(`\n${survived.length} SURVIVED — a hole in the suite, or an equivalent mutant. Decide which:`);
  for (const s of survived) console.log(`  ${s}`);
}
if (skipped.length) {
  console.log(`\n${skipped.length} SKIPPED — re-anchor these or they silently stop testing:`);
  for (const s of skipped) console.log(`  ${s}`);
}
process.exit(survived.length || skipped.length ? 1 : 0);

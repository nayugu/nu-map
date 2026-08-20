#!/usr/bin/env node
/**
 * chart-probe.js — the fast inner loop, for a NAMED set of plans.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * `verify-chart.js` takes four to ten minutes. That is the right cost for a verdict on the
 * corpus and the wrong cost for a question. Working at ten minutes a cycle, three changes
 * land before the first number comes back and nothing can be attributed to anything — which
 * is exactly how an empty-term regression survived three wrong hypotheses in a row today
 * (new plans bringing their own, starved tier budgets, a `bigSH` bookkeeping bug — the last
 * a real defect, and still not the cause).
 *
 * So: give it a list of plan labels and it regenerates only those, in seconds.
 *
 *   node scripts/chart-probe.js --plans worse.json
 *   node scripts/chart-probe.js ug/architecture_bs_'(boston)'#0 grad/law_jd_'(boston)'
 *   node scripts/chart-probe.js --plans worse.json --json before.json
 *
 * ── What it reports, and why those ──────────────────────────────────
 *
 * One line per plan with the three numbers the success criteria are stated in
 * (docs/chart-success-criteria.md): terms short of four real courses, empty full terms, and
 * terms leaving three or more cells unguided. Plus a refusal, which is its own failure.
 *
 * `--json` writes the same data keyed by label so two runs can be diffed exactly. A summary
 * that says "3 worse" without naming them is how the last three hypotheses each took a full
 * corpus run to disprove.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan, createTrace, EARLY_RUNGS } from "../src/engine/index.js";
import { deriveModel } from "../src/core/derivation/reduce.js";
import { searchTree } from "../src/core/derivation/tree.js";
import { buildSteps, orderWhy, orderReason, frameAt, frameCount, frameLoad }
  from "../src/core/derivation/steps.js";
import { buildDepthIndex } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { minCoursesFor } from "../src/engine/calibration.js";
import { isUnguided } from "./lib/chart-gate.js";
import { GENERAL_ELECTIVE, CONCENTRATION } from "../src/core/requirementDemand.js";
import { realCourseCount } from "../src/core/coreqGroups.js";
// `--electives` only. Imported here rather than in a second script because every one of these
// questions is about the SAME cells the plan loop below regenerates, and a separate file would
// reload the 8,000-course catalog to ask them.
import { deriveCells, breadthCodes } from "../src/engine/demand.js";
import { breadthSplit } from "../src/engine/electives.js";
import { buildPrecedence, chainHeight } from "../src/engine/precedence.js";
import { cellLevelTarget } from "../src/engine/prereqDepth.js";
import { majorSubjectsOf, cellSubject } from "../src/engine/subjects.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };

const listFile = flag("--plans");
const jsonOut = flag("--json");
// A program with concentrations plans very differently once one is chosen — and the
// pre-pick case legitimately refuses for 8 shapes, so measuring only that reports a
// refusal where the student would see a plan. Without this the probe cannot tell a real
// regression from the ∀-option rule doing its job.
const concentration = flag("--concentration");
// Per-term detail for one plan, so "why is this term short" does not need a fresh script.
const showTerms = argv.includes("--terms");
// A/B the `shared`-section witness without touching the tree. `deriveCells` reads the plan
// of study from `metadata.planOfStudyCourses`, and an EMPTY witness is exactly the engine's
// pre-Aug-2026 behaviour of skipping every shared section — so dropping the field
// reproduces the old plans in the same process as the new ones. Stashing the source to get
// a baseline is the alternative, and in a shared checkout that also moves the other
// session's `HEAD`.
const stripWitness = argv.includes("--no-witness");
// Raise the search budget, to tell "no arrangement exists" from "we stopped looking".
// 53% of refusals exhaust the node budget with space left, so this is the difference
// between a fact about the degree and a weakness in the search.
const nodeBudget = flag("--nodes") ? Number(flag("--nodes")) : null;
const timeMs = flag("--ms") ? Number(flag("--ms")) : 5000;
// ── `--electives`: the elective ARITHMETIC, corpus-wide, without searching ──
//
// A different question from the rest of this file, and much cheaper. "How does this degree's
// free credit split, and how deep are its own courses" is answered from the CELLS — no search,
// no ladder, no clock — so it sweeps every program in about the time one plan takes to generate.
//
// It exists because rule 4 needs a COMPARAND, and picking one by intuition is how the level-
// versus-time metric got built to measure a rule we do not hold. Two candidates are printed
// side by side (course level and in-plan chain height) so the choice is made on the corpus
// rather than on which one sounds more like depth.
const electivesMode = argv.includes("--electives");
// ── `--trace`: is the derivation recording OBSERVATION ONLY? ────────
//
// The one property the whole derivation view rests on, and the only way to establish it is to
// run the same program twice — once recording, once not — and compare the emitted documents
// byte for byte. Two ways a sink could break it and this catches both: a write through a
// reference it was handed, and the wall clock, since `placeCells` refuses when the clock runs
// out and anything that slows a node down can turn a plan into a refusal.
//
// It also prints the overhead, because "it does not change the plan on my machine at 5,000 ms"
// is a weaker claim than "it costs 0.4% of the clock". The second one survives a slower machine.
const traceMode = argv.includes("--trace");
// ── `--concentrations`: where concentration cells LAND, ours against the departments' ──
//
// The gate for the `thin` reach preference on concentration cells. That preference pushes a cell
// towards terms where its option list survives, and pushing later is the failure mode: measured
// BEFORE it was wired, departments place concentration cells at mean position 0.591 with 18.6% in
// the first quarter, and CHART at 0.580 with 14.3% — we were already marginally later than they
// are. So "fewer narrow cells" is not sufficient evidence; the position distribution has to stay
// where the corpus is, and this is what says whether it did.
//
// Compares against the DEPARTMENTS in the same run rather than against a remembered number, since
// their figure moves whenever the plan corpus is re-scraped.
const concentrationsMode = argv.includes("--concentrations");
// ── `--rungs`: WHICH rung of the early ladder answered, and why the ones above it did not ──
//
// `report.relaxed` says a plan abandoned its department's arrangement. It does not say what
// refused, and that difference is the whole diagnosis: "the credit ceiling refused" and "no
// arrangement of these four terms exists" call for opposite fixes. So this runs each rung
// DELIBERATELY, with `_onEarlyRung` set so the ladder cannot restart underneath us, and prints
// the refusal reason and detail at each — plus how many cells adoption managed to fix, which is
// the number that says whether the arrangement was even read.
const rungsMode = argv.includes("--rungs");
const wanted = new Set(listFile
  ? JSON.parse(readFileSync(listFile, "utf8"))
  : argv.filter(a => !a.startsWith("--") && a !== listFile && a !== jsonOut));
if (!wanted.size && !electivesMode && !concentrationsMode) {
  console.error("usage: chart-probe.js [--plans list.json] [--json out.json] [label ...]");
  console.error("       chart-probe.js --electives [--json out.json]");
  console.error("       chart-probe.js --concentrations");
  process.exit(2);
}

const { courseMap } = loadCatalog();
const ports = enginePorts(courseMap);
const depthIndex = buildDepthIndex(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };

const flat = (es, out = []) => { for (const e of es ?? []) { out.push(e); flat(e.children, out); } return out; };

/** The median of a numeric list, or null for an empty one. */
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/**
 * One program's elective arithmetic, and the two candidate comparands for rule 4.
 *
 * Everything here is read off the CELLS, so it is a statement about the degree rather than
 * about the plan we happened to construct for it — which is the right level for a rule that
 * decides what an elective competes against.
 */
function electiveFacts(program) {
  const { cells } = deriveCells(program, { courseMap, repeatable: () => false });
  const ge = cells.filter(c => c.target === GENERAL_ELECTIVE);
  const remaining = breadthCodes(cells, courseMap).length;
  const split = breadthSplit({ cells: ge.length, remaining });
  // Roles as the engine actually emitted them, so a disagreement between the arithmetic above
  // and `deriveCells` shows up here rather than in a plan three layers later.
  const emittedBreadth = ge.filter(c => c.geRole === "breadth").length;
  const emittedDepth = ge.filter(c => c.geRole === "depth").length;

  // The major's OWN courses, which is what rule 4 compares an elective against. Named cells
  // only: a choice cell guarantees neither of its branches, so its level is not the degree's
  // claim about depth any more than it is its claim about a competency.
  const plans = cells.map(c => ({ cell: c, candidates: c.groups?.flat() ?? null }));
  const majors = majorSubjectsOf(plans, courseMap);
  const majorNamed = plans.filter(p =>
    p.cell.kind === "named" && majors.has(cellSubject(p, courseMap)));

  // Candidate A: course LEVEL, via the measured level→position table (r = 0.809 over 12,848
  // placements). Candidate B: in-plan CHAIN HEIGHT — how many cells must follow this one.
  const levels = majorNamed.map(p => cellLevelTarget(p, courseMap)).filter(v => v != null);
  const precedence = buildPrecedence(cells, courseMap, { observed: observed.edges ?? [] });
  const heights = chainHeight(plans, precedence);
  const majorHeights = majorNamed.map(p => heights.get(p.cell.id) ?? 0);

  return {
    ge: ge.length, remaining, breadth: split.breadth, depth: split.depth,
    emittedBreadth, emittedDepth,
    majorNamed: majorNamed.length,
    levelMed: median(levels), levelMax: levels.length ? Math.max(...levels) : null,
    heightMed: median(majorHeights),
    heightMax: majorHeights.length ? Math.max(...majorHeights) : null,
  };
}

// ── `--concentrations` state ────────────────────────────────────────
const deptPos = [], chartPos = [];

/**
 * Every concentration cell's position in one plan, as a fraction through it.
 *
 * By `binding.targets`, not by card text, for the same reason the general-elective count is: a
 * concentration cell is titled with the concentration once one is picked and generically before,
 * so wording cannot identify the bucket. Work and unused terms are counted in the denominator
 * because position means "how far through the degree", and a co-op term is part of the degree.
 */
function concPositions(planDoc, sink) {
  if (!planDoc) return;
  const terms = [];
  for (const y of planDoc.years ?? []) for (const t of y.terms ?? []) terms.push(t);
  if (terms.length < 2) return;
  terms.forEach((t, ti) => {
    for (const e of flat(t.entries)) {
      if (e.binding?.targets?.includes(CONCENTRATION)) sink.push(ti / (terms.length - 1));
    }
  });
}

/** The three criteria, read off one emitted plan. */
function score(doc, studentType) {
  const minCourses = minCoursesFor(chartCalibration, studentType);
  let short = 0, empty = 0, unguided3 = 0, terms = 0;
  // The GENERAL ELECTIVE bucket, by binding rather than by wording. `unguided3` reads the
  // card TEXT, so a breadth cell reading "General Elective (IC)" counts as guided — correct
  // for "does this card say anything", and the wrong instrument for "how many electives are
  // stacked here". Four reservations in a term is a real semester; four general electives is
  // not, and only this counts them.
  let ge3 = 0, geMax = 0;
  for (const y of doc.years ?? []) for (const t of y.terms ?? []) {
    const es = flat(t.entries);
    const coop = es.some(e => e.coop);
    const cells = es.filter(e => !e.coop && !e.vacation && !e.heading);
    const half = /summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`);
    if (half || coop) continue;
    if (!cells.length) { empty++; continue; }
    terms++;
    if (minCourses > 0) {
      const named = [], anon = [];
      for (const e of cells) {
        const ids = e.options?.length === 1 ? e.options[0] : null;
        if (ids?.length) named.push({ id: ids[0], sh: e.sh ?? 0 }); else anon.push(e.sh ?? 0);
      }
      const real = realCourseCount(named, courseMap, chartCalibration.realCourseSH)
        + anon.filter(sh => sh >= chartCalibration.realCourseSH).length;
      if (real < minCourses) short++;
    }
    if (cells.filter(e => isUnguided(e.text)).length > 2) unguided3++;
    const ge = cells.filter(e => e.binding?.targets?.includes(GENERAL_ELECTIVE)).length;
    if (ge > 2) ge3++;
    geMax = Math.max(geMax, ge);
  }
  return { short, empty, unguided3, ge3, geMax, terms };
}

const out = {};
let refused = 0;
for (const lvl of ["undergraduate", "graduate"]) {
  const base = join(ROOT, "data/northeastern/programs", lvl, "2026");
  if (!existsSync(base)) continue;
  for (const col of readdirSync(base)) for (const key of readdirSync(join(base, col))) {
    const rf = join(base, col, key, "requirements.json");
    if (!existsSync(rf)) continue;
    const prefix = `${lvl === "graduate" ? "grad" : "ug"}/${key}`;
    // Cheap pre-filter: skip a program none of whose variants were asked for. `--electives`
    // sweeps everything — it asks about degrees rather than about plans, and there is no list
    // of interesting ones until it has run.
    if (!electivesMode && !concentrationsMode
        && ![...wanted].some(w => w === prefix || w.startsWith(`${prefix}#`))) continue;
    const data = JSON.parse(readFileSync(rf, "utf8"));
    if (stripWitness && data.metadata) delete data.metadata.planOfStudyCourses;
    if (electivesMode) {
      // Undergraduate only. NUPath is an undergraduate framework, so `remaining` is not a
      // meaningful quantity for a master's and printing one would invite a rule to be fitted
      // to it.
      if (lvl !== "undergraduate") continue;
      try { out[prefix] = electiveFacts(data); }
      catch (e) { out[prefix] = { threw: String(e?.message ?? e) }; }
      continue;
    }
    const pf = join(base, col, key, "plan.json");
    const doc = existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null;
    if (concentrationsMode) {
      // Only degrees with a real disjunction to place. A program naming one option has no
      // choice to misrepresent, so including it would dilute the very thing being measured.
      if (lvl !== "undergraduate") continue;
      if ((data.concentrations?.concentrationOptions ?? []).length < 2) continue;
      const pub = (doc?.plans ?? [])[0] ?? null;
      concPositions(pub, deptPos);
      let r;
      try {
        r = generatePlan({
          program: data, publishedPlan: pub, courseMap, ports, depthIndex,
          observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
          calibration: chartCalibration, timeBudgetMs: timeMs,
        });
      } catch { continue; }
      if (!r.refused) concPositions(r.plan.plans[0], chartPos);
      continue;
    }
    const variants = doc?.plans?.length ? doc.plans : [null];
    variants.forEach((variant, vi) => {
      const label = prefix + (variants.length > 1 ? `#${vi}` : "");
      if (!wanted.has(label)) return;
      const studentType = lvl === "graduate" ? "graduate" : "undergraduate";
      if (rungsMode) {
        const base = {
          program: data, publishedPlan: variant, courseMap, ports, depthIndex,
          observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
          studentType, calibration: chartCalibration, timeBudgetMs: timeMs,
          ...(nodeBudget ? { nodeBudget } : {}),
          ...(concentration ? { concentration } : {}),
          // The ladder must not restart underneath a rung we chose on purpose — that is the
          // same non-reentrancy `generatePlan` relies on, used here to isolate one rung.
          _onEarlyRung: true,
        };
        const steps = [{ name: "(all on)", args: {} }, ...EARLY_RUNGS];
        console.log(`\n── ${label} ──`);
        for (const step of steps) {
          let res;
          try { res = generatePlan({ ...base, ...step.args }); }
          catch (e) { console.log(`  ${step.name.padEnd(26)} THREW ${String(e?.message ?? e)}`); continue; }
          const et = res.report?.earlyTerms;
          const tag = res.refused
            ? `REFUSED ${res.refused.reason} ${res.refused.detail ?? ""}`
            : `ok  fixed=${et?.fixed ?? 0} moved=${et?.moves?.length ?? 0}`
              + ` unplaced=${et?.unplaced?.length ?? 0} source=${et?.source}`;
          console.log(`  ${step.name.padEnd(26)} ${tag}`);
          // WHICH cells the tight term is holding. The sentence "must hold 20 but allows 19"
          // names neither the cells nor who fixed them there, and those are the two facts that
          // separate "the department published a heavy term" from "we pinned one of our own".
          for (const t of (res.refused?.data?.tightestTerms ?? [])) {
            console.log(`      ${t.label}: forced ${t.forcedSH}SH vs cap ${t.cap} — ${(t.cells ?? []).join(", ")}`);
          }
        }
        return;
      }
      let r;
      const tPlain = Date.now();
      try {
        r = generatePlan({
          program: data, publishedPlan: variant, courseMap, ports, depthIndex,
          observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
          studentType, calibration: chartCalibration, timeBudgetMs: timeMs,
          ...(nodeBudget ? { nodeBudget } : {}),
          ...(concentration ? { concentration } : {}),
        });
      } catch (e) { out[label] = { threw: String(e?.message ?? e) }; return; }
      if (traceMode) {
        const msPlain = Date.now() - tPlain;
        const trace = createTrace();
        const t0 = Date.now();
        let r2;
        try {
          r2 = generatePlan({
            program: data, publishedPlan: variant, courseMap, ports, depthIndex,
            observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
            studentType, calibration: chartCalibration, timeBudgetMs: timeMs,
            ...(nodeBudget ? { nodeBudget } : {}),
            ...(concentration ? { concentration } : {}),
            trace,
          });
        } catch (e) { out[label] = { threw: `traced: ${String(e?.message ?? e)}` }; return; }
        const snap = trace.snapshot();
        // The reducers run HERE, against real recordings, because that is the only place the
        // full input space exists: a fixture can be hostile about shapes and cannot be
        // hostile about a 13,000-node search over 32 cards with five attempts and a rung.
        let model = null, modelErr = null;
        try { model = deriveModel(snap); }
        catch (e) { modelErr = String(e?.message ?? e); }
        // The EMITTED document, stringified. Comparing reports would be weaker: two runs can
        // agree on every statistic and put a course in a different term.
        const same = JSON.stringify(r.refused ? r.refused : r.plan)
                  === JSON.stringify(r2.refused ? r2.refused : r2.plan);
        out[label] = {
          same, nodes: r.report?.nodes ?? r.refused?.data?.nodes ?? 0,
          recorded: snap.nodes, truncated: snap.truncated,
          attempts: snap.attempts.length, stages: snap.stages.length,
          msPlain, msTraced: Date.now() - t0,
          rejects: snap.causeCounts.reduce((a, b) => a + b, 0),
          modelErr,
          stageKeys: model ? model.stages.map(s => s.key).join(">") : null,
          answered: model ? (model.stages.find(s => s.answered)?.key ?? "none") : null,
          saturated: model?.summary.saturated ?? null,
          drawableTree: model?.summary.drawableTree ?? null,
          buckets: model?.profile.buckets.length ?? 0,
          exact: model?.profile.exact ?? null,
          topCause: model?.causeTotals[0]?.cause ?? null,
          // Every (card, term) pair must get exactly one fate, so the counts have to sum to
          // cards x terms. An invariant rather than a statistic: a fate that falls through
          // every branch would silently render as "not offered", which is a false claim
          // about the catalog.
          // The fate DISTRIBUTION, not just its total. Which reasons actually occur decides how
          // many categorical hues the matrix needs, and the dataviz procedure is explicit that a
          // ninth series is never a generated hue — so the palette is sized from this rather
          // than from the length of the enumeration.
          fates: model ? { ...model.narrowing.counts } : null,
          fateSum: model ? Object.values(model.narrowing.counts).reduce((a, b) => a + b, 0) : 0,
          fateExpect: model ? model.narrowing.rows.length * model.narrowing.terms.length : 0,
          // ── Where the walkthrough stops matching the plan ────────────
          //
          // The reconciliation is a boolean, and a boolean is useless for fixing it. This names
          // the courses whose term the walkthrough gets wrong, which is the difference between
          // "the swaps are mis-recorded" and "the spine is read off the wrong node".
          steps: (() => {
            if (!model) return null;
            const st = buildSteps(snap, model);
            if (!st) return null;
            const rolled = frameAt(st, frameCount(st));
            const fin = new Map(st.final);
            const wrong = [];
            for (const [c, tt] of fin) {
              if (rolled.get(c) !== tt) {
                wrong.push(`${snap.roster[c]?.title ?? c}: walk ${rolled.get(c)} vs plan ${tt}`);
              }
            }
            const extra = [...rolled.keys()].filter(c => !fin.has(c));
            // ── Is the step's course the TOP of the queue? ─────────────
            //
            // The panel beside the grid claims the engine takes the next card off one sorted
            // list, so the course a step is about must be the first still-unplaced entry of the
            // recorded order. It is a claim about the search, not a rendering detail: if the DFS
            // ever places out of order — a seeded cell, a rung that re-sorts mid-attempt — the
            // panel would be captioning the step with the wrong reason, confidently.
            const rank = st.ranking ?? [];
            const seen = new Set();
            let top = 0;
            for (const s of st.place) {
              const next = rank.find(r => !seen.has(r.card));
              if (next && next.card === s.card) top += 1;
              seen.add(s.card);
            }
            // ── Do the bullets add up? ─────────────────────────────────
            //
            // The panel says "ahead of N that unlock nothing", "fewer than the M it ties with", and
            // so on, one bullet per key. Those counts are a partition of the cards still queued —
            // every rival is beaten by exactly one key — so they must SUM to the queue behind it.
            // If they do not, some rival is being counted twice or not at all and the sentences are
            // arithmetic nobody can check. Reported for the first step and the middle one.
            const whyAt = (k) => {
              const seenTo = new Set(st.place.slice(0, k).map(s => s.card));
              const rest = rank.filter(r => !seenTo.has(r.card));
              const why = orderWhy(rest[0], rest);
              const sum = why.reduce((n, w) => n + w.beat, 0);
              // ── Is the PRINCIPAL reason the first bullet? ────────────
              //
              // The panel bolds the key that separates the front card from the RUNNER-UP, on the
              // argument that losing that one key would put it second whatever else is true. The
              // cheap alternative — bold the first bullet — is the same thing only when the
              // highest-numbered test that beat anybody also beat the runner-up. This says how
              // often that is actually so; if it were always, the distinction would be theatre.
              const principal = orderReason(rest[0], rest[1])?.key ?? null;
              return { at: k, rivals: rest.length - 1, sum, ok: sum === rest.length - 1,
                       principal, firstBullet: why[0]?.key ?? null,
                       principalIsFirst: principal === (why[0]?.key ?? null),
                       bullets: why.map(w => `${w.key}${w.value != null ? `=${w.value}` : ""}x${w.beat}`) };
            };
            // ── Are FORCED cells decided FIRST? ────────────────────────
            //
            // `applyEarlyTerms` collapses an adopted cell to `domain = [at]`, so a cell the
            // department already placed is a variable with exactly ONE legal value. Assigning
            // it is not a decision — it is unit propagation, and standard practice is to do it
            // immediately, because until it is assigned every capacity check on that term is
            // reading room the cell is already going to consume.
            //
            // But `byConstraint` consults `filler` and then `rankOf` (claim) BEFORE domain
            // width, so a claim-bearing cell with eight legal terms outranks a forced one. This
            // counts how often that actually happens: `forcedAfterFree` is forced cells decided
            // after at least one cell that still had a choice, and `earlyAfterLate` is the
            // symptom a reader SEES — a card landing in the first four semesters after a card
            // has already landed in semester five or later.
            const width = new Map(rank.map(r => [r.card, r.terms ?? 0]));
            let forced = 0, forcedAfterFree = 0, freeSeen = 0;
            let earlyAfterLate = 0, lateSeen = 0, earlyPlaced = 0;
            for (const s of st.place) {
              if (width.get(s.card) === 1) {
                forced += 1;
                if (freeSeen) forcedAfterFree += 1;
              } else freeSeen += 1;
              if (s.term != null && s.term <= 3) {
                earlyPlaced += 1;
                if (lateSeen) earlyAfterLate += 1;
              } else if (s.term != null) lateSeen += 1;
            }
            // ── Is every FRAME a plan the engine could have held? ──────
            //
            // Reconciliation above is a claim about the last frame only, and for a long time it
            // was the only claim anyone made — so the view was free to draw anything on the way
            // there, and it did: replaying a pass's moves one at a time put 21 SH in a 19 SH
            // semester for two frames of Physics + Music Technology, over half the corpus
            // showing something of the kind. Every assignment either phase occupies is screened
            // by `fitsCapacity`, so a frame above `capSH` or `slots` is a state that never was.
            const over = [];
            for (let k = 0; k <= frameCount(st); k++) {
              const load = frameLoad(st, frameAt(st, k));
              st.terms.forEach((tm, ti) => {
                if (tm.capSH != null && load.sh[ti] > tm.capSH) {
                  over.push(`frame ${k} ${tm.full} ${load.sh[ti]} SH > cap ${tm.capSH}`);
                }
                if (tm.slots != null && load.slots[ti] > tm.slots) {
                  over.push(`frame ${k} ${tm.full} ${load.slots[ti]} slots > ${tm.slots}`);
                }
              });
            }
            return { via: st.via, place: st.place.length,
                     moves: st.passes.reduce((n, p) => n + p.moves.length, 0),
                     final: fin.size, rolled: rolled.size,
                     wrong: wrong.slice(0, 6), wrongN: wrong.length, extra: extra.length,
                     frames: frameCount(st) + 1, over: over.slice(0, 6), overN: over.length,
                     rank: rank.length, rankTop: top, rankTier: st.rankingTier,
                     forced, forcedAfterFree, earlyPlaced, earlyAfterLate,
                     why: [whyAt(0), whyAt(Math.floor(st.place.length / 2))],
                     passes: st.passes.map(p => `${p.pass}×${p.moves.length}`) };
          })(),
          // ── What the walkthrough can actually DRAW ───────────────────
          //
          // The derivation view renders the planner's own rows over the student's semesters, so
          // two things have to hold on every real recording and neither is visible from the plan:
          //
          //   the TERM JOIN — every term carries the `yearIndex` + `semTypeId` pair that lands it
          //   on a semester. A term missing it is a row the reader does not have, and the view
          //   falls back to the shape's words for it.
          //   the CARD SPLIT — how many cells name one course (drawn as a course card, striped by
          //   subject) against how many are requirements (drawn as a placeholder). The split is
          //   the whole argument for naming placeholders by their requirement rather than hatching
          //   them: measured here rather than assumed.
          walkGrid: (() => {
            const terms = snap.terms ?? [];
            const joined = terms.filter(t => t.semTypeId && t.yearIndex != null).length;
            const named = (snap.roster ?? []).filter(
              c => /^[A-Z]{2,5}\s*\d{3,4}$/.test(String(c.code ?? "").trim())).length;
            // The employment terms travel separately — `studyTerms` filters them out of the
            // search's list — and a plan whose co-ops never reach the recording is drawn without
            // them, which is how the view shipped a four-year degree with two co-ops missing.
            const wk = snap.workTerms ?? [];
            return {
              terms: terms.length, joined,
              work: wk.length, workJoined: wk.filter(t => t.semTypeId && t.yearIndex != null).length,
              workAt: wk.map(t => `${t.yearIndex}:${t.semTypeId}`).join(" "),
              join: terms.slice(0, 4).map(t => `${t.yearIndex}:${t.semTypeId}`).join(" "),
              cards: snap.roster?.length ?? 0, named,
              placeholders: (snap.roster?.length ?? 0) - named,
              sampleCode: (snap.roster ?? []).find(c => c.code)?.code ?? null,
              sampleTitle: (snap.roster ?? []).find(c => !c.code)?.title ?? null,
            };
          })(),
          tree: (() => {
            if (!model) return null;
            try {
              const t = searchTree(snap);
              // A node whose parent link points forward, or to the wrong level, means the
              // pre-order reconstruction is wrong — which would draw a plausible tree that
              // is not the search's.
              const bad = t.nodes.filter(nd => nd.parent >= nd.index
                || (nd.parent >= 0 && t.nodes[nd.parent].depth !== nd.depth - 1)).length;
              return { drawable: t.drawable, span: t.span, nodes: t.nodes.length,
                       depth: t.depth, width: t.width, badParents: bad };
            } catch (e) { return { threw: String(e?.message ?? e) }; }
          })(),
        };
        return;
      }
      if (r.refused) {
        refused++;
        // The detail too. "fails-hard-criteria" names WHICH term and WHICH criterion, and
        // without it the reason alone sends you back to a fresh script to find out.
        out[label] = { refused: r.refused.reason, detail: r.refused.detail ?? "" };
        return;
      }
      out[label] = { ...score(r.plan.plans[0], studentType), relaxed: r.report.relaxed ?? [] };
      if (showTerms) {
        console.log(`\n── ${label}${concentration ? ` · ${concentration}` : ""} ──`);
        for (const y of r.plan.plans[0].years ?? []) for (const t of y.terms ?? []) {
          const es = flat(t.entries).filter(e => !e.vacation && !e.heading);
          if (!es.length) continue;
          const big = es.filter(e => (e.sh ?? 0) >= chartCalibration.realCourseSH).length;
          const sh = es.reduce((a, e) => a + (e.sh ?? 0), 0);
          const half = /summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`);
          const coop = es.some(e => e.coop);
          const flagStr = (!half && !coop && minCoursesFor(chartCalibration, studentType) > 0
            && big < minCoursesFor(chartCalibration, studentType)) ? "SHORT" : "     ";
          console.log(`  ${`${y.label} ${t.term}`.padEnd(17)}${flagStr} big=${big} ${String(sh).padStart(2)}SH  `
            + es.map(e => e.text).join(" | ").slice(0, 56));
        }
      }
    });
  }
}

const rows = Object.entries(out);
// ── A thrown plan must be LOUD ──────────────────────────────────────
//
// Counted and printed first, because a swallowed exception looks exactly like a perfect
// score: every plan throwing reports 0 short, 0 empty and 0 unguided, which is the most
// encouraging output this tool can produce and the least true. Caught once, by the numbers
// being impossibly good rather than by the tool saying so.
const threw = rows.filter(([, v]) => v.threw);
if (threw.length) {
  console.error(`✗ ${threw.length} of ${rows.length} plans THREW — every number below is meaningless`);
  for (const [k, v] of threw.slice(0, 3)) console.error(`   ${k}: ${v.threw}`);
}
const tot = (k) => rows.reduce((n, [, v]) => n + (v[k] ?? 0), 0);

if (concentrationsMode) {
  const stat = (xs, label) => {
    if (!xs.length) { console.log(`  ${label}: none`); return null; }
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const q1 = 100 * s.filter(x => x < 0.25).length / s.length;
    console.log(`  ${label.padEnd(12)} n=${String(s.length).padStart(4)}  mean ${mean.toFixed(3)}`
      + `  p10 ${at(0.1).toFixed(2)}  med ${at(0.5).toFixed(2)}  p90 ${at(0.9).toFixed(2)}`
      + `  first quarter ${q1.toFixed(1)}%`);
    return { mean, q1 };
  };
  console.log("Concentration cell POSITION, as a fraction through the plan");
  const d = stat(deptPos, "DEPARTMENTS");
  const c = stat(chartPos, "CHART");
  if (d && c) {
    // The gate. Being LATER than the departments is the failure this watches for — CHART exists
    // because departments spend the flexible credit too early, and overshooting the correction
    // reproduces the defect at the other end.
    const dm = c.mean - d.mean, dq = c.q1 - d.q1;
    console.log(`\n  CHART - DEPARTMENTS: mean ${dm >= 0 ? "+" : ""}${dm.toFixed(3)}`
      + `   first quarter ${dq >= 0 ? "+" : ""}${dq.toFixed(1)} pts`);
    console.log(`  ${dm > 0.04 ? "✗ LATER than the corpus by more than 0.04 — the preference overshot"
      : dm < -0.06 ? "✗ EARLIER than the corpus by more than 0.06"
      : "✓ within 0.04 of the corpus"}`);
  }
  process.exit(0);
}

if (electivesMode) {
  const ok = rows.filter(([, v]) => !v.threw).map(([k, v]) => ({ key: k, ...v }));
  const withGE = ok.filter(r => r.ge > 0);
  console.log(`${ok.length} undergraduate degrees   ${withGE.length} with a general-elective pool`);
  // The split, which is rule 1. Printed as a distribution rather than a mean, because the
  // small-pool case is a SHAPE and a mean over it says nothing.
  const allBreadth = withGE.filter(r => r.depth <= 0).length;
  console.log(`  rule 1 — pool is ALL breadth (depth <= 0)   ${allBreadth}`
    + `  (${(100 * allBreadth / Math.max(1, withGE.length)).toFixed(1)}%)`);
  console.log(`  rule 1 — median pool ${median(withGE.map(r => r.ge))}`
    + `  breadth ${median(withGE.map(r => r.breadth))}`
    + `  depth ${median(withGE.map(r => r.depth))}`
    + `  unmet codes ${median(withGE.map(r => r.remaining))}`);
  // The invariant that matters: the arithmetic above and the cells `deriveCells` emitted must
  // agree. A mismatch means rule 1 and rule 3 disagree about which cells exist.
  const mismatch = ok.filter(r => r.emittedBreadth !== r.breadth || r.emittedDepth !== r.depth);
  console.log(`  emitted roles DISAGREE with the split          ${mismatch.length}`
    + (mismatch.length ? `   e.g. ${mismatch.slice(0, 3).map(r => r.key).join(", ")}` : ""));

  // ── Rule 4's comparand, both candidates ──────────────────────────
  //
  // The rule needs a number that separates a SHALLOW major from a DEEP one. Whichever
  // candidate has a usable spread across degrees can carry the comparison; one that is
  // constant tells an elective the same thing everywhere and is therefore not a comparand.
  const lv = withGE.map(r => r.levelMed).filter(v => v != null);
  const ht = withGE.map(r => r.heightMed).filter(v => v != null);
  const htMax = withGE.map(r => r.heightMax).filter(v => v != null);
  const dist = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    return `p10 ${at(0.1)}  med ${at(0.5)}  p90 ${at(0.9)}  max ${s[s.length - 1]}`;
  };
  console.log(`  rule 4 cand A — major median LEVEL target   ${dist(lv)}`);
  console.log(`  rule 4 cand B — major median CHAIN height   ${dist(ht)}`);
  console.log(`  rule 4 cand B — major MAX chain height      ${dist(htMax)}`);
  const distinctLv = new Set(lv).size, distinctHt = new Set(ht).size;
  console.log(`  distinct values: level ${distinctLv}, chain-height-median ${distinctHt},`
    + ` chain-height-max ${new Set(htMax).size}`);
  for (const name of ["international_business", "computer_science_and_mathematics"]) {
    const r = ok.find(x => x.key.includes(name));
    if (r) {
      console.log(`  · ${r.key}`);
      console.log(`      ge ${r.ge}  unmet ${r.remaining}  breadth ${r.breadth}  depth ${r.depth}`
        + `   majorNamed ${r.majorNamed}`);
      console.log(`      level med ${r.levelMed} max ${r.levelMax}`
        + `   chain height med ${r.heightMed} max ${r.heightMax}`);
    }
  }
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`  → ${jsonOut}`); }
  process.exit(0);
}

if (traceMode) {
  const ok = rows.filter(([, v]) => !v.threw);
  const differ = ok.filter(([, v]) => !v.same);
  console.log(`${ok.length} plans traced   IDENTICAL ${ok.length - differ.length}`
    + `   DIFFERENT ${differ.length}`);
  // Loud, and first. A trace that changes a plan is the same class of defect as a propagator
  // that rewrites what it was asked to check, and the whole view is worthless if it is true.
  if (differ.length) {
    console.error(`✗ the trace CHANGED the plan for ${differ.length} of ${ok.length}`);
    for (const [k] of differ.slice(0, 5)) console.error(`   ${k}`);
  }
  for (const [k, v] of ok) {
    console.log(`  ${k.padEnd(46)} nodes ${String(v.nodes).padStart(6)}`
      + `  recorded ${String(v.recorded).padStart(6)}${v.truncated ? " TRUNC" : "      "}`
      + `  attempts ${String(v.attempts).padStart(3)}  stages ${String(v.stages).padStart(3)}`
      + `  rejects ${String(v.rejects).padStart(7)}`
      + `  ${String(v.msPlain).padStart(5)} → ${String(v.msTraced).padStart(5)} ms`);
    console.log(`      ${v.saturated ? "SATURATED" : "small    "}`
      + `  answered=${String(v.answered).padEnd(9)}`
      + `  tree ${v.tree?.drawable ? `${v.tree.nodes}n d${v.tree.depth} w${v.tree.width}` : "not drawable"}`
      + `  badParents ${v.tree?.badParents ?? "-"}`
      + `  buckets ${v.buckets}${v.exact ? " exact" : ""}`
      + `  fates ${v.fateSum}/${v.fateExpect}`
      + `  top ${v.topCause ?? "-"}`);
    console.log(`      ${v.stageKeys}`);
    if (v.steps) {
      console.log(`      steps via=${v.steps.via} place=${v.steps.place} moves=${v.steps.moves}`
        + ` final=${v.steps.final} rolled=${v.steps.rolled} WRONG=${v.steps.wrongN}`
        + ` extra=${v.steps.extra}  frames=${v.steps.frames} OVER=${v.steps.overN}`
        + `  passes=${v.steps.passes.join(",")}`);
      for (const o of v.steps.over) console.log(`        ✗ ${o}`);
      // The ordering question, per plan: how many cells with ONE legal term were decided after
      // a cell that still had a choice, and how many first-four-semester placements happened
      // after a later semester had already been filled.
      console.log(`      order forced=${v.steps.forced}`
        + ` afterFree=${v.steps.forcedAfterFree}`
        + `   early=${v.steps.earlyPlaced} afterLate=${v.steps.earlyAfterLate}`);
      for (const w of v.steps.wrong) console.log(`        ${w}`);
    }
    if (v.modelErr) console.error(`      ✗ deriveModel threw: ${v.modelErr}`);
  }
  // The three invariants of the reduction, checked over real recordings rather than argued.
  const modelBad = ok.filter(([, v]) => v.modelErr);
  const fateBad = ok.filter(([, v]) => v.fateSum !== v.fateExpect);
  const parentBad = ok.filter(([, v]) => (v.tree?.badParents ?? 0) > 0);
  console.log(`  deriveModel threw ${modelBad.length}`
    + `   fate coverage wrong ${fateBad.length}`
    + `   tree parent links wrong ${parentBad.length}`);
  // ── How many CATEGORIES the narrowing matrix actually needs ────────
  const allFates = {};
  for (const [, v] of ok) for (const [k, c] of Object.entries(v.fates ?? {})) {
    allFates[k] = (allFates[k] ?? 0) + c;
  }
  const fTot = Object.values(allFates).reduce((a, b) => a + b, 0) || 1;
  console.log("  fate distribution over every (card, term) pair:");
  for (const [k, c] of Object.entries(allFates).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(26)} ${String(c).padStart(7)}  ${(100 * c / fTot).toFixed(1)}%`
      + `   in ${ok.filter(([, v]) => (v.fates?.[k] ?? 0) > 0).length}/${ok.length} plans`);
  }
  const sat = ok.filter(([, v]) => v.saturated).length;
  const drawable = ok.filter(([, v]) => v.drawableTree).length;
  const nodeList = ok.map(([, v]) => v.nodes).sort((a, b) => a - b);
  const q = (p) => nodeList[Math.min(nodeList.length - 1, Math.floor(p * nodeList.length))];
  console.log(`  nodes p10 ${q(0.1)}  p50 ${q(0.5)}  p90 ${q(0.9)}  max ${nodeList[nodeList.length - 1]}`);
  console.log(`  saturated ${sat}/${ok.length}   tree drawable ${drawable}/${ok.length}`);
  // The overhead, as a share of the clock the search shares with its own fallback tiers. This
  // is the number that decides whether the sink is safe: `placeCells` refuses when the clock
  // runs out, so the only way tracing can change an answer is by being slow.
  const msP = ok.reduce((a, [, v]) => a + v.msPlain, 0);
  const msT = ok.reduce((a, [, v]) => a + v.msTraced, 0);
  console.log(`  clock  ${msP} ms untraced → ${msT} ms traced`
    + `   overhead ${msP ? (100 * (msT - msP) / msP).toFixed(1) : "0.0"}%`);
  // Every node the engine counted must appear in the recording. A gap means a `step()` path
  // returns without recording its result, which is the failure mode that would show up in the
  // profile as a search that ends early for no reason.
  const lost = ok.filter(([, v]) => v.recorded < v.nodes && !v.truncated);
  console.log(`  nodes recorded < nodes counted (and not truncated)   ${lost.length}`);
  if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`  → ${jsonOut}`); }
  process.exit(differ.length || lost.length ? 1 : 0);
}

console.log(`${rows.length} plans   refused ${refused}   threw ${threw.length}`);
console.log(`  SHORT of four real courses  ${tot("short")}`);
console.log(`  EMPTY full terms            ${tot("empty")}`);
console.log(`  terms with 3+ UNGUIDED      ${tot("unguided3")}`);
console.log(`  terms with 3+ GEN ELECTIVES ${tot("ge3")}   worst term `
  + `${rows.reduce((m, [, v]) => Math.max(m, v.geMax ?? 0), 0)}`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`  → ${jsonOut}`); }

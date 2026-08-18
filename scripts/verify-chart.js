#!/usr/bin/env node
/**
 * verify-chart.js — generate every plan CHART can produce and refuse the build if any of
 * them breaks a hard rule.
 *
 * ── What this buys that a test does not ─────────────────────────────
 *
 * `test/invariant/chart-hard-rules.test.js` checks a SAMPLE, sized so it can run after every
 * change. This checks everything: all ~748 degrees against every published variant, at the
 * production time budget. It is the difference between "no regression in the shapes we
 * sampled" and "no violating plan exists".
 *
 * That matters because the inputs move monthly. The catalog is re-scraped on the 1st and the
 * program requirements bimonthly, both pushing straight to `main` unattended. A course whose
 * offering history tips past the 50% availability bar, or a requirement section that gains a
 * course, can turn a clean plan into one with a hard error — with no code change to review.
 * Run in the workflow, this makes that unshippable rather than unnoticed.
 *
 * ── Why it verifies and does not (yet) ship the plans ───────────────
 *
 * The obvious next step is to commit the generated plans as JSON siblings, the way
 * `plan-order.json` already works: the browser would do no solving, the time budget would
 * disappear, and the solver could be exact rather than budgeted.
 *
 * It is not done here because ~1,350 plans at 10–30 KB is roughly 15 MB of generated JSON,
 * re-emitted monthly, in a repository whose entire committed plan corpus today is 385 files.
 * That is a real cost and a separate decision, and it is not needed for the guarantee — the
 * guarantee comes from the gate, not from the artifact. Deciding to ship them later changes
 * only where the output of this script goes.
 *
 * ── Exit codes ──────────────────────────────────────────────────────
 *
 *   0  every generated plan passes every hard rule
 *   1  at least one hard violation — the reason and the plans are printed
 *   2  the run itself looks broken: a throw, or coverage collapsed
 *
 * The last one is the same rail `scrape-rails.js` applies. A run that generates almost
 * nothing would pass every other check vacuously, which is the failure mode that lets a gate
 * report success while doing nothing.
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/engine/index.js";
import { evalPrereqTree } from "../src/core/prereqEval.js";
import { minCoursesFor } from "../src/engine/calibration.js";
import { buildDepthIndex } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { gatePlan } from "./lib/chart-gate.js";
import { fingerprintPlan, canonicalPlan } from "./lib/chart-fingerprint.js";
import { specForNode } from "../src/core/programEligibility.js";
import { programIdentity } from "../src/core/programIdentity.js";
import { materialize } from "../src/core/candidateSpec.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Share of shapes that must still generate.
 *
 * Not a coverage target — the honest figure is well below 1 and is reported, not asserted.
 * This only catches a run that has collapsed, for the same reason the invariant suite guards
 * against an empty corpus: every other check here passes trivially when nothing is emitted.
 */
const MIN_GENERATED_RATIO = 0.40;

function degreePrograms() {
  const out = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, "data/northeastern/programs", lvl, "2026");
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const key of readdirSync(cd)) {
        const rf = join(cd, key, "requirements.json");
        if (!existsSync(rf)) continue;
        const data = JSON.parse(readFileSync(rf, "utf8"));
        if (!(data.requirementSections ?? []).length) continue;
        if (!(data.totalCreditsRequired > 0)) continue;
        const pf = join(cd, key, "plan.json");
        out.push({ lvl, key, data,
                   plan: existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null });
      }
    }
  }
  return out;
}

const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };
// Borrowed first semesters for the shapes whose department publishes no plan. Read off
// disk rather than fetched, for the same reason the order is: this runs in Node.
const donorFile = join(ROOT, "public/northeastern/early-donors.json");
const earlyDonors = existsSync(donorFile)
  ? (JSON.parse(readFileSync(donorFile, "utf8")).programs ?? {}) : {};

/**
 * `--limit N` checks only the first N degrees.
 *
 * For smoke-testing this script, never for the workflow. A partial run proves the plumbing
 * and proves nothing about the corpus, so it says so loudly and exits 3 rather than 0 — a
 * green tick over twenty programs is worse than no tick at all, because someone will quote it.
 */
const limitAt = process.argv.indexOf("--limit");
const LIMIT = limitAt > -1 ? Number(process.argv[limitAt + 1]) : Infinity;

/**
 * `--fingerprint <path>` also writes a hash of every plan produced.
 *
 * The sweep already generates all of them, so this is free, and it is what makes "this change
 * moved nothing" checkable: snapshot, change, snapshot, `chart-fingerprint-diff`. See
 * `lib/chart-fingerprint.js` for why there is no committed baseline.
 */
const fpAt = process.argv.indexOf("--fingerprint");
const FINGERPRINT = fpAt > -1 ? process.argv[fpAt + 1] : null;
const prints = {};

const degrees = Number.isFinite(LIMIT) ? degreePrograms().slice(0, LIMIT) : degreePrograms();
const violations = [];
const refusals = new Map();
const gave = new Map();
let shapes = 0, made = 0, threw = 0, relaxed = 0;
let thin = 0, fullTerms = 0, emptyFull = 0;

/**
 * The quality vector, accumulated over every plan produced.
 *
 * Reported and not gated. Its purpose is that a property expressed only as branch ORDER in the
 * search — which can guarantee nothing — cannot regress silently. Two days of work found these
 * defects one at a time by accident; a number printed every run finds them the run they appear.
 */
const Q = {
  clumped: 0, studyTerms: 0, fillerCount: 0, fillerPositionSum: 0,
  loadSpreadSum: 0, longestEmptyRun: 0, plansWithGap: 0,
  choicePairs: 0, choiceCollapsed: 0, choiceTight: 0, plansWithForcedChoice: 0,
  choiceP10s: [],
  unguidedMax: 0, unguidedOver2: 0, unguidedOver3: 0,
  geMax: 0, geOver2: 0, geOver1: 0,
};
// Plans whose concentration reservations cannot be filled under some option, and the programs
// they belong to. Counted separately from `violations` while the engine still emits them, so the
// figure is legible on its own rather than folded into a hard-rule tally.
const R = { plans: 0, programs: new Set(), concPlans: 0, concPrograms: new Set() };

/**
 * Every concentration a student of this program could still pick, as course ids.
 *
 * Read with core's spec reader, not the engine's: what an option CONTAINS is a fact about the
 * catalog, and the gate has to be able to disagree with the engine about scheduling while
 * agreeing with it about the data. Options naming nothing enumerable are dropped, because an
 * unbounded pool supports no claim either way.
 */
const poolCache = new Map();
function optionPools(programData) {
  const options = programData?.concentrations?.concentrationOptions ?? [];
  if (options.length < 2 || (programData.concentrations?.minOptions ?? 1) < 1) return [];
  if (poolCache.has(programData)) return poolCache.get(programData);
  const pools = [];
  for (const o of options) {
    let ids = [];
    try { ids = [...materialize(specForNode(o), courseMap)]; } catch { continue; }
    if (ids.length) pools.push({ title: o.title ?? "(untitled concentration)", ids });
  }
  poolCache.set(programData, pools);
  return pools;
}

for (const d of degrees) {
  const variants = d.plan?.plans?.length ? d.plan.plans : [null];
  variants.forEach((variant, vi) => {
    shapes++;
    const studentType = d.lvl === "graduate" ? "graduate" : "undergraduate";
    // The LEVEL is part of the identity. Without it the sweep reported 647 plans and only
    // 643 fingerprints: an undergraduate and a graduate program can share a folder key
    // (`cybersecurity_*`), so four snapshot entries silently overwrote each other and four
    // plans were exempt from the very comparison the snapshot exists to make.
    const label = `${d.lvl === "graduate" ? "grad" : "ug"}/${d.key}`
      + (variants.length > 1 ? `#${vi}` : "");
    let out;
    try {
      out = generatePlan({
        program: d.data, publishedPlan: variant, courseMap, ports, depthIndex,
        observedOrder: observed.edges,
        positions: observed.positions ?? null,
        coopPrep: (observed.coopPrep ?? []).map(x => x.course),
        donorPlan: variant ? null : (earlyDonors[programIdentity(d.data)]?.plan ?? null),
        studentType, calibration: chartCalibration, timeBudgetMs: 5000,
      });
    } catch (err) {
      threw++;
      violations.push({ label, kind: "threw", detail: String(err?.message ?? err) });
      return;
    }
    if (out.refused) {
      refusals.set(out.refused.reason, (refusals.get(out.refused.reason) ?? 0) + 1);
      return;
    }
    made++;
    // What a fallback rung actually gave up, per plan. Counting `cardinalityRelaxed` here
    // printed "four-course bound relaxed in 27 plans" while the bound was relaxed in none —
    // the flag was stale and the 27 were simply plans that reached a fallback rung. Reporting
    // the named conventions cannot go stale, because the names come from the ladder itself.
    if (out.report.cardinalityRelaxed) relaxed++;
    for (const g of out.report.relaxed ?? []) gave.set(g, (gave.get(g) ?? 0) + 1);
    if (FINGERPRINT) {
      prints[label] = {
        hash: fingerprintPlan(out.plan.plans[0]),
        // The readable form too, so a moved hash can be explained rather than merely
        // detected. A pair of hashes says something changed and nothing about what.
        canonical: canonicalPlan(out.plan.plans[0]),
      };
    }

    const g = gatePlan({
      plan: out.plan.plans[0], courseMap,
      offered: (id, season) => ports.offered(id, season),
      evalPrereqTree,
      creditCap: ports.creditMax(studentType),
      minCourses: minCoursesFor(chartCalibration, studentType),
      realCourseSH: chartCalibration.realCourseSH,
      // Every concentration still open to this student. These plans are generated without a
      // pick, so a cell reserved for the concentration has to be answerable under EVERY one.
      concentrationOptions: optionPools(d.data),
    });
    thin += g.thin.length;
    fullTerms += g.fullTerms;
    emptyFull += g.emptyFull.length;
    Q.clumped += g.quality.clumped;
    Q.studyTerms += g.quality.studyTerms;
    Q.fillerCount += g.quality.fillerCount;
    Q.fillerPositionSum += g.quality.fillerPositionSum;
    Q.loadSpreadSum += g.quality.loadSpread;
    Q.longestEmptyRun = Math.max(Q.longestEmptyRun, g.quality.longestEmptyRun);
    Q.plansWithGap += g.quality.longestEmptyRun > 0 ? 1 : 0;
    Q.choicePairs += g.quality.choicePairs;
    Q.choiceCollapsed += g.quality.choiceCollapsed;
    Q.choiceTight += g.quality.choiceTight;
    Q.plansWithForcedChoice += g.quality.choiceCollapsedHere ? 1 : 0;
    if (g.quality.choiceP10 != null) Q.choiceP10s.push(g.quality.choiceP10);
    Q.unguidedMax = Math.max(Q.unguidedMax, g.quality.unguidedMax);
    Q.unguidedOver2 += g.quality.unguidedOver2;
    Q.unguidedOver3 += g.quality.unguidedOver3;
    Q.geMax = Math.max(Q.geMax, g.quality.geMax);
    Q.geOver2 += g.quality.geOver2;
    Q.geOver1 += g.quality.geOver1;
    if (optionPools(d.data).length) { R.concPlans++; R.concPrograms.add(label.split("#")[0]); }
    if (g.reservations.length) { R.plans++; R.programs.add(label.split("#")[0]); }
    if (!g.ok) {
      violations.push({
        label, kind: "hard-rule",
        order: g.order.slice(0, 4), availability: g.availability.slice(0, 4),
        overCap: g.overCap.slice(0, 4), reservations: g.reservations.slice(0, 4),
      });
    }
  });
}

const ratio = shapes ? made / shapes : 0;
console.log(`\nCHART verification — ${degrees.length} degrees, ${shapes} shapes`);
console.log(`  generated ${made} (${(100 * ratio).toFixed(1)}%)   refused ${shapes - made - threw}   threw ${threw}`);
console.log(`  reached a fallback rung ${gave.size ? [...gave.entries()]
  .sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") : "0 plans"}`
  + (relaxed ? `   (four-course bound genuinely relaxed in ${relaxed})` : ""));
console.log(`  thin full terms ${thin} of ${fullTerms} (${(100 * thin / (fullTerms || 1)).toFixed(1)}%)  — reported, not gated`);
// Counted separately because it is WORSE than thin and was previously invisible: `gatePlan`
// skipped terms with no cells, so an empty fall or spring passed silently. See chart-gate.js.
console.log(`  EMPTY full terms ${emptyFull}  — a semester the student is not enrolled in`);
// The half of the gate that named courses cannot reach. Printed unconditionally, including the
// denominator, because "0 unfillable" only means something beside how many plans were EXPOSED to
// the question — the previous version of this gate scored zero here by not asking.
console.log(`  concentration reservations UNFILLABLE under some option  ${R.plans} of `
  + `${R.concPlans} plans (${R.programs.size} of ${R.concPrograms.size} programs)`);

// ── Quality, with the corpus baseline beside each number ────────────
//
// A bare figure is not reviewable: "14.3% of terms are clumped" only means something next to
// the departments' 0.7%. Every baseline here is measured over the published plans and recorded
// in domains.js or calibration.js — this prints ours against theirs so a regression is obvious
// without anyone having to remember what good looks like.
const pct = (n, d) => `${(100 * n / Math.max(1, d)).toFixed(1)}%`;
console.log(`\n  ── quality (reported, never gated) ──`);
console.log(`  3+ cells of one requirement in a term   ${Q.clumped} of ${Q.studyTerms} `
  + `(${pct(Q.clumped, Q.studyTerms)})    departments: 0.7%`);
// Criterion 3. The bound is the departments' own: over 5,978 published undergraduate study
// terms they leave <=2 cells unguided in 98.8%, 3 in 55 and 4 in 14. Past two they NAME the
// cell, which is why this counts unguidedness and not placeholders — see chart-gate `isUnguided`.
console.log(`  terms leaving 3+ cells UNGUIDED         ${Q.unguidedOver2} of ${Q.studyTerms} `
  + `(${pct(Q.unguidedOver2, Q.studyTerms)})    departments: 1.2%`);
console.log(`  terms with 3+ GENERAL ELECTIVES         ${Q.geOver2} of ${Q.studyTerms} `
  + `(${pct(Q.geOver2, Q.studyTerms)})   with 2+: ${Q.geOver1} (${pct(Q.geOver1, Q.studyTerms)})`
  + `   worst term ${Q.geMax}`);
console.log(`  terms leaving 4+ cells unguided         ${Q.unguidedOver3} of ${Q.studyTerms} `
  + `(${pct(Q.unguidedOver3, Q.studyTerms)})    departments: 0.2%   worst term ${Q.unguidedMax}`);
console.log(`  mean placeholder position                `
  + `${(Q.fillerPositionSum / Math.max(1, Q.fillerCount)).toFixed(3)}`
  + `                    departments: 0.601`);
console.log(`  mean credit spread within a plan         `
  + `${(Q.loadSpreadSum / Math.max(1, made)).toFixed(1)} SH`);
console.log(`  plans with an empty-semester GAP         ${Q.plansWithGap} of ${made} `
  + `(${pct(Q.plansWithGap, made)})   longest run ${Q.longestEmptyRun} terms`);
// ── A reservation that is fillable but not choosable ────────────────
//
// Reported per PLAN as well as per pair, because the per-pair rate is not one anybody
// experiences: 1.1% of (cell, option) pairs was 3.3% of students, and quoting only the first is
// the denominator error this corpus has now made three times. See docs/chart-open-defects.md §15.
if (Q.choicePairs) {
  const p10s = [...Q.choiceP10s].sort((a, b) => a - b);
  console.log(`  reservations that are a FORCED pick      ${Q.choiceCollapsed} of ${Q.choicePairs} `
    + `(cell, option) pairs offer <=1 course; ${Q.choiceTight} offer <=2`);
  console.log(`  plans containing a forced reservation    ${Q.plansWithForcedChoice} of ${made} `
    + `(${pct(Q.plansWithForcedChoice, made)})   median plan p10 choice `
    + `${p10s.length ? p10s[Math.floor(p10s.length / 2)] : "—"} courses`);
}
if (refusals.size) {
  console.log(`  refusals: ${[...refusals.entries()].sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`).join(", ")}`);
}

if (FINGERPRINT) {
  writeFileSync(FINGERPRINT, JSON.stringify({
    meta: { shapes, made, at: new Date().toISOString() }, plans: prints,
  }, null, 1));
  console.log(`  fingerprints for ${Object.keys(prints).length} plans → ${FINGERPRINT}`);
}

if (threw) {
  console.error(`\n✗ ${threw} shapes threw. Generation must return a refusal, never throw.`);
}
// Not on a `--limit` run: on ten degrees the ratio is sampling noise, and a rail that fires
// on noise trains people to pass a flag to silence it.
if (!Number.isFinite(LIMIT) && ratio < MIN_GENERATED_RATIO) {
  console.error(`\n✗ only ${(100 * ratio).toFixed(1)}% of shapes generated (floor `
    + `${(100 * MIN_GENERATED_RATIO).toFixed(0)}%). Every check below passes trivially when `
    + `nothing is emitted, so this is treated as a broken run rather than a coverage figure.`);
  process.exit(2);
}
if (threw) process.exit(2);

const hard = violations.filter(v => v.kind === "hard-rule");
if (hard.length) {
  console.error(`\n✗ ${hard.length} generated plans break a hard rule:\n`);
  for (const v of hard.slice(0, 25)) {
    const parts = [];
    if (v.order.length) parts.push(`ORDER ${v.order.join(", ")}`);
    if (v.availability.length) parts.push(`AVAILABILITY ${v.availability.join(", ")}`);
    if (v.overCap.length) parts.push(`OVER CAP ${v.overCap.join(", ")}`);
    if (v.reservations?.length) parts.push(`UNFILLABLE ${v.reservations.join("; ")}`);
    console.error(`   ${v.label}\n     ${parts.join("\n     ")}`);
  }
  if (hard.length > 25) console.error(`   … and ${hard.length - 25} more`);
  console.error(`\nA plan that breaks one of these cannot be registered for. Fix the engine or `
    + `the data — do not relax the gate.`);
  process.exit(1);
}

if (Number.isFinite(LIMIT)) {
  console.log(`\n~ ${degrees.length} degrees checked and clean — but this was a --limit run. `
    + `The plumbing works; the corpus is NOT verified. Exiting 3 so nothing mistakes this `
    + `for a pass.`);
  process.exit(3);
}

console.log(`\n✓ every generated plan passes every hard rule`);

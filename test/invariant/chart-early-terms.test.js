// ═══════════════════════════════════════════════════════════════════
// The first four terms follow the department, or this fails.
//
// `EARLY_SEED_TERMS` lets a published placement outrank the level and unlock preferences
// inside the first four study terms. That is a claim about OUTCOMES over a corpus, not a
// property of one function — a branch order guarantees nothing on its own, and the same
// hint has already been added, measured, restricted and re-scoped once. So it is asserted
// the only way it can be: generate, compare against the department, and ratchet.
//
// The floor is deliberately below the measured value. This is here to catch the number
// collapsing — a hint that stops reaching the search, an index space that drifts again —
// not to freeze a figure that legitimately moves when the catalog is re-scraped.
// ═══════════════════════════════════════════════════════════════════
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../../src/engine/index.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../../src/adapters/northeastern/chartCalibration.js";
import { EARLY_TERMS } from "../../src/engine/earlyTerms.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

/**
 * Measured 55.9% over 60 undergraduate programs with a frozen clock, against 53.4%
 * with the early window switched off. The floor is 45%: far enough below to survive a
 * re-scrape and a different sample, high enough that losing the mechanism trips it.
 */
const MIN_FIRST_TERM_AGREEMENT = 0.45;

const TYPES = ["fall", "spring", "sumA", "sumB"];

/** A plan as study terms, in order — the same reading the engine's index uses. */
function studyTermsOf(plan) {
  const out = [];
  for (const year of plan?.years ?? []) {
    const ts = [...(year.terms ?? [])].sort(
      (a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type));
    for (const term of ts) {
      if (TYPES.indexOf(term.type) < 0) continue;
      const named = new Set();
      let coop = false, cells = 0;
      const walk = (e) => {
        if (e.vacation || e.heading || e.either) return;
        if (e.coop) { coop = true; return; }
        cells += 1;
        for (const g of (e.options ?? [])) for (const id of g) named.add(id);
        for (const c of (e.children ?? [])) walk(c);
      };
      for (const e of (term.entries ?? [])) walk(e);
      if ((coop && cells === 0) || cells === 0) continue;
      out.push(named);
    }
  }
  return out;
}

function degreesWithPlans() {
  const out = [];
  const base = join(ROOT, "data/northeastern/programs/undergraduate/2026");
  if (!existsSync(base)) return out;
  for (const col of readdirSync(base)) {
    const cd = join(base, col);
    if (!statSync(cd).isDirectory()) continue;
    for (const key of readdirSync(cd)) {
      const rf = join(cd, key, "requirements.json");
      const pf = join(cd, key, "plan.json");
      if (!existsSync(rf) || !existsSync(pf)) continue;
      const data = JSON.parse(readFileSync(rf, "utf8"));
      if (!(data.requirementSections ?? []).length) continue;
      if (!(data.totalCreditsRequired > 0)) continue;
      if (/,\s*Minor$/i.test(data.name ?? "")) continue;
      const plan = JSON.parse(readFileSync(pf, "utf8"));
      if (!(plan.plans ?? []).length) continue;
      out.push({ key, data, variant: plan.plans[0] });
    }
  }
  return out;
}

/** Seeded shuffle: the corpus is ordered by college and its alphabetical head is atypical. */
function sample(list, n) {
  let seed = 0x5eed;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return list.map(x => [rnd(), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
}

const N = process.env.CHART_CORPUS === "all" ? Infinity : 40;
const PROGRAMS = sample(degreesWithPlans(), N);
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };

let agreed = 0, judged = 0, generated = 0, laterBy2Plus = 0;
for (const p of PROGRAMS) {
  const out = generatePlan({
    program: p.data, publishedPlan: p.variant, courseMap, ports, depthIndex,
    observedOrder: observed.edges,
    coopPrep: (observed.coopPrep ?? []).map(x => x.course),
    positions: observed.positions ?? null,
    studentType: "undergraduate", calibration: chartCalibration,
    // Frozen, so a slow machine cannot turn this into a coverage question. The engine
    // exposes `now` precisely for this, and with it the search is bounded by nodes.
    now: () => 0, timeBudgetMs: 5000,
    repeatable: (id) => !!courseMap[id]?.repeatable,
  });
  if (out.refused) continue;
  generated += 1;
  const ours = studyTermsOf(out.plan.plans[0]);
  const theirs = studyTermsOf(p.variant);
  const at = (id) => ours.findIndex(s => s.has(id));
  for (const id of (theirs[0] ?? new Set())) {
    // Only courses the engine could have placed at all.
    if (!courseMap[id]) continue;
    judged += 1;
    const landed = at(id);
    if (landed === 0) agreed += 1;
    else if (landed > 1) laterBy2Plus += 1;
  }
}

console.log(`  [early terms] ${generated} plans · first-term agreement `
  + `${judged ? (100 * agreed / judged).toFixed(1) : "n/a"}% of ${judged} courses · `
  + `${laterBy2Plus} pushed two or more terms late`);

test("early terms › the sample generated something to measure", () => {
  // Every assertion below passes trivially over nothing.
  assert.ok(generated > 10, `only ${generated} plans generated`);
  assert.ok(judged > 50, `only ${judged} first-term courses to judge`);
});

test("early terms › the window is four, and the engine agrees it is", () => {
  // A guard against the constant being tuned without the ratchet below being re-measured.
  assert.equal(EARLY_TERMS, 4);
});

test("early terms › CHART puts the department's first-term courses in term one", () => {
  const rate = judged ? agreed / judged : 0;
  assert.ok(rate >= MIN_FIRST_TERM_AGREEMENT,
    `first-term agreement ${(100 * rate).toFixed(1)}% is below the ${(100 * MIN_FIRST_TERM_AGREEMENT)}% `
    + `floor — the department's arrangement is no longer reaching the search, or its term `
    + `index has drifted out of the domain's space again (see earlyTerms.js)`);
});

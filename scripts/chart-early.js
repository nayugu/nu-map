#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// CHART EARLY — does the generated plan's first two years match the department's?
//
// `chart-drift` scores sequencing against the corpus as a whole and `verify-chart` scores
// hygiene. Neither answers the one question the early-terms rule is stated in: for the
// courses a department puts in term N, where did we put them?
//
// Reports per-term agreement for terms 1..4 plus the two failure modes that matter, because
// they are not symmetric — a course one term late is a scheduling difference, a course four
// years late is a different degree:
//
//     agree      we put it in the department's own term
//     late 1     one term later
//     late 2+    two or more terms later
//     missing    never placed at all
//
// And the coverage number, which `docs/chart-success-criteria.md` §2 makes the FIRST thing to
// check rather than the last: a change that reduces the generated count has to pay for itself.
//
// Usage:
//   node scripts/chart-early.js                 # 60-program sample, current settings
//   node scripts/chart-early.js --all           # the whole undergraduate corpus
//   node scripts/chart-early.js --off           # with the department's arrangement OFF
//   node scripts/chart-early.js --n 120 --json out.json
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../src/engine/index.js";
import { buildDepthIndex } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { EARLY_TERMS } from "../src/engine/earlyTerms.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : d; };

const TYPES = ["fall", "spring", "sumA", "sumB"];

/**
 * A plan as STUDY terms, in order, each the set of course ids it names.
 *
 * Must agree with `studyTerms` — a work term is not a study term, and a term that reserves a
 * slot without naming a course still is, because it is a semester the student attends.
 * Skipping those renumbers every term after them, which is exactly the inconsistency that
 * once moved a reported figure from 9.6 points of a degree to 25.3.
 */
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
        // ── COMMITTED placements only, never a candidate list ──────────
        //
        // `options.length === 1` is the test for "this row is decided". A placeholder offers
        // many options, and counting them would score an elective slot that merely LISTS
        // `BIOL 2301` as though we had placed `BIOL 2301` there — inflating agreement with a
        // course the student was never given. Applied to both sides, so the question stays
        // symmetrical: of the courses a department commits to, where did we commit them.
        if ((e.options ?? []).length === 1) for (const id of e.options[0]) named.add(id);
        for (const c of (e.children ?? [])) walk(c);
      };
      for (const e of (term.entries ?? [])) walk(e);
      if (cells === 0 && coop) continue;
      if (cells === 0) continue;
      out.push(named);
    }
  }
  return out;
}

function undergradWithPlans() {
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

/** Seeded shuffle — the corpus is ordered by college and its alphabetical head is atypical. */
function sample(list, n) {
  let seed = 0x5eed;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return list.map(x => [rnd(), x]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
}

const all = undergradWithPlans();
// `--explain <key>` answers "why did THIS program not follow its department", which the
// aggregate cannot: it prints what was adopted, what moved, and what the department asked
// for term by term. Every question about one bad plan starts here.
const explainKey = val("--explain", null);
const PROGRAMS = explainKey
  ? all.filter(p => p.key.includes(explainKey))
  : has("--all") ? all : sample(all, Number(val("--n", 60)));
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };

const per = Array.from({ length: EARLY_TERMS }, () => (
  { judged: 0, agree: 0, late1: 0, late2: 0, early: 0, missing: 0 }));
let generated = 0, refused = 0, relaxed = 0, movedTotal = 0, unplacedTotal = 0;
const worst = [];

for (const p of PROGRAMS) {
  const out = generatePlan({
    program: p.data, publishedPlan: p.variant, courseMap, ports, depthIndex,
    observedOrder: observed.edges,
    coopPrep: (observed.coopPrep ?? []).map(x => x.course),
    positions: observed.positions ?? null,
    studentType: "undergraduate", calibration: chartCalibration,
    // Frozen clock: the search is then bounded by NODES alone, so a slow machine cannot
    // silently turn a measurement into a coverage question.
    now: () => 0, timeBudgetMs: 5000,
    repeatable: (id) => !!courseMap[id]?.repeatable,
    ...(has("--off") ? { followDepartment: false } : {}),
  });
  if (out.refused) { refused += 1; continue; }
  generated += 1;
  if ((out.report?.relaxed ?? []).includes("department-early-terms")) relaxed += 1;
  movedTotal += out.report?.earlyTerms?.moves?.length ?? 0;
  unplacedTotal += out.report?.earlyTerms?.unplaced?.length ?? 0;

  const ours = studyTermsOf(out.plan.plans[0]);
  const theirs = studyTermsOf(p.variant);
  const at = (id) => ours.findIndex(s => s.has(id));

  if (explainKey) {
    const e = out.report?.earlyTerms ?? {};
    console.log(`\n=== ${p.key}`);
    console.log(`source=${e.source} through=${e.through} fixed=${e.fixed} `
      + `moved=${(e.moves ?? []).length} unplaced=${(e.unplaced ?? []).length} `
      + `relaxed=${JSON.stringify(out.report?.relaxed ?? [])}`);
    for (const m of (e.moves ?? [])) {
      console.log(`   moved ${m.course}: ${m.from} -> ${m.to}  (${m.why})`);
    }
    for (let t = 0; t < EARLY_TERMS; t += 1) {
      const want = [...(theirs[t] ?? [])].filter(id => courseMap[id]).sort();
      const got = [...(ours[t] ?? [])].sort();
      console.log(`  term ${t}`);
      console.log(`    department: ${want.join(" ") || "(none)"}`);
      console.log(`    generated : ${got.join(" ") || "(none)"}`);
      const missing = want.filter(id => !(ours[t] ?? new Set()).has(id));
      if (missing.length) {
        console.log(`    NOT HERE  : ${missing.map(id => `${id}@${at(id)}`).join(" ")}`);
      }
    }
  }
  let late2Here = 0;
  for (let t = 0; t < EARLY_TERMS; t += 1) {
    for (const id of (theirs[t] ?? new Set())) {
      if (!courseMap[id]) continue;            // not a course the engine could place at all
      const b = per[t];
      b.judged += 1;
      const landed = at(id);
      if (landed === t) b.agree += 1;
      else if (landed < 0) b.missing += 1;
      else if (landed < t) b.early += 1;
      else if (landed === t + 1) b.late1 += 1;
      else { b.late2 += 1; late2Here += 1; }
    }
  }
  if (late2Here) worst.push({ key: p.key, late2: late2Here });
}

const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : "  n/a");
console.log(`\nCHART early terms — ${PROGRAMS.length} programs, `
  + `${generated} generated, ${refused} refused`
  + (has("--off") ? "   [department's arrangement OFF]" : ""));
console.log(`${relaxed} plans fell back to CHART's own arrangement · `
  + `${movedTotal} courses repaired · ${unplacedTotal} left to the search\n`);
console.log("  term   judged    agree    late1    late2+   missing");
per.forEach((b, i) => {
  console.log(`   ${i + 1}   ${String(b.judged).padStart(6)}   ${pct(b.agree, b.judged).padStart(6)}`
    + `   ${pct(b.late1, b.judged).padStart(6)}   ${pct(b.late2, b.judged).padStart(6)}`
    + `   ${pct(b.missing, b.judged).padStart(6)}`);
});
const J = per.reduce((n, b) => n + b.judged, 0);
const A = per.reduce((n, b) => n + b.agree, 0);
const L2 = per.reduce((n, b) => n + b.late2, 0);
console.log(`\n  all   ${String(J).padStart(6)}   ${pct(A, J).padStart(6)}`
  + `   ${" ".repeat(6)}   ${pct(L2, J).padStart(6)}`);

worst.sort((a, b) => b.late2 - a.late2);
if (worst.length) {
  console.log(`\n  worst by courses 2+ terms late:`);
  for (const w of worst.slice(0, 8)) console.log(`    ${String(w.late2).padStart(3)}  ${w.key}`);
}

const outFile = val("--json", null);
if (outFile) {
  writeFileSync(outFile, JSON.stringify(
    { generated, refused, relaxed, movedTotal, unplacedTotal, per, worst }, null, 1));
  console.log(`\nwrote ${outFile}`);
}

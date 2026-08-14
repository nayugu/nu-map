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
import { generatePlan } from "../src/engine/index.js";
import { buildDepthIndex } from "../src/engine/prereqDepth.js";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { minCoursesFor } from "../src/engine/calibration.js";
import { isUnguided } from "./lib/chart-gate.js";
import { GENERAL_ELECTIVE } from "../src/core/requirementDemand.js";

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
// Raise the search budget, to tell "no arrangement exists" from "we stopped looking".
// 53% of refusals exhaust the node budget with space left, so this is the difference
// between a fact about the degree and a weakness in the search.
const nodeBudget = flag("--nodes") ? Number(flag("--nodes")) : null;
const timeMs = flag("--ms") ? Number(flag("--ms")) : 5000;
const wanted = new Set(listFile
  ? JSON.parse(readFileSync(listFile, "utf8"))
  : argv.filter(a => !a.startsWith("--") && a !== listFile && a !== jsonOut));
if (!wanted.size) {
  console.error("usage: chart-probe.js [--plans list.json] [--json out.json] [label ...]");
  process.exit(2);
}

const { courseMap } = loadCatalog();
const ports = enginePorts(courseMap);
const depthIndex = buildDepthIndex(courseMap);
const orderFile = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(orderFile)
  ? JSON.parse(readFileSync(orderFile, "utf8")) : { edges: [], coopPrep: [] };

const flat = (es, out = []) => { for (const e of es ?? []) { out.push(e); flat(e.children, out); } return out; };

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
    if (minCourses > 0 && cells.filter(e => (e.sh ?? 0) >= chartCalibration.realCourseSH).length < minCourses) short++;
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
    // Cheap pre-filter: skip a program none of whose variants were asked for.
    if (![...wanted].some(w => w === prefix || w.startsWith(`${prefix}#`))) continue;
    const data = JSON.parse(readFileSync(rf, "utf8"));
    const pf = join(base, col, key, "plan.json");
    const doc = existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null;
    const variants = doc?.plans?.length ? doc.plans : [null];
    variants.forEach((variant, vi) => {
      const label = prefix + (variants.length > 1 ? `#${vi}` : "");
      if (!wanted.has(label)) return;
      const studentType = lvl === "graduate" ? "graduate" : "undergraduate";
      let r;
      try {
        r = generatePlan({
          program: data, publishedPlan: variant, courseMap, ports, depthIndex,
          observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
          studentType, calibration: chartCalibration, timeBudgetMs: timeMs,
          ...(nodeBudget ? { nodeBudget } : {}),
          ...(concentration ? { concentration } : {}),
        });
      } catch (e) { out[label] = { threw: String(e?.message ?? e) }; return; }
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
console.log(`${rows.length} plans   refused ${refused}   threw ${threw.length}`);
const tot = (k) => rows.reduce((n, [, v]) => n + (v[k] ?? 0), 0);
console.log(`  SHORT of four real courses  ${tot("short")}`);
console.log(`  EMPTY full terms            ${tot("empty")}`);
console.log(`  terms with 3+ UNGUIDED      ${tot("unguided3")}`);
console.log(`  terms with 3+ GEN ELECTIVES ${tot("ge3")}   worst term `
  + `${rows.reduce((m, [, v]) => Math.max(m, v.geMax ?? 0), 0)}`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`  → ${jsonOut}`); }

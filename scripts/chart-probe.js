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

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };

const listFile = flag("--plans");
const jsonOut = flag("--json");
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
  }
  return { short, empty, unguided3, terms };
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
          studentType, calibration: chartCalibration, timeBudgetMs: 5000,
        });
      } catch (e) { out[label] = { threw: String(e?.message ?? e) }; return; }
      if (r.refused) { refused++; out[label] = { refused: r.refused.reason }; return; }
      out[label] = { ...score(r.plan.plans[0], studentType), relaxed: r.report.relaxed ?? [] };
    });
  }
}

const rows = Object.entries(out);
console.log(`${rows.length} plans   refused ${refused}`);
const tot = (k) => rows.reduce((n, [, v]) => n + (v[k] ?? 0), 0);
console.log(`  SHORT of four real courses  ${tot("short")}`);
console.log(`  EMPTY full terms            ${tot("empty")}`);
console.log(`  terms with 3+ UNGUIDED      ${tot("unguided3")}`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`  → ${jsonOut}`); }

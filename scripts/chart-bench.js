#!/usr/bin/env node
// CHART benchmark — one named program, on the REAL app path.
//
// `chart-probe` samples the corpus with the engine's own defaults; this runs a single program
// exactly as `planGenerator` does in the browser: real `enginePorts`, real calibration, the
// observed prereq order and the co-op prep list. That distinction is not academic. Measured
// under permissive ports, International Business generates; measured through this path it
// refuses, because real availability closes terms the permissive port leaves open. A fix
// verified against the permissive path is not verified.
//
//   node scripts/chart-bench.js                       # International Business, the benchmark
//   node scripts/chart-bench.js --program biology     # any program whose key contains this
//   node scripts/chart-bench.js --published           # also judge the DEPARTMENT'S own plan
//
// Prints, per term: cells, real courses (corequisites grouped), and general electives — the
// three numbers the hard criteria are stated in.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { loadCatalog } from "../src/adapters/northeastern/courseCatalog.node.js";
import { generatePlan } from "../src/engine/index.js";
import enginePorts from "../src/adapters/northeastern/enginePorts.js";
import chartCalibration from "../src/adapters/northeastern/chartCalibration.js";
import { minCoursesFor } from "../src/engine/calibration.js";
import { evalPrereqTree } from "../src/core/prereqEval.js";
import { realCourseCount } from "../src/core/coreqGroups.js";
import { gatePlan } from "./lib/chart-gate.js";

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : (process.argv[i + 1]?.startsWith("--") ? true : process.argv[i + 1] ?? true);
};
const MATCH = String(arg("program", "international_business"));
const ROOT = "data/northeastern/programs/undergraduate/2026";

const { courseMap } = loadCatalog();
const ports = enginePorts(courseMap);
const order = (() => {
  try { return JSON.parse(readFileSync("public/northeastern/plan-order.json", "utf8")); }
  catch { return { edges: [], coopPrep: [] }; }
})();

function findProgram(match) {
  for (const col of readdirSync(ROOT)) {
    for (const key of readdirSync(`${ROOT}/${col}`)) {
      if (!key.includes(match)) continue;
      const dir = `${ROOT}/${col}/${key}`;
      if (existsSync(`${dir}/requirements.json`)) return { key, dir };
    }
  }
  return null;
}

const flat = (es, out = []) => { for (const e of es ?? []) { out.push(e); flat(e.children, out); } return out; };

/** The three numbers the criteria are stated in, per term. */
function termRows(doc) {
  const rows = [];
  for (const y of doc?.years ?? []) {
    for (const t of y.terms ?? []) {
      const es = flat(t.entries).filter(e => !e.heading && !e.vacation);
      const named = [], anon = [];
      for (const e of es) {
        if (e.coop) continue;
        const ids = e.options?.length === 1 ? e.options[0] : null;
        if (ids?.length) named.push({ id: ids[0], sh: e.sh ?? 0 }); else anon.push(e.sh ?? 0);
      }
      const real = realCourseCount(named, courseMap, chartCalibration.realCourseSH)
        + anon.filter(sh => sh >= chartCalibration.realCourseSH).length;
      rows.push({
        label: `${y.label ?? ""} ${t.term ?? ""}`.trim(),
        summer: /summer/i.test(`${t.term ?? ""}`),
        coop: es.some(e => e.coop),
        cells: es.length,
        real,
        ge: es.filter(e => /^general elective/i.test(e.title ?? "")).length,
        names: es.map(e => e.options?.length === 1 ? e.options[0].join("+") : (e.coop ? "COOP" : "[res]")),
      });
    }
  }
  return rows;
}

function report(title, doc) {
  const rows = termRows(doc);
  const minC = minCoursesFor(chartCalibration, "undergraduate");
  let bad = 0;
  console.log(`\n${title}`);
  for (const r of rows) {
    // The criteria judge FULL terms only: a summer legitimately holds two, and a term the
    // student spends employed holds none.
    const fails = !r.coop && !r.summer && (r.cells === 0 || r.real < minC);
    if (fails) bad++;
    console.log(`  ${fails ? "✗" : " "} ${r.label.padEnd(16)} cells ${String(r.cells).padStart(2)}  real ${r.real}  GE ${r.ge}  ${r.names.join(" ")}`);
  }
  console.log(`  → ${bad === 0 ? "PASSES" : `${bad} FULL TERM(S) SHORT`}  (criteria: ${minC} real courses per full term)`);
  return bad;
}

const found = findProgram(MATCH);
if (!found) { console.error(`no program matching "${MATCH}"`); process.exit(1); }
const program = JSON.parse(readFileSync(`${found.dir}/requirements.json`, "utf8"));
const published = existsSync(`${found.dir}/plan.json`)
  ? (JSON.parse(readFileSync(`${found.dir}/plan.json`, "utf8")).plans ?? [])[0] ?? null : null;

console.log(`program: ${found.key}`);

const t0 = Date.now();
const out = generatePlan({
  program, publishedPlan: published, courseMap,
  ports, calibration: chartCalibration,
  observedOrder: order.edges ?? [],
  coopPrep: (order.coopPrep ?? []).map(x => x.course ?? x),
  repeatable: (id) => !!courseMap[id]?.repeatable,
});
const ms = Date.now() - t0;

if (out.refused) {
  console.log(`\nREFUSED in ${ms}ms — ${out.refused.reason}`);
  console.log(`  ${out.refused.detail}`);
  // The packer's own verdict, which is the one that says whether ROOM or the courses ran out.
  for (const p of out.refused.data?.packer?.passes ?? []) {
    console.log(`  pack[narrowFirst=${p.narrowFirst}] ${p.kind} cell=${p.cell ?? "-"} `
      + `"${p.title ?? ""}" needs=${p.needs ?? "?"} sh=${p.sh ?? "?"} `
      + `domain=${p.domain ?? "-"} repairs=${p.repairs ?? 0}`);
    for (const t of p.perTerm ?? []) {
      console.log(`      term ${String(t.term).padStart(2)}: ${String(t.why).padEnd(11)}`
        + ` holds ${t.holds}, of which movable ${t.movable}`);
    }
  }
  for (const f of out.refused.data?.failures ?? []) console.log(`  criteria: ${f.detail}`);
} else {
  console.log(`\nGENERATED in ${ms}ms   relaxed: ${JSON.stringify(out.report?.relaxed ?? [])}`);
  report("CHART:", out.plan.plans?.[0] ?? out.plan);
  const g = gatePlan({
    plan: out.plan.plans[0], courseMap,
    offered: (id, season) => ports.offered(id, season), evalPrereqTree,
    creditCap: ports.creditMax("undergraduate"),
    minCourses: minCoursesFor(chartCalibration, "undergraduate"),
    realCourseSH: chartCalibration.realCourseSH,
  });
  console.log(`  hard rules (independent gate): ${g.ok ? "✓ pass" : `✗ ${JSON.stringify(g.ok)}`}`);
}

// The existence proof. If the department's own plan passes our rules, a compliant arrangement
// demonstrably exists and any refusal is ours, not the degree's.
if (arg("published") && published) {
  report("THE DEPARTMENT'S OWN PLAN:", published);
}

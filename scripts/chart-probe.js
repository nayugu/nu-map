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

console.log(`${rows.length} plans   refused ${refused}   threw ${threw.length}`);
console.log(`  SHORT of four real courses  ${tot("short")}`);
console.log(`  EMPTY full terms            ${tot("empty")}`);
console.log(`  terms with 3+ UNGUIDED      ${tot("unguided3")}`);
console.log(`  terms with 3+ GEN ELECTIVES ${tot("ge3")}   worst term `
  + `${rows.reduce((m, [, v]) => Math.max(m, v.geMax ?? 0), 0)}`);
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log(`  → ${jsonOut}`); }

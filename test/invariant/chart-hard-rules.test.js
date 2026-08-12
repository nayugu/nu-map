// ═══════════════════════════════════════════════════════════════════
// INVARIANT: the hard rules, checked with the APP's own checkers
//
// ── Why this file exists and the differential did not suffice ────────
//
// CHART's promise is that a generated plan contains no hard error. Until now that was
// measured with the ENGINE's own notion of a violation — which means an engine wrong twice
// in the same way scores zero, and that is exactly what happened: an `! order` badge
// appeared on a student's screen while the differential reported 0 prereq-order violations.
//
// So every check here is the one the APP performs:
//
//   order         `evalPrereqTree` from src/core — the function that draws the badge
//   availability  `ports.offered` — the same verdict `CourseCard` renders
//   credit cap    the registration limit, from the credit system
//   four courses  every full fall and spring, the corpus's own convention
//
// And the plan is read AS THE UI HOLDS IT: named courses only, because a choice or pool
// cell is a reservation containing no course. That difference is what hid the original bug —
// the engine's witness proved reachability using courses it had MATCHED into pool cells, and
// those courses are not in the student's plan at all.
//
// ── Every variant, not `plans[0]` ───────────────────────────────────
//
// Programs publish ~1.8 patterns and CHART inherits its SHAPE from whichever the student
// picks, so testing the first one leaves half the shapes unexercised. That single choice hid
// a whole class of defect: both five-year Industrial Engineering and Computer Science
// variants broke the four-course rule and failed the FIRST time they were ever measured,
// while every four-year variant of the same program passed.
//
// ── What is asserted at zero, and what is not ───────────────────────
//
// Order, availability and the credit cap are asserted at ZERO. They are the rules a student
// cannot work around: a plan that breaks them cannot be registered for, so a single instance
// is a bug and not a statistic.
//
// The four-course convention is asserted as a SHARE, because it is a convention and CHART
// deliberately relaxes it where it is unsatisfiable — 4.2% of published full terms miss it
// too, and they are architecture and art, where one studio course is 16 credits and there is
// no fourth to add. Refusing those degrees over a rule their own departments do not follow
// is the failure this codebase keeps paying for.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { generatePlan } from "../../src/engine/index.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";
import { REAL_COURSE_SH, FULL_TERM_MIN_COURSES, fullTermMinCourses } from "../../src/engine/domains.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";

const ROOT = new URL("../../", import.meta.url).pathname;
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);

const ORDER_FILE = join(ROOT, "public/northeastern/plan-order.json");
const observed = existsSync(ORDER_FILE)
  ? JSON.parse(readFileSync(ORDER_FILE, "utf8")) : { edges: [], coopPrep: [] };

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

/** Seeded shuffle: the corpus is ordered by college and the alphabetical head is atypical. */
function sample(list, n) {
  let seed = 0xc0ffee;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Sized so this runs after every change. The cost is `refusals x budget` — a success takes a
// median of 48 ms while a refusal spends its whole allowance by definition.
const N = process.env.CHART_CORPUS === "all" ? Infinity : 45;
const PROGRAMS = sample(degreePrograms(), N);

const checked = [];
for (const p of PROGRAMS) {
  const variants = p.plan?.plans?.length ? p.plan.plans : [null];
  variants.forEach((variant, vi) => {
    const out = generatePlan({
      program: p.data, publishedPlan: variant, courseMap, ports, depthIndex,
      observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
      studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
      timeBudgetMs: 1200,
    });
    if (out.refused) return;

    // The plan as the UI holds it. Co-op terms take an ordinal too: a work term still
    // separates a prerequisite from the course that needs it.
    const placed = {}; const rows = [];
    let ord = 0;
    for (const y of out.plan.plans[0].years ?? []) for (const t of y.terms ?? []) {
      let coop = false, cells = 0, big = 0, sh = 0;
      const walk = (es) => { for (const e of es ?? []) {
        if (e.coop) { coop = true; walk(e.children); continue; }
        if (e.vacation || e.heading) { walk(e.children); continue; }
        cells++; sh += e.sh ?? 0;
        if ((e.sh ?? 0) >= REAL_COURSE_SH) big++;
        if (e.options?.length === 1) for (const id of e.options[0]) placed[id] = ord;
        walk(e.children);
      } };
      walk(t.entries);
      rows.push({ label: `${y.label ?? ""} ${t.term}`.trim(), season: t.type,
                  coop, cells, big, sh, half: /summer\s*(1|2|a|b)/i.test(`${t.term ?? ""}`) });
      ord++;
    }
    const semIndex = {};
    for (let i = 0; i < ord; i++) semIndex[i] = i;

    const key = variants.length > 1 ? `${p.key}#${vi}` : p.key;
    const order = [], avail = [], overCap = [], thin = [];
    for (const [id, at] of Object.entries(placed)) {
      if (!ports.offered(id, rows[at].season)) avail.push(`${id} in ${rows[at].label}`);
      const c = courseMap[id];
      if (!c?.prereqs?.length) continue;
      // Strictest reading: no transfer credit, no prior takes, no asserted conditions.
      if (evalPrereqTree(c.prereqs, placed, semIndex, at) === "order") {
        order.push(`${id} in ${rows[at].label}`);
      }
    }
    const cap = p.lvl === "graduate" ? 16 : 19;
    for (const r of rows) {
      if (r.coop || r.cells === 0) continue;
      if (r.sh > cap * (r.half ? 0.5 : 1) + 0.01) overCap.push(`${r.label} ${r.sh} SH`);
      // Per student type. The four-course bar is an UNDERGRADUATE convention: measured, 95.8%
      // of published undergraduate full terms carry four or more and only 16.4% of graduate
      // ones do, with 129 of 329 carrying none at all. Applying it to a master's reported a
      // defect where the departments agree with CHART — every worst case this test named
      // before the split was a graduate program.
      const minCourses = fullTermMinCourses(p.lvl === "graduate" ? "graduate" : "undergraduate");
      if (!r.half && minCourses > 0 && r.big < minCourses) thin.push(`${r.label} (${r.big})`);
    }
    const barred = fullTermMinCourses(p.lvl === "graduate" ? "graduate" : "undergraduate") > 0;
    checked.push({ key, order, avail, overCap, thin,
                   // Only terms the rule applies to count toward the share, or graduate plans
                   // would dilute it into meaninglessness in both directions.
                   fullTerms: barred ? rows.filter(r => !r.coop && r.cells && !r.half).length : 0 });
  });
}

test("hard rules › there are plans to check", () => {
  // Every assertion below passes trivially on an empty list, which is how a gate rots into
  // decoration. This is the guard against that.
  assert.ok(checked.length > 20, `only ${checked.length} plans generated from ${PROGRAMS.length} programs`);
});

test("hard rules › NO prereq is scheduled out of order — the app's own checker", () => {
  const bad = checked.filter(c => c.order.length);
  assert.deepEqual(bad.map(c => `${c.key}: ${c.order.slice(0, 3).join(", ")}`), [],
    `${bad.length} plans place a course before its prerequisite. This is the rule a student `
    + `cannot work around: the registrar refuses the enrolment.`);
});

test("hard rules › NO course is scheduled in a season it is not offered", () => {
  const bad = checked.filter(c => c.avail.length);
  assert.deepEqual(bad.map(c => `${c.key}: ${c.avail.slice(0, 3).join(", ")}`), [],
    `${bad.length} plans put a course in a season the app marks as not offered. Checked with `
    + `ports.offered, the same verdict CourseCard draws — the engine asking a weaker `
    + `question is how CS 3800 came to sit in a Summer B with an "offered?" badge on it.`);
});

test("hard rules › NO term exceeds the registration cap", () => {
  const bad = checked.filter(c => c.overCap.length);
  assert.deepEqual(bad.map(c => `${c.key}: ${c.overCap.slice(0, 3).join(", ")}`), [],
    `${bad.length} plans exceed the credit cap in some term — an overload petition the plan `
    + `does not mention.`);
});

test("hard rules › nearly every full fall and spring carries four real courses", () => {
  const totalFull = checked.reduce((n, c) => n + c.fullTerms, 0);
  const totalThin = checked.reduce((n, c) => n + c.thin.length, 0);
  const share = totalFull ? totalThin / totalFull : 0;
  // A SHARE, not zero, and the reason is in the header: CHART relaxes this where it is
  // unsatisfiable, and 4.2% of published full terms miss it too. 0.10 leaves room for the
  // genuine exceptions while catching a regression in the propagator — it was 13.0% before
  // the cardinality bound and 2.6% after.
  assert.ok(share <= 0.10,
    `${totalThin} of ${totalFull} full fall/spring terms carry fewer than ${FULL_TERM_MIN_COURSES} `
    + `real courses (${(100 * share).toFixed(1)}%). Was 2.6% when the cardinality propagator `
    + `landed; 13.0% before it. Worst: `
    + checked.filter(c => c.thin.length).slice(0, 3).map(c => `${c.key} ${c.thin.join(" ")}`).join("; "));
});

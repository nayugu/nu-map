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
import { fileURLToPath } from "node:url";
import { generatePlan } from "../../src/engine/index.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";
import { REAL_COURSE_SH, FULL_TERM_MIN_COURSES, fullTermMinCourses } from "../../src/engine/domains.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { FIRST_TERM_OVERLOAD_MAX } from "../../src/engine/earlyTerms.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";
// ── The one rule below that this file does NOT re-implement ─────────
//
// Everything else here is written out inline, deliberately, so it is the APP's checkers rather
// than the engine's. Reservation fillability is different: it needs a matching, and a fourth
// hand-rolled matching would be a fourth thing to get wrong. `gatePlan` already owns it and
// already keeps its own — the point of that duplication is that it is not the ENGINE's.
//
// It is wired here because CI runs `test:invariant` on every push while `verify-chart.js`, the
// gate's only other caller, runs monthly in `update-courses.yml`. Without this the guard would
// catch a regression a month after the commit that caused it.
import { gatePlan } from "../../scripts/lib/chart-gate.js";
import { concentrationOptionPools } from "../../src/engine/demand.js";

// fileURLToPath, not .pathname: the latter is percent-encoded and breaks on a
// checkout whose path contains a space.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
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
const ALL_PROGRAMS = degreePrograms();

// ── A uniform sample is the wrong instrument for a rare property ─────
//
// Only 64 of 748 programs have a concentration DISJUNCTION — two or more options the student
// must choose between — so a uniform 45 carries about three of them, and the reservation rule is
// violated by roughly a quarter of the plans that have one. A regression would therefore be
// caught somewhere near half the time, and a guard that fails to fire half the time is not a
// guard; it is a coin that reports "clean" on tails.
//
// So the disjunction programs are sampled SEPARATELY and appended. The uniform sample stays
// exactly as it was — same seed, same 45, so every other assertion in this file is comparing
// against the same corpus it always did — and the extra ones only add power to the rule they
// were drawn for. This is the same reasoning as testing every variant rather than `plans[0]`.
const CONC_N = process.env.CHART_CORPUS === "all" ? Infinity : 20;
const uniform = sample(ALL_PROGRAMS, N);
const chosen = new Set(uniform.map(p => `${p.lvl}/${p.key}`));
const disjunctive = sample(
  ALL_PROGRAMS.filter(p => !chosen.has(`${p.lvl}/${p.key}`)
    && concentrationOptionPools(p.data, courseMap, null)),
  CONC_N);
const PROGRAMS = [...uniform, ...disjunctive];

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
    // ── The FIRST term may be overloaded, if the plan SAYS so ─────────
    //
    // This test's own complaint is the precise one — an over-cap term is "an overload
    // petition the plan does not mention" — so the exemption is conditional on the mention.
    // `report.earlyTerms.overload` is what drives the sentence the student reads in the
    // explainer, and it is the only thing that licenses the term here. A plan that quietly
    // exceeds the cap still fails, which is the property worth keeping.
    //
    // Narrow on purpose: the earliest term with courses in it, and never past
    // `FIRST_TERM_OVERLOAD_MAX`. 4.0% of published first terms exceed the cap and no later
    // term ever does; refusing to reproduce them cost thirteen Khoury combined majors their
    // department's entire first two years.
    const disclosed = out.report?.earlyTerms?.overload ?? null;
    const firstRow = rows.find(r => !r.coop && r.cells > 0) ?? null;
    for (const r of rows) {
      if (r.coop || r.cells === 0) continue;
      const allowed = (disclosed && r === firstRow)
        ? Math.max(cap, FIRST_TERM_OVERLOAD_MAX) * (r.half ? 0.5 : 1)
        : cap * (r.half ? 0.5 : 1);
      if (r.sh > allowed + 0.01) overCap.push(`${r.label} ${r.sh} SH`);
      // Per student type. The four-course bar is an UNDERGRADUATE convention: measured, 95.8%
      // of published undergraduate full terms carry four or more and only 16.4% of graduate
      // ones do, with 129 of 329 carrying none at all. Applying it to a master's reported a
      // defect where the departments agree with CHART — every worst case this test named
      // before the split was a graduate program.
      const minCourses = fullTermMinCourses(p.lvl === "graduate" ? "graduate" : "undergraduate");
      if (!r.half && minCourses > 0 && r.big < minCourses) thin.push(`${r.label} (${r.big})`);
    }
    // Whichever concentration this student picks, can the cells reserved for it be answered by
    // distinct courses from THAT option? A placeholder carries no course, so every check above
    // sees nothing to check and the plan passes them while being unfollowable — which is what
    // 21 of 77 concentration plans were doing when nobody was asking.
    const pools = concentrationOptionPools(p.data, courseMap, null) ?? [];
    const reservations = pools.length
      ? gatePlan({
          plan: out.plan.plans[0], courseMap, evalPrereqTree,
          offered: (id, season) => ports.offered(id, season),
          creditCap: cap, minCourses: 0, realCourseSH: REAL_COURSE_SH,
          concentrationOptions: pools,
        }).reservations
      : [];

    const barred = fullTermMinCourses(p.lvl === "graduate" ? "graduate" : "undergraduate") > 0;
    checked.push({ key, order, avail, overCap, thin, reservations,
                   // How many plans faced the question at all. A zero here means nothing
                   // without it — the previous gate scored zero by not asking.
                   exposed: pools.length > 0,
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

test("hard rules › some plans are EXPOSED to the concentration question", () => {
  // The assertion below passes trivially if no sampled program has a concentration, and the
  // sample is random. This is the same guard as "there are plans to check", one level in: a
  // check nothing reaches reports zero violations forever.
  const exposed = checked.filter(c => c.exposed).length;
  assert.ok(exposed >= 8,
    `only ${exposed} generated plans have a concentration disjunction, so the next assertion has `
    + `little power. About a quarter of such plans violated the rule before it was enforced, so `
    + `a handful is the difference between a guard and a coin. See the sampling note above.`);
});

test("hard rules › EVERY concentration a student could pick can still be filled", () => {
  // The union of every option is not an answer: the pools are typically disjoint, so a plan can
  // reserve three cells in a term and satisfy them with courses from three DIFFERENT
  // concentrations — a filling no single student can perform. Measured at 21 of 77 concentration
  // plans before `witnessPlan` learned to quantify `∀ option, ∃ a filling`.
  //
  // Asserted at ZERO, beside order and availability, because it is the same kind of rule: a
  // student who picks the wrong concentration cannot register for the term this plan gives them.
  const bad = checked.filter(c => c.reservations.length);
  assert.deepEqual(bad.map(c => `${c.key}: ${c.reservations.slice(0, 2).join("; ")}`), [],
    `${bad.length} plans reserve more concentration cells in a term than the tightest `
    + `concentration can fill. The union of the options proves a filling no student can perform `
    + `— see witnessPlan's per-option pass and docs/chart-open-defects.md §2.`);
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

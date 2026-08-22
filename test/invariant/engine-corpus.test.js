// INVARIANT · CHART generates a plan for every real program, and every plan it
// generates satisfies every hard constraint.
//
// The unit suites exercise the modules on fixtures. This runs the real path over
// the real corpus and re-derives the guarantees INDEPENDENTLY of the engine's own
// witness — a test that asked the engine whether it was happy would pass for a
// broken engine that never emitted anything.
//
// The two things it must catch:
//   · a plan that violates a constraint the engine claims to enforce
//   · the engine quietly refusing more than it used to, which looks like success
//     to any test that only checks the plans it does emit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { generatePlan } from "../../src/engine/index.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";
import { specForNode, courseEligible } from "../../src/core/programEligibility.js";
// `scripts/` is permitted here — see test-suite-deps.test.js, which allows src/, scripts/ and
// Node builtins. This module has no external dependency, so the invariant job's no-install
// constraint still holds.
import { coveringSample, describeShape } from "../../scripts/lib/chart-sample.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);

/** Every program file that is a DEGREE — one with a total to size a plan against. */
function degreePrograms() {
  const out = [];
  for (const lvl of ["undergraduate", "graduate"]) {
    const base = join(ROOT, `data/northeastern/programs/${lvl}/2026`);
    if (!existsSync(base)) continue;
    for (const col of readdirSync(base)) {
      const cd = join(base, col);
      if (!statSync(cd).isDirectory()) continue;
      for (const p of readdirSync(cd)) {
        const f = join(cd, p, "requirements.json");
        if (!existsSync(f)) continue;
        const data = JSON.parse(readFileSync(f, "utf8"));
        if (!(data.requirementSections ?? []).length) continue;
        if (!(data.totalCreditsRequired > 0)) continue;      // minors and the like
        const pf = join(cd, p, "plan.json");
        out.push({
          lvl, key: p, data,
          plan: existsSync(pf) ? JSON.parse(readFileSync(pf, "utf8")) : null,
        });
      }
    }
  }
  return out;
}

/**
 * A deterministic sample.
 *
 * Shuffled, because the corpus is ordered by college and the alphabetical prefix
 * (`admission/`, `arts-media-design/`) is where the thin programs live — measuring
 * the leading 120 gave a 36% refusal rate against a true 13.6% and nearly moved a
 * threshold. Seeded, so a failure is reproducible.
 */
function sample(list, n) {
  let seed = 0x5eed;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const ALL = degreePrograms();
/**
 * How many programs the default run generates for, and why it is not 200.
 *
 * The suite's cost is dominated by REFUSALS, not successes. A success is fast — median
 * 48 ms — while a refusal spends its entire time budget by definition, so the runtime is
 * roughly `refusals x budget`. At 200 programs across every variant that is 277 shapes,
 * ~100 of which refuse, and the suite spent minutes re-confirming the same failures.
 *
 * 70 programs (~95 shapes) keeps the sample representative — it is the same seeded
 * shuffle, so it is not the alphabetical head where the thin programs live — while making
 * the suite fast enough to run after every change. Which matters more than it sounds:
 * a suite too slow to run is a suite that stops being run, and today three real defects
 * were found only because expanding coverage was cheap enough to try.
 *
 * `CHART_CORPUS=all` sweeps all 748 before a commit that touches the engine.
 */
const N = process.env.CHART_CORPUS === "all" ? ALL.length : 70;
const PROGRAMS = sample(ALL, N);

/**
 * The per-program time budget, and why it dominates the suite's runtime.
 *
 * Generation is fast when it succeeds — median 48 ms, p90 339 ms — and slow only when it
 * FAILS, because a refusal is a budget being spent to exhaustion. So the suite's cost is
 * roughly (refusals x budget), and at 3000 ms with ~100 refusals that is five minutes of
 * a test run doing nothing but confirming the same failures.
 *
 * 1200 ms keeps every success (p90 is 339 ms, and the fallback tier gets a reserved 40%
 * of whatever it is given) while cutting the refusal cost by 60%. It is a knob on how long
 * the suite waits, not on what it asserts — anything that generates at 3000 ms and not at
 * 1200 ms was already too slow to offer a student.
 */
const TEST_TIME_BUDGET_MS = 1200;

const generate = (p, variant) => generatePlan({
  program: p.data, publishedPlan: variant ?? null,
  courseMap, ports, depthIndex,
  studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
  timeBudgetMs: TEST_TIME_BUDGET_MS,
});

// ── EVERY published variant, not just the first ────────────────────
//
// This tested `plans[0]` only, and that single choice hid a whole class of defect for
// as long as the engine existed. Programs publish ~1.8 variants — "Four Years, Two
// Co-ops" alongside a five-year, three-co-op pattern — and CHART inherits its SHAPE from
// whichever one the student picks. So roughly half the shapes it is asked to fill were
// never exercised here.
//
// What was hiding in the untested half: both five-year Industrial Engineering and
// Computer Science variants broke the four-courses-per-full-term rule, and failed the
// first time they were ever measured, while all four-year variants of the same program
// passed. A shape with more summers behaves differently from one with fewer, and nothing
// about testing the first variant tells you anything about the second.
// Each result carries the VARIANT it was generated from, so a test that re-generates
// feeds the same input. Dropping it made the determinism check compare a plan built on a
// published shape against one built on a derived skeleton and call the engine
// non-deterministic — a false alarm produced by the harness, not the engine.
const ALL_SHAPES = PROGRAMS.flatMap((p) => {
  const variants = p.plan?.plans?.length ? p.plan.plans : [null];
  return variants.map((v, vi) => ({
    label: `${p.lvl}/${p.key}${variants.length > 1 ? `#${vi}` : ""}`,
    p: { ...p, key: variants.length > 1 ? `${p.key}#${vi}` : p.key },
    variant: v,
    features: describeShape({ lvl: p.lvl, data: p.data, variant: v, variantCount: variants.length }),
  }));
});

/**
 * A COVERING sample of those shapes, not all of them.
 *
 * ── Why, measured ───────────────────────────────────────────────────
 *
 * This file became the slowest in the suite: 202 s, and since `node --test` runs files
 * concurrently, the suite's wall time is its longest file — so this one number *is*
 * `test:invariant`. The cost is `refusals x budget` as the header above says, and worse
 * than that: a refusal whose reason is not in `PREFLIGHT_REASONS` re-runs generation for
 * each of the 8 `EARLY_RUNGS`, so one refusal can cost nine budgets. Shape COUNT is
 * therefore the dominant lever, and cutting it is the only one that does not weaken what
 * is asserted.
 *
 * ── Fewer shapes AND better coverage, which sounds like cheating ────
 *
 * A uniform draw spends most of its budget on ordinary programs. The properties a
 * regression hides behind are rare — concentration disjunctions are 10.4% of the corpus,
 * shared sections 12.4%, 15+ requirement sections 6.0% — so a random 95 carries only a
 * handful of each and can miss one entirely. `coveringSample` guarantees a quota of every
 * stratum and then fills with a uniform draw, so a smaller sample tests strictly more
 * kinds of program. See `scripts/lib/chart-sample.js` for the 1-0.75^q arithmetic on why
 * the quota is what it is.
 *
 * It also makes the "every published variant" property above a GUARANTEE rather than a
 * hope: `a non-primary variant` is one of the strata, so the sample cannot consist only of
 * the pattern departments lead with. That was previously left to chance.
 *
 * `CHART_CORPUS=all` still sweeps everything.
 */
const SHAPES = process.env.CHART_CORPUS === "all"
  ? ALL_SHAPES
  : coveringSample(ALL_SHAPES, { size: 60 }).chosen;

// `ms` is recorded HERE rather than re-measured later. The latency test below used to generate
// 25 more plans to time work this pass had already done; this is the honest place to hold a
// stopwatch — a live clock, a fresh engine, the real budget — so the measurement is free and
// covers every success in the sample instead of the first 25.
const results = SHAPES.map(({ p, variant }) => {
  const t0 = Date.now();
  const out = generate(p, variant);
  return { p, variant, out, ms: Date.now() - t0 };
});
const made = results.filter(r => !r.out.refused);

test("corpus › the engine has programs to work with", () => {
  assert.ok(ALL.length > 700, `expected ~748 degree programs, found ${ALL.length}`);
});

test("corpus › nothing throws", () => {
  // `generate` already ran; reaching here means none of them threw. Asserted
  // explicitly so the reason this suite exists is visible.
  //
  // ── Two separate properties, which used to be one assertion ───────
  //
  // It read `results.length >= PROGRAMS.length`, and that conflated "variants were expanded"
  // with "we generated something". Once the shapes are SAMPLED the two come apart — 60 chosen
  // shapes is legitimately fewer than 70 programs — and the combined form failed while both
  // underlying properties held. It caught this change, which is the assertion doing its job;
  // the fix is to state each property against the set it is actually about.
  //
  // 1. Variants are expanded: one shape per (program, variant), so the FULL shape list is at
  //    least the program count — a program publishing four patterns contributes four.
  assert.ok(ALL_SHAPES.length >= PROGRAMS.length,
    `${ALL_SHAPES.length} shapes from ${PROGRAMS.length} programs — variants not expanded`);
  // 2. `generate` already ran for every sampled shape; reaching here means none threw. The
  //    non-empty check matters because every other assertion in this file passes trivially
  //    over an empty corpus — the same reason the generated-share floor exists.
  assert.equal(results.length, SHAPES.length, "one result per sampled shape");
  assert.ok(results.length > 0, "the sample must contain shapes to generate");
});

test("corpus › the generated share does not regress", () => {
  const share = made.length / results.length;
  // Measured 63.2% over all published variants of a shuffled 200 programs — 277 shapes.
  //
  // The floor was 0.70, measured when this suite generated only `plans[0]`. That is a
  // different and easier population: a program's first variant is the pattern the
  // department leads with, and the alternates include the five-year, three-co-op shapes
  // that are harder to fill. So the old number is not comparable, and lowering the floor
  // here is a change of POPULATION, not a relaxation of the bar — it is measured against
  // strictly more shapes than before, including ones never tested.
  //
  // Two real costs are also inside this number and are recorded rather than hidden: the
  // availability rule now matches the app's (`offered`, not `probability !== 0`), which
  // trades ~4 points of coverage for zero availability errors; and the four-course
  // cardinality bound makes some shapes need the relaxed tier.
  //
  // ── This measures coverage AT THE TEST BUDGET, not coverage ───────
  //
  // The number here is not the product figure and must not be quoted as one. This suite
  // runs at 1200 ms per shape to stay fast enough to be run after every change, and a node
  // costs ~0.4 ms, so it allows roughly 3,000 nodes — well under production's 5,000 ms.
  // Every program that needs more refuses HERE and generates in the app. Measured: 49% at
  // 1200 ms against 63.2% at 2,000 ms on the full 277 shapes.
  //
  // Which is why the floor is 0.40 rather than something nearer the real rate. This
  // assertion has exactly one job — catch a change that starts refusing everything, since
  // every other assertion in this file passes trivially when nothing is emitted — and it
  // does that job at 0.40. Raising it to look reassuring would only make the suite fail on
  // a slow machine, which is the failure mode that teaches people to ignore a red suite.
  //
  // The honest coverage figure comes from a full sweep at the production budget:
  // `CHART_CORPUS=all`, or the corpus script over all 748 degrees.
  assert.ok(share >= 0.40,
    `only ${made.length}/${results.length} (${(100 * share).toFixed(1)}%) generated — ` +
    `the other assertions pass trivially when nothing is emitted`);
});

test("corpus › every refusal names a reason and a sentence", () => {
  for (const { p, out } of results) {
    if (!out.refused) continue;
    assert.ok(out.refused.reason, `${p.key}: refusal with no reason`);
    assert.ok(/[a-z]/.test(String(out.refused.detail ?? "")),
      `${p.key}: refusal reason "${out.refused.reason}" with no readable detail`);
  }
});

// ── Hard constraints, re-derived from the emitted grid ─────────────

/** Flatten an emitted plan back into terms, in order, the way a reader would. */
function readPlan(plan) {
  const terms = [];
  for (const year of plan.plans[0].years ?? []) {
    for (const t of year.terms ?? []) {
      terms.push({
        label: `${year.label} ${t.term}`.trim(),
        semTypeId: t.type,
        hours: t.hours,
        coop: (t.entries ?? []).some(e => e.coop),
        entries: (t.entries ?? []).filter(e => !e.coop),
      });
    }
  }
  return terms;
}

test("corpus › no term exceeds the registration cap", () => {
  // ── Except a DISCLOSED first-semester overload ────────────────────
  //
  // A department publishing over the cap in semester one is a block schedule an advisor
  // signs off; 4.0% of published first terms do it and no later term ever does. It is
  // permitted only when `report.earlyTerms.overload` is set, which is what makes the
  // explainer tell the student the term needs approval — an undisclosed over-cap term is
  // still a failure, and that is the property this test is really protecting.
  const bad = [];
  for (const { p, out } of made) {
    const max = ports.creditMax(p.lvl === "graduate" ? "graduate" : "undergraduate");
    const disclosed = out.report?.earlyTerms?.overload ?? null;
    const terms = readPlan(out.plan);
    const first = terms[0] ?? null;
    for (const t of terms) {
      const base = max * ports.termWeight(t.semTypeId);
      const cap = (disclosed && t === first)
        // Exactly what the plan DISCLOSED. The first semester carries whatever its department
        // published, so there is no ceiling to re-derive — and checking the disclosure is
        // tighter: a plan may carry the load it admitted to and not one credit more.
        ? Math.max(base, disclosed.sh)
        : base;
      const sh = t.entries.reduce((n, e) => n + (e.sh ?? 0), 0);
      if (sh > cap) bad.push(`${p.key} ${t.label}: ${sh} SH > ${cap}`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} terms over the cap`);
});

test("corpus › every named course's prerequisites precede it", () => {
  // Re-derived with `evalPrereqTree` — the app's own evaluator, not CHART's — so a
  // bug in CHART's reading of the grammar cannot hide here. "missing" is accepted:
  // a prerequisite the plan does not schedule is a fact about the program's
  // requirements, not an ordering error CHART caused. "order" is not.
  const bad = [];
  for (const { p, out } of made) {
    const terms = readPlan(out.plan);
    const placements = {};
    const semIndex = {};
    terms.forEach((t, i) => { semIndex[`t${i}`] = i; });
    terms.forEach((t, i) => {
      for (const e of t.entries) {
        if (e.options?.length !== 1) continue;         // a decided course
        for (const id of e.options[0]) placements[id] = `t${i}`;
      }
    });
    terms.forEach((t, i) => {
      for (const e of t.entries) {
        if (e.options?.length !== 1) continue;
        for (const id of e.options[0]) {
          const c = courseMap[id];
          if (!c?.prereqs?.length) continue;
          if (evalPrereqTree(c.prereqs, placements, semIndex, i) === "order") {
            bad.push(`${p.key}: ${id} in ${t.label} is before one of its prerequisites`);
          }
        }
      }
    });
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} out-of-order named courses`);
});

test("corpus › no course is scheduled twice", () => {
  const bad = [];
  for (const { p, out } of made) {
    const seen = new Set();
    for (const t of readPlan(out.plan)) {
      for (const e of t.entries) {
        if (e.options?.length !== 1) continue;
        for (const id of e.options[0]) {
          if (seen.has(id) && !courseMap[id]?.repeatable) bad.push(`${p.key}: ${id} twice`);
          seen.add(id);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} duplicate registrations`);
});

test("corpus › the plan totals the degree's own credit requirement", () => {
  const bad = [];
  for (const { p, out } of made) {
    const sh = readPlan(out.plan).reduce(
      (n, t) => n + t.entries.reduce((m, e) => m + (e.sh ?? 0), 0), 0);
    const want = p.data.totalCreditsRequired;
    // A program whose own requirements total more than its stated degree legitimately
    // overshoots, and CHART says so rather than refusing: `sections-exceed-degree`.
    // The plan must then exceed by AT MOST what the requirements exceed by — anything
    // more is CHART's error rather than the catalog's — and the warning must be there,
    // so a silent overshoot cannot hide behind this exemption.
    const excess = (out.report.warnings ?? []).find(w => w.kind === "sections-exceed-degree");
    if (excess) {
      assert.ok(excess.over > 0, `${p.key}: excess warning with no amount`);
      if (sh - want > excess.over + 5) {
        bad.push(`${p.key}: ${sh} SH vs ${want} required, beyond the ${excess.over} the requirements themselves exceed by`);
      }
      continue;
    }
    // A whole-cell plan cannot always hit a number exactly: a section demanding
    // 3 SH answered by 4 SH courses overshoots by one, and the catalog's own
    // printed totals disagree with its own cells in 7 terms. One course of slack.
    if (Math.abs(sh - want) > 5) bad.push(`${p.key}: ${sh} SH vs ${want} required`);
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans off their degree total`);
});

test("corpus › a course is only scheduled in a season it has run in", () => {
  // The exception is explicit: `availabilityRelaxed` cells, where every candidate
  // is barred from every term the plan uses and refusing would mean no plan at all.
  // Those are reported in `report.availabilityRelaxed`, not silently allowed.
  const bad = [];
  for (const { p, out } of made) {
    const relaxed = out.report.availabilityRelaxedCells ?? 0;
    if (relaxed) continue;
    for (const t of readPlan(out.plan)) {
      for (const e of t.entries) {
        if (e.options?.length !== 1) continue;
        for (const id of e.options[0]) {
          if (ports.offeringProbability(id, t.semTypeId) === 0) {
            bad.push(`${p.key}: ${id} in ${t.label} (${t.semTypeId}), never offered then`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} courses in a season they never run in`);
});

test("corpus › every cell that names a requirement names one that exists", () => {
  const bad = [];
  for (const { p, out } of made) {
    const sections = p.data.requirementSections;
    for (const t of readPlan(out.plan)) {
      for (const e of t.entries) {
        for (const target of e.binding?.targets ?? []) {
          if (typeof target !== "number") continue;      // a sentinel
          if (!sections[target]) bad.push(`${p.key}: binding to §${target}, which does not exist`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} bindings to a missing section`);
});

test("corpus › a cell's named options really can answer its requirement", () => {
  // The inversion's central claim: a generated cell's binding is CONSTRUCTED, not
  // inferred, so it cannot be wrong. This is what would catch it if it were.
  const bad = [];
  for (const { p, out } of made) {
    const sections = p.data.requirementSections;
    for (const t of readPlan(out.plan)) {
      for (const e of t.entries) {
        const targets = (e.binding?.targets ?? []).filter(x => typeof x === "number");
        if (targets.length !== 1 || !e.options?.length) continue;
        const spec = specForNode(sections[targets[0]]);
        // A corequisite partner is in the group because the registrar requires it in
        // the same term, not because the requirement named it. The binding is a claim
        // about the CELL, and the cell answers its section through the course that
        // came from it — so the partner is excluded rather than the check weakened.
        const registrar = new Set(e.coreqAdded ?? []);
        for (const group of e.options) {
          for (const id of group) {
            const c = courseMap[id];
            if (!c || registrar.has(id)) continue;
            if (!courseEligible(c, spec)) {
              bad.push(`${p.key}: ${id} offered for §${targets[0]} "${sections[targets[0]].title}", which does not admit it`);
            }
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} cells offering an ineligible course`);
});

test("corpus › every entry is well formed for applySamplePlan", () => {
  const bad = [];
  for (const { p, out } of made) {
    const doc = out.plan;
    assert.ok(Array.isArray(doc.plans) && doc.plans.length === 1, `${p.key}: not one plan`);
    assert.ok(typeof doc.plans[0].pattern === "string", `${p.key}: no pattern label`);
    for (const t of readPlan(doc)) {
      for (const e of t.entries) {
        if (typeof e.text !== "string" || !e.text.trim()) bad.push(`${p.key}: entry with no text`);
        if (!Number.isFinite(e.sh) || e.sh < 0) bad.push(`${p.key}: entry with sh ${e.sh}`);
        if (e.options !== undefined && !Array.isArray(e.options)) bad.push(`${p.key}: options not an array`);
        for (const g of e.options ?? []) {
          if (!Array.isArray(g) || !g.length) bad.push(`${p.key}: empty option group in "${e.text}"`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} malformed entries`);
});

test("corpus › a co-op in the shape becomes a co-op cell in the grid", () => {
  // `applySamplePlan` builds work blocks from `{coop: true}` entries. A grid of
  // course cells alone produces NO co-op blocks: the work terms silently become
  // empty study terms and every credit and standing calculation downstream is wrong.
  //
  // Counted against EMPLOYED terms, not work terms. A term carrying a co-op and a course
  // is not a work term, and it emits a co-op cell too — 90 such terms across 42 programs,
  // which used to emit none at all, so the student was never told they were employed and
  // an empty one was counted as a semester they were not enrolled in.
  const bad = [];
  for (const { p, out } of made) {
    if (!out.report.coopTerms) continue;
    const coopTerms = readPlan(out.plan).filter(t => t.coop).length;
    if (coopTerms !== out.report.coopTerms) {
      bad.push(`${p.key}: ${out.report.coopTerms} employed terms in the shape, ${coopTerms} co-op cells emitted`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans that lost their co-ops`);
});

/**
 * A frozen clock, so determinism is tested as a property and not as a race.
 *
 * With the real clock this test was measuring machine load. The search is bounded in two
 * currencies, and only one of them is reproducible: on a busy run the wall clock fired
 * first, the strict tier gave up early, and the relaxed tier answered instead — a
 * different plan for the same input, which is exactly what it was reporting.
 *
 * The engine now refuses rather than switching tiers when the clock fires, so the clock can
 * only ever cost an answer. Freezing it removes even that, leaving the node budget as the
 * sole bound — which is what "same inputs, same plan" actually means.
 */
const frozen = () => 0;

test("corpus › generation is deterministic", () => {
  // Byte-identical output, or the diff review the data workflows rely on becomes
  // noise. Checked on a subset: it doubles the run cost.
  for (const { p, variant } of made.slice(0, 15)) {
    const a = generatePlan({
      program: p.data, publishedPlan: variant ?? null, courseMap, ports, depthIndex,
      studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
      timeBudgetMs: TEST_TIME_BUDGET_MS, now: frozen,
    });
    const b = generatePlan({
      program: p.data, publishedPlan: variant ?? null, courseMap, ports, depthIndex,
      studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
      timeBudgetMs: TEST_TIME_BUDGET_MS, now: frozen,
    });
    if (a.refused || b.refused) {
      assert.equal(!!a.refused, !!b.refused, `${p.key}: refused in one run and not the other`);
      continue;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(b.plan)),
                     JSON.parse(JSON.stringify(a.plan)), `${p.key} differs between runs`);
  }
});

test("corpus › a plan is produced in a time a person would wait for", () => {
  // Timed over plans that GENERATED — refusals excluded, because a refusal spends the whole
  // budget by definition and a median that includes them is partly a median of timeouts. What
  // the assertion is about is how long a student waits for a plan they get.
  //
  // The times come from this suite's own generation pass, not from 25 more generations run here.
  // Same clock, same budget, same engine; the difference is that it is now every success in the
  // sample rather than the first 25, and it costs nothing. "Re-using nothing" was the previous
  // note's reasoning, and re-using the pass is strictly better — a second generation of a plan
  // already built measures the same thing twice.
  const times = made.map(r => r.ms).sort((a, b) => a - b);
  assert.ok(times.length > 10, `only ${times.length} successful generations to time`);
  const median = times[Math.floor(times.length / 2)];
  // Measured: median 85 ms after the objective phase stopped running a full
  // prereq-aware witness on every trial move (it was 4.9 seconds).
  assert.ok(median < 1500, `median generation time ${median} ms`);
});

test("corpus › the term a cell was verified in is the term it is emitted in", () => {
  // The one off-by-one that can invalidate everything else here.
  //
  // `termOf` indexes the terms `shape.studyTerms` returns; `emit` walks the shape's
  // full term list and has to skip exactly the same ones. When unused terms became
  // placeable, `studyTerms` started including them while `emit` still skipped them —
  // and every cell shifted. The plans stayed internally consistent, passed the
  // search's own checks, and came out with 116 season violations and 89 terms over
  // the credit cap, because they had been verified against one indexing and written
  // out under another.
  //
  // Re-derived here from the EMITTED grid, so it cannot share the bug: a course in
  // the emitted plan must be offered in the season of the term it is emitted into,
  // which is the property the shift destroyed.
  const bad = [];
  for (const { p, out } of made) {
    for (const t of readPlan(out.plan)) {
      if (t.coop) continue;
      for (const e of t.entries) {
        if (e.options?.length !== 1) continue;
        for (const id of e.options[0]) {
          if (ports.offeringProbability(id, t.semTypeId) === 0) {
            bad.push(`${p.key}: ${id} emitted into ${t.label} (${t.semTypeId})`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [],
    `${bad.length} courses emitted into a season they have never run in — ` +
    `if this fires alongside many others, suspect the study-term indexing first`);
});

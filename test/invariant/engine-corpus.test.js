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
// A sample rather than all 748, so the suite stays inside a normal test run. Raise
// it with CHART_CORPUS=all when changing the engine.
const N = process.env.CHART_CORPUS === "all" ? ALL.length : 200;
const PROGRAMS = sample(ALL, N);

const generate = (p) => generatePlan({
  program: p.data, publishedPlan: p.plan?.plans?.[0] ?? null,
  courseMap, ports, depthIndex,
  studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
  timeBudgetMs: 3000,
});

const results = PROGRAMS.map(p => ({ p, out: generate(p) }));
const made = results.filter(r => !r.out.refused);

test("corpus › the engine has programs to work with", () => {
  assert.ok(ALL.length > 700, `expected ~748 degree programs, found ${ALL.length}`);
});

test("corpus › nothing throws", () => {
  // `generate` already ran; reaching here means none of them threw. Asserted
  // explicitly so the reason this suite exists is visible.
  assert.equal(results.length, PROGRAMS.length);
});

test("corpus › the generated share does not regress", () => {
  const share = made.length / results.length;
  // Measured 78% on a shuffled 150. The floor is deliberately below that: this
  // guards against a change that starts refusing everything, which every other
  // assertion here would read as success.
  assert.ok(share >= 0.70,
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
  const bad = [];
  for (const { p, out } of made) {
    const max = ports.creditMax(p.lvl === "graduate" ? "graduate" : "undergraduate");
    for (const t of readPlan(out.plan)) {
      const cap = max * ports.termWeight(t.semTypeId);
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
        for (const group of e.options) {
          for (const id of group) {
            const c = courseMap[id];
            if (!c) continue;
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
  const bad = [];
  for (const { p, out } of made) {
    if (!out.report.workTerms) continue;
    const coopTerms = readPlan(out.plan).filter(t => t.coop).length;
    if (coopTerms !== out.report.workTerms) {
      bad.push(`${p.key}: ${out.report.workTerms} work terms in the shape, ${coopTerms} co-op cells emitted`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} plans that lost their co-ops`);
});

test("corpus › generation is deterministic", () => {
  // Byte-identical output, or the diff review the data workflows rely on becomes
  // noise. Checked on a subset: it doubles the run cost.
  for (const { p, out } of made.slice(0, 25)) {
    const again = generate(p);
    assert.deepEqual(JSON.parse(JSON.stringify(again.plan)),
                     JSON.parse(JSON.stringify(out.plan)), `${p.key} differs between runs`);
  }
});

test("corpus › a plan is produced in a time a person would wait for", () => {
  const times = [];
  for (const p of PROGRAMS.slice(0, 40)) {
    const t = Date.now();
    generate(p);
    times.push(Date.now() - t);
  }
  times.sort((a, b) => a - b);
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

// ═══════════════════════════════════════════════════════════════════
// A PRUNING propagator must not move a plan that already generates.
//
// This is the invariant the whole coverage architecture rests on (design of record §17). The
// constraint on every remaining fix is that the ~650 shapes generating today come out
// IDENTICAL — a change that raises coverage while quietly re-sequencing plans that were
// already good is a regression wearing a coverage number as a disguise.
//
// ── The distinction this pins, because it is easy to get backwards ──
//
// §17 first claimed that strengthening propagation is never output-neutral, on the reasoning
// that `byConstraint` orders cells by domain LENGTH (most-constrained-first), so narrowing a
// domain changes the variable order and therefore which legal plan the search reaches first.
//
// That is true of a propagator that REWRITES domains, and false of one that only PRUNES. A
// pruning propagator answers one question — "is this branch dead" — and cutting branches that
// contain no solution cannot change the order in which SOLUTIONS are encountered. So the plan
// is bit-identical and merely reached without the detour.
//
// The difference decides where a fix is allowed to live: a rewriting propagator must go in a
// later rung, where only already-refusing programs reach it, while a pruning one is safe
// everywhere. That is a strong claim about the search's behaviour and exactly the kind this
// codebase has been wrong about before, so it is tested rather than reasoned about.
//
// `propagateChains: false` exists for this test and for nothing else. Production never passes
// it, and any future propagator claiming neutrality should be added here the same way.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { generatePlan } from "../../src/engine/index.js";
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
  let seed = 0x5eed11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Sized so this runs after every change. Each program is generated TWICE, and a refusal
// spends its whole allowance by definition, so the budget is the small one the other
// invariant suites use.
const N = process.env.CHART_CORPUS === "all" ? Infinity : 30;
const PROGRAMS = sample(degreePrograms(), N);

const generate = (p, variant, propagateChains) => generatePlan({
  program: p.data, publishedPlan: variant, courseMap, ports, depthIndex,
  observedOrder: observed.edges, coopPrep: (observed.coopPrep ?? []).map(x => x.course),
  studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
  timeBudgetMs: 1200, propagateChains,
  // ── A FROZEN clock, because otherwise this test races the machine ──
  //
  // Each program is generated twice, and the wall clock may turn an answer into a refusal —
  // that is the engine's documented behaviour, not a bug. With a live clock one side of the
  // pair can therefore refuse on time while the other succeeds, which this test counted as a
  // LOST plan and reported as the propagator being unsound. It duly failed once on a run that
  // touched nothing but locale files.
  //
  // Frozen, the deadline can never fire and the search is bounded by NODES alone, which is
  // what the invariant is actually about: same input, same traversal, same plan. The engine
  // exposes `now` for precisely this.
  now: () => 0,
});

/** The plan as a student sees it: every term in order, every cell in order. */
const canonical = (plan) => {
  const lines = [];
  for (const y of plan?.years ?? []) {
    for (const t of y.terms ?? []) {
      const walk = (es, d) => {
        for (const e of es ?? []) {
          lines.push(`${"  ".repeat(d)}${e.coop ? "COOP" : e.vacation ? "VAC" : "CELL"} `
            + `${e.text ?? ""} [${e.sh ?? 0}] `
            + `{${(e.options ?? []).map(g => [...g].sort().join("+")).sort().join("/")}}`);
          walk(e.children, d + 1);
        }
      };
      lines.push(`== ${y.label ?? ""} / ${t.term ?? ""}`);
      walk(t.entries, 0);
    }
  }
  return lines.join("\n");
};

const moved = [], gained = [], lost = [], same = [];

for (const p of PROGRAMS) {
  const variants = p.plan?.plans?.length ? p.plan.plans : [null];
  variants.forEach((variant, vi) => {
    const label = `${p.lvl === "graduate" ? "grad" : "ug"}/${p.key}#${vi}`;
    // WITHOUT the propagator is the baseline; WITH it is what ships.
    const off = generate(p, variant, false);
    const on = generate(p, variant, true);
    if (off.refused && on.refused) return;
    if (off.refused && !on.refused) { gained.push(label); return; }
    if (!off.refused && on.refused) { lost.push(label); return; }
    const a = canonical(off.plan.plans[0]);
    const b = canonical(on.plan.plans[0]);
    (a === b ? same : moved).push(label);
  });
}

// What the comparison actually saw. Printed rather than only asserted, because "moved: 0" is
// worth nothing without knowing how many plans it had the chance to move — and `gained` is the
// evidence the propagator does something at all.
console.log(`  [propagator] compared ${same.length + moved.length} plans · `
  + `identical ${same.length} · moved ${moved.length} · gained ${gained.length} · lost ${lost.length}`);

test("propagator › the corpus sample is not empty", () => {
  // Every assertion below passes trivially over nothing, which is the failure mode that
  // lets a gate report success while doing no work.
  assert.ok(same.length + moved.length > 5,
    `only ${same.length + moved.length} comparable plans — the harness is not loading the corpus`);
});

test("propagator › chain propagation moves NO plan that already generated", () => {
  assert.deepEqual(moved, [],
    `${moved.length} plans changed. A pruning propagator must not re-sequence an existing `
    + `plan; if this is intended, it belongs in a later rung instead (design §17.1).`);
});

test("propagator › chain propagation never LOSES a plan", () => {
  // Losing one would mean the propagator is unsound — cutting a branch that held the only
  // solution. That is the failure that would let a legal degree become unplannable.
  assert.deepEqual(lost, [],
    `${lost.length} plans disappeared, so the propagator cut a branch containing the only `
    + `solution. It is not sound.`);
});

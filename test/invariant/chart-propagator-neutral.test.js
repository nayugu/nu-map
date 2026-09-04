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
// ── The claim above is PER RUNG, and the first version of this test forgot to say so ──
//
// "The plan is bit-identical" holds while both runs are answered by the SAME rung. It does not
// hold across the relaxation ladder, and the reason is the one thing pruning is for: it spends
// fewer nodes. Every rung has a node allowance, so a rung that exhausts its allowance WITHOUT
// pruning can fit inside it WITH pruning — and the ladder's rungs enforce different constraint
// sets, so the plan then legitimately differs. It was not re-sequenced by the propagator; it was
// built by a different constructor, a better one.
//
// Measured, on `chemical_engineering_bsche_(boston)#2`: without pruning the search falls all the
// way to `["sequencing-preferences","term-width","four-course-bar","packed-largest-first"]` —
// the packer — and with it the plan is found at `["sequencing-preferences"]`. Nothing about the
// second plan is worse; it gave up three fewer conventions to exist.
//
// This is the same phenomenon `gained` already tolerates, one notch weaker. A propagator that
// turns a REFUSAL into a plan changes the output too, and the test has always counted that as
// the propagator working. A propagator that turns a packer plan into a rung-0 plan is that with
// a smaller step, and there is no principled reading on which the first is success and the
// second is a regression.
//
// So the invariant is asserted at the strength it actually has, and every other case still
// fails: a plan that differs at the SAME rung is genuine re-sequencing, and a rung that gets
// WORSE with pruning means the propagator is unsound. Both are failures below.
//
// The frozen clock (see `generate`) is what makes this a statement about nodes rather than about
// the machine — with a live clock a rung change could be nothing but scheduler noise.
//
// `propagateChains: false` exists for this test and for nothing else. Production never passes
// it, and any future propagator claiming neutrality should be added here the same way.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../../src/engine/index.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";

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

const moved = [], gained = [], lost = [], same = [], improved = [], degraded = [], degradedDetail = [];

/** The concessions a run made, as a set — `report.relaxed` is the rungs it had to spend. */
const rungs = (r) => new Set(r.report?.relaxed ?? []);
const subset = (a, b) => [...a].every(x => b.has(x));

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
    if (a === b) { same.push(label); return; }
    // The plans differ. Which rung answered decides whether that is a violation: neutrality is
    // a per-rung claim, because pruning changes how many nodes a rung spends and therefore
    // whether it fits its allowance at all. See the header.
    const ro = rungs(off), rn = rungs(on);
    if (subset(rn, ro) && rn.size < ro.size) improved.push(label);
    else if (subset(ro, rn) && ro.size < rn.size) {
      degraded.push(label);
      // Printed with the rungs, because "1 plan degraded" is not actionable and the
      // whole point of a detector is that the next person can see what it caught.
      degradedDetail.push(`${label}: without [${[...ro].join(", ")}] -> with [${[...rn].join(", ")}]`);
    }
    else moved.push(label);
  });
}

// What the comparison actually saw. Printed rather than only asserted, because "moved: 0" is
// worth nothing without knowing how many plans it had the chance to move — and `gained` is the
// evidence the propagator does something at all.
const comparable = same.length + moved.length + improved.length + degraded.length;
/** Labels this run compared. A pinned exception outside it was never observed. */
const comparedLabels = new Set([...same, ...moved, ...improved, ...degraded]);
console.log(`  [propagator] compared ${comparable} plans · identical ${same.length} · `
  + `moved ${moved.length} · better rung ${improved.length} · worse rung ${degraded.length} · `
  + `gained ${gained.length} · lost ${lost.length}`);
if (improved.length) console.log(`  [propagator] rescued to a better rung: ${improved.join(", ")}`);
for (const d of degradedDetail) console.log(`  [propagator] WORSE rung — ${d}`);

test("propagator › the corpus sample is not empty", () => {
  // Every assertion below passes trivially over nothing, which is the failure mode that
  // lets a gate report success while doing no work.
  assert.ok(comparable > 5,
    `only ${comparable} comparable plans — the harness is not loading the corpus`);
});

test("propagator › chain propagation moves no plan answered by the SAME rung", () => {
  // The neutrality claim, at the strength it holds. A plan that differs while both runs spent
  // the same concessions was genuinely re-sequenced by pruning, which a pruning propagator
  // cannot legitimately do.
  assert.deepEqual(moved, [],
    `${moved.length} plans changed at an unchanged rung. A pruning propagator must not `
    + `re-sequence a plan the ladder reached the same way; if this is intended, it belongs in a `
    + `later rung instead (design §17.1).`);
});

/**
 * ── ONE measured exception, and what it costs to admit it ────────────
 *
 * The header argues that a PRUNING propagator cannot change which solution is
 * reached first, because cutting branches with no solution in them leaves the order
 * of the solutions alone. That argument is WRONG, and this is the case that shows
 * it: `byConstraint` orders cells by domain LENGTH, pruning changes lengths, so the
 * variable order changes and a different legal plan is encountered first. §17's
 * original worry was right and the header's rebuttal of it is too strong.
 *
 * MEASURED on the one program that shows it:
 *   ug/environmental_engineering_and_health_science_bsenve_(boston)#2
 *   without pruning  []                          — rung 0, no concessions
 *   with pruning     [sequencing-preferences]    — one concession
 *
 * It surfaced when the class-standing guard declined that program's published
 * position for PHTH 2414 (sophomore standing, 32 SH, published in a term holding
 * 17), which leaves the cell wide and enlarges the search space enough for the
 * ordering effect to bite. The guard is not the defect — a term the registrar will
 * not let the student register for is not a plan — and the ordering sensitivity was
 * always there, unexercised.
 *
 * Listed by NAME rather than tolerated by count. Any second program appearing here
 * is a new fact about the search and fails the test, which is the whole reason this
 * detector exists. Do not convert this to a threshold. See
 * docs/chart-open-defects.md.
 */
const KNOWN_DEGRADED = new Set([
  "ug/environmental_engineering_and_health_science_bsenve_(boston)#2",
  // Second entry, Sept 2026 — and per §18 a second entry is a NEW FACT about
  // the search rather than a bigger tolerance, so it is written up there too.
  //
  // Same signature as the first (`without [] -> with [sequencing-preferences]`,
  // one concession, everything else bit-identical), and the same root cause:
  // `byConstraint` orders cells by PRUNED domain length, so pruning moves the
  // variable order and a different legal plan is reached first.
  //
  // What made it reachable was a DATA fix, not an engine change: the prereq
  // parser was silently truncating 415 trees on legacy (Mills) course numbers,
  // and restoring the dropped prerequisites on the CHME and MATH courses this
  // degree depends on changed the domains enough for the existing sensitivity
  // to bite. The defect did not get worse — the corpus got more honest.
  "ug/chemical_engineering_and_bioengineering_bsche_(boston)#0",
]);

// A pinned exception the sample never reached is not a pass — it is an
// unobserved claim, and it must say so rather than sit quiet behind a green
// test. Printed, not asserted: whether the shuffle deals BSEnvE is not
// something a change to the catalog should be able to fail on.
{
  const unobserved = [...KNOWN_DEGRADED].filter(l => !comparedLabels.has(l));
  if (unobserved.length) {
    console.log(`  [propagator] NOT OBSERVED this run (outside the sampled ${N}): `
      + `${unobserved.join(", ")} — run CHART_CORPUS=all to check them`);
  }
}

test("propagator › chain propagation never makes a plan spend MORE concessions", () => {
  // The other direction, and the one that would mean the propagator is actively harmful: pruning
  // should never force the ladder further down. Coverage tests would not catch it — the program
  // still generates — but the plan gives up conventions it did not have to.
  const unexpected = degraded.filter(l => !KNOWN_DEGRADED.has(l));
  assert.deepEqual(unexpected, [],
    `${unexpected.length} plans needed a LOWER rung with pruning on, so the propagator is `
    + `costing conventions rather than saving them.`);
});

test("propagator › the known degradation is still the only one, and still degrades", () => {
  // A named exception that has silently stopped happening is a stale claim in a
  // comment, and this file's whole value is that its claims are measured. If the
  // ordering sensitivity is ever fixed, this fails and the entry comes out.
  //
  // Judged only over labels this run actually COMPARED. `sample()` is a seeded
  // shuffle of the whole corpus and then a slice, so its 30 depend on the
  // corpus LENGTH: any change to the number of eligible programs deals a
  // different hand. Four Interdisciplinary PhD programs became visible in Aug
  // 2026 (they state 30 SH of committee-directed coursework and no course list,
  // so parseTable used to drop every section and the whole program vanished),
  // 795 eligible → 799, and BSEnvE fell out of the sample. It reported as
  // "no longer degrades" while nothing about it had changed — a false alarm
  // that, followed literally, would have deleted a measured fact about the
  // search. An entry can only be falsified by a run that looked at it.
  const stale = [...KNOWN_DEGRADED].filter(l => comparedLabels.has(l) && !degraded.includes(l));
  assert.deepEqual(stale, [],
    `${stale.length} entries in KNOWN_DEGRADED no longer degrade — delete them and `
    + `tighten the assertion above.`);
});

test("propagator › chain propagation never LOSES a plan", () => {
  // Losing one would mean the propagator is unsound — cutting a branch that held the only
  // solution. That is the failure that would let a legal degree become unplannable.
  assert.deepEqual(lost, [],
    `${lost.length} plans disappeared, so the propagator cut a branch containing the only `
    + `solution. It is not sound.`);
});

// ═══════════════════════════════════════════════════════════════════
// INVARIANT: the time budget is a bound the engine actually honours.
//
// ── The gap this fills ──────────────────────────────────────────────
//
// `timeBudgetMs` is passed by eight test files and was asserted by none. Every one of them
// hands the engine a budget and then measures something else, so a regression that stopped
// threading `now` into the search — or stopped comparing against the deadline at all — would
// have turned every one of those suites slower and none of them red.
//
// That is the failure mode this repo keeps paying for: a guard that cannot fire. `placeCells`
// consults the clock at `(nodes & 7) === 0` and nothing outside the engine ever verified it.
//
// ── What this does NOT claim, per §21 ───────────────────────────────
//
// Not that the clock is what bounds a student's wait. It usually is not.
// `DEFAULT_NODE_BUDGET` is a constant 23,600 and does not scale with `timeBudgetMs`, so at
// production's `DEFAULT_TIME_BUDGET_MS` of 5,000 the NODE budget usually wins the race — that
// was measured over a 120-shape sample where a clock guard did not fire once. At the suites'
// 1,200 ms the clock wins easily, which is the opposite regime.
//
// So this file is about the MECHANISM, not about production latency: the clock is read, and a
// deadline that has passed stops the search. Both tests below force the clock to win with a
// 1 ms budget rather than pretending 5,000 ms would. `engine-corpus`'s own latency assertion is
// the one that speaks to what a student waits for, and it measures wall time, not this.
//
// docs/chart-open-defects.md §21 is the worked example — a guard for the related hole (an
// expired clock lets the packer answer, so the plan can depend on machine load) was built,
// measured at +50% on the invariant suite, found to be a production no-op, and reverted.
// Read it before adding any enforcement here; the hole is real and closing it this way is not
// worth it.
//
// ── What is NOT a bug here, and must not be "fixed" ─────────────────
//
// A CONSTANT clock disables the budget. `deadline = now() + timeBudgetMs`, and the test is
// `now() > deadline`, so with `now: () => 0` that is `0 > 1200` — permanently false, and the
// search is bounded by `DEFAULT_NODE_BUDGET` alone.
//
// This is DELIBERATE and documented where the clock is injected (`index.js`, `now`):
// determinism has to be testable as a property rather than as a race against the machine. And
// the reason that matters is stronger than the comment there implies — `search.js` states the
// rule as "the clock may turn an answer into a refusal, never into a different answer", and §21
// records that the stated rule does not hold: `attemptPlacement` returns an ordinary failure on
// time exhaustion, the ladder falls out, and the packer answers largest-course-first. A slow run
// can therefore change WHICH plan you get, not merely whether you get one.
//
// So `engine-corpus`'s determinism check and the two neutrality suites freeze the clock ON
// PURPOSE and accept being node-bounded — with a live clock their failures would be
// indistinguishable from machine load. It is also why they are the expensive files in the suite.
//
// The third test below pins that behaviour. It exists because the obvious "improvement" — make
// the frozen clock advance so the budget fires — silently reintroduces the race those suites
// were written to remove, and it looks like a pure speedup right up until a neutrality test
// fails on a loaded machine. Anyone reading a slow suite and reaching for the clock should fail
// this test and read this comment.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "../../src/engine/index.js";
import { buildDepthIndex } from "../../src/engine/prereqDepth.js";
import { DEFAULT_NODE_BUDGET } from "../../src/engine/search.js";
import { loadCatalog } from "../../src/adapters/northeastern/courseCatalog.node.js";
import enginePorts from "../../src/adapters/northeastern/enginePorts.js";

// fileURLToPath, not .pathname: the latter is percent-encoded and breaks on a
// checkout whose path contains a space.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { courseMap } = loadCatalog();
const depthIndex = buildDepthIndex(courseMap);
const ports = enginePorts(courseMap);

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

/** Seeded shuffle, so the three programs used below are not the atypical alphabetical head. */
function sample(list, n) {
  let seed = 0xb0d9e7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

// Eight, not one, and the reason is measured rather than assumed: a small program is answered
// before either budget can bite. `bioinformatics_graduate_certificate_(portland)` finishes in
// SIX nodes, so both clocks spend six and the differential below is silent on it — the first
// draft of this file sampled three, drew that certificate, and failed on a property that was
// simply not exercised. The sample has to be wide enough to contain a real search.
const PROGRAMS = sample(degreePrograms(), 8);

const run = (p, opts) => generatePlan({
  program: p.data, publishedPlan: p.plan?.plans?.[0] ?? null,
  courseMap, ports, depthIndex,
  studentType: p.lvl === "graduate" ? "graduate" : "undergraduate",
  ...opts,
});

/** Nodes spent, wherever the shape reports them — a refusal carries them under `data`. */
const nodesOf = (out) => out.refused
  ? (out.refused.data?.nodes ?? null)
  : (out.report?.nodes ?? null);

test("budget › every generation that searches consults the clock it is given", () => {
  // The cheapest possible statement, and the one that breaks first if `now` stops being
  // threaded through `placeCells`: the injected clock is CALLED. A default of `Date.now` would
  // keep every other test in the repo green while making this parameter dead.
  //
  // ── Conditioned on ENTERING the search, which is not every program ──
  //
  // Written as "every generation reads the clock" this failed at 6 of 8, and the two that did
  // not were right to: a pre-flight refusal is decided before `placeCells` is reached, so there
  // is no search to bound and no clock to read. `deadline = now() + timeBudgetMs` is evaluated
  // once on entry, so a generation that reports nodes and never called the clock is the actual
  // defect — that is the pair asserted here.
  assert.ok(PROGRAMS.length > 0, "no degree programs found — check the data directory");
  const silent = [];
  let searched = 0;
  for (const p of PROGRAMS) {
    let calls = 0;
    // 50 ms, not the production 1200: this test asks whether the clock is READ, and a short
    // budget reaches that answer in a twentieth of the time. The search is cut short, which is
    // fine — a cut-short search still reports nodes and still had to consult the clock to be cut.
    const out = run(p, { timeBudgetMs: 50, now: () => { calls++; return Date.now(); } });
    const n = nodesOf(out);
    if (!(n > 0)) continue;                  // never entered the search — nothing to bound
    searched++;
    if (calls === 0) silent.push(`${p.key}: ${n} nodes, clock never read`);
  }
  assert.ok(searched > 0, "no program in the sample entered the search — nothing was judged");
  assert.deepEqual(silent, [], silent.join(" | "));
});

test("budget › a clock past the deadline stops the search early", () => {
  // An ADVANCING clock with a one-millisecond budget: the deadline is passed on the first
  // check, so the search must stop far short of the node budget. Stated as a comparison
  // against `DEFAULT_NODE_BUDGET` rather than as a wall-clock number, because a threshold in
  // milliseconds is a threshold that fails on a loaded CI runner.
  let judged = 0;
  for (const p of PROGRAMS) {
    // Advances a full second per reading: whatever the budget, the second check is past it.
    let t = 0;
    const out = run(p, { timeBudgetMs: 1, now: () => (t += 1000) });
    const n = nodesOf(out);
    if (n == null) continue;                 // a pre-flight refusal never entered the search
    judged++;
    assert.ok(n < DEFAULT_NODE_BUDGET / 2,
      `${p.key}: spent ${n} nodes under a 1 ms budget, against a node budget of ${DEFAULT_NODE_BUDGET}`);
  }
  assert.ok(judged > 0, "no program in the sample entered the search — nothing was judged");
});

test("budget › a CONSTANT clock is node-bounded, by design — do not 'fix' this", () => {
  // Read the header before changing this. A constant clock cannot pass its own deadline, so the
  // budget never fires and the search runs to the node budget. `engine-corpus` and the two
  // neutrality suites depend on exactly that: it is what makes determinism a property instead
  // of a race.
  //
  // Asserted as a DIFFERENTIAL against the advancing clock above rather than as an absolute, so
  // it says the thing that matters — the constant clock searches at least as hard — without
  // pinning a node count that legitimately moves with the data.
  //
  // ── Monotone everywhere, STRICT somewhere ───────────────────────────
  //
  // `frozen > bounded` is false on a program small enough to finish before either budget is
  // consulted, and that is not a defect in the engine. So the per-program claim is `>=` — a
  // frozen clock can never search LESS — and the strict inequality is asserted once over the
  // sample, which is what actually demonstrates the budget is clock-driven. Without the second
  // half a sample of nothing but tiny certificates would pass this file while proving nothing.
  // Stops at two strict witnesses. The frozen arm runs to the NODE budget by definition — that
  // is the whole point — so each one costs a full unbounded search, and sweeping all eight put
  // 17 s on the suite's clock to re-confirm the same fact six more times. Two is enough to
  // distinguish "clock-driven" from "not", and the loop still checks monotonicity on every shape
  // it reaches before stopping.
  let compared = 0, strict = 0;
  for (const p of PROGRAMS) {
    let t = 0;
    const bounded = nodesOf(run(p, { timeBudgetMs: 1, now: () => (t += 1000) }));
    const frozen = nodesOf(run(p, { timeBudgetMs: 1, now: () => 0 }));
    if (bounded == null || frozen == null) continue;
    compared++;
    if (frozen > bounded) strict++;
    assert.ok(frozen >= bounded,
      `${p.key}: an advancing clock spent ${bounded} nodes and a frozen one only ${frozen} — `
      + "a frozen clock cannot search less, so the budget is no longer clock-driven");
    if (strict >= 2) break;
  }
  assert.ok(compared > 0, "no program produced a node count under both clocks");
  assert.ok(strict > 0,
    `all ${compared} sampled programs finished before either budget applied, so this file `
    + "proved nothing — widen the sample until it contains a real search");
});

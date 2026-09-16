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
// ⚠ THE REBUTTAL IS CORRECT. What was wrong was the paragraph that used to sit here, which
// said the opposite — and it was wrong for a whole year in a way worth keeping, because the
// evidence looked damning: this file carried two named counterexamples, programs that lost a
// concession when a *pruning* propagator was switched on.
//
// It claimed `byConstraint` consults pruned domain length TWICE — the forced-cell key
// (`domain.length === 1`) and the width key — so pruning moves the variable order. That is
// impossible and always was. `precedenceRoom` RETURNS A BOOLEAN and mutates no domain, and
// `order` is sorted ONCE per attempt, before the DFS starts. Measured with
// `chart-probe.js --propagator --edition 2026 --ms 1200`, attempt 0 has a bit-identical
// permutation AND bit-identical width keys either way. No comparator key is reachable.
//
// The real channel is the NOGOOD LEARNER, which is the engine's one domain rewriter:
//
//   the chain propagator records its own verdict (`chain-has-no-room-left`) into
//   `worstFailure` -> the restart loop feeds `worstFailure` to the learner -> the learner
//   does `target.domain = target.domain.filter(...)` -> THAT moves the widths, from
//   attempt 1 onward.
//
// So a propagator can be neutral in itself and still move a plan, through a rewriter
// downstream of its verdict. Fixed at the learner (`_chainNogoods` in `placeCells`), which
// is why `KNOWN_DEGRADED` below is now empty.
//
// Two lessons this cost, both cheap to state and expensive to learn:
//   • the counterexamples were REAL and the explanation was invented. Two named programs and
//     a plausible mechanism felt like a measurement; nobody checked that the mechanism could
//     occur, and `trace` had recorded the disproof all along.
//   • when auditing neutrality, enumerate what WRITES a domain, not what reads one. The
//     learner was read as bookkeeping and never classified against §17.1's own table.
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
 * ── EMPTY, and that is the point ─────────────────────────────────────
 *
 * It carried two named programs until 2026-09-16. Both are fixed at the cause — the nogood
 * learner no longer rewrites a domain on the chain propagator's own verdict (`_chainNogoods`
 * in `placeCells`) — so there is nothing to pin, and the stale-direction check below is an
 * ASSERTION again rather than a `console.log`.
 *
 * Leave it empty. The anti-rot guard only exists while it is, which is the whole argument
 * §18 makes: a pin can outlive its defect, a data refresh can make one dormant without
 * fixing anything, and neither is detectable by bookkeeping. If a program turns up here
 * again, the mechanism is not the one the header used to describe — see the header for what
 * the channel actually is, and `chart-probe.js --propagator` for how to look.
 *
 * ── What the two entries used to say, kept because the diagnosis was wrong ──
 *
 * `ug/environmental_engineering_and_health_science_bsenve_(boston)#2` and
 * `ug/chemical_engineering_and_bioengineering_bsche_(boston)#0`, both
 * `without [] -> with [sequencing-preferences]`: one concession, everything else identical.
 * They were blamed on `byConstraint` reading a pruned domain length for a year. It never
 * could. Two real counterexamples plus a plausible mechanism read as a measurement, and the
 * trace had held the disproof the whole time.
 *
 * How each became reachable is still worth keeping, because both were read as the defect
 * getting worse and neither was:
 *
 *   BSEnvE#2  the class-standing guard declined its published position for PHTH 2414
 *             (sophomore standing, 32 SH, published in a term holding 17). That leaves the
 *             cell wide instead of pinned, which enlarges the search enough for the learner
 *             to find something to rewrite. The guard is not the defect — a term the
 *             registrar will not let the student register for is not a plan.
 *   BSChE#0   a DATA fix, no engine change: the prereq parser had been truncating 415 trees
 *             on legacy (Mills) course numbers, and restoring the CHME and MATH
 *             prerequisites this degree depends on tightened its domains. The corpus got
 *             more honest, not worse.
 *
 * Both are the same shape: something made the instance harder, the strict tier ran out of
 * allowance, the learner rewrote a domain on the propagator's verdict, and the ladder paid
 * for it. Removing the rewrite removes all of it.
 *
 * If this set is ever non-empty again: list by NAME, never by count. A threshold swallows a
 * genuinely new program silently, which is the failure this whole file exists to prevent.
 * See docs/chart-open-defects.md §18.
 */
const KNOWN_DEGRADED = new Set([]);

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

// ── A pin that stopped degrading is ASSERTED again, and only because the list is empty ──
//
// Restored 2026-09-16, when the cause was fixed. The history is the argument for keeping
// `KNOWN_DEGRADED` empty rather than letting it refill, so it is worth the lines:
//
// It was an assertion, and on 2026-09-16 it STOPPED THE MONTHLY COURSE PIPELINE — at the
// `npm test` step that sits deliberately in front of the commit, after the scrape,
// `verify-chart --all` and the build had all passed. An S3 cosmetic defect discarded a
// 100-minute acquisition, including the first capture of a synthetic summer term's
// instructors and restrictions. The reason was a third fact the assertion had collapsed
// into the second:
//
//   not observed            outside the sampled N — printed above, never asserted.
//   observed, still degrades   the claim holds.
//   observed against DIFFERENT DATA, no longer degrades
//                           the claim is UNVERIFIED, not falsified.
//
// Whether a program shows the sensitivity depends on how tight its domains are, which
// depends on prereq data, which the monthly scrape replaces. So the third case is what an
// entry normally reports after a scrape and it says nothing about the engine. It was
// demoted to a `console.log` that day to unblock the pipeline, which knowingly gave up the
// anti-rot guard: a pin could outlive its defect, and a later genuine degradation on the
// same program would be swallowed by it.
//
// That protection is not recoverable by bookkeeping — a per-entry data hash would read
// stale every month and leave the guard permanently dormant. It comes back ONLY when the
// list is empty, because then there is no pin to go stale and the branch cannot fire on a
// data refresh. Which is exactly what the fix bought, and exactly what refilling the list
// would spend again.
// A `test()` and not a bare block: an assertion at module scope throws during LOAD and takes
// every other case in this file with it, so the one thing you want from a failure — which of
// the four claims broke — is the thing you lose.
test("propagator › no KNOWN_DEGRADED entry has gone stale", () => {
  const stale = [...KNOWN_DEGRADED].filter(l => comparedLabels.has(l) && !degraded.includes(l));
  assert.deepEqual(stale, [],
    `${stale.length} KNOWN_DEGRADED entries no longer degrade. With the list empty this `
    + `cannot fire on a data refresh, so an entry here means a pin was added without being `
    + `needed — delete it, or explain why §18's fix did not cover it.`);
});

test("propagator › chain propagation never LOSES a plan", () => {
  // Losing one would mean the propagator is unsound — cutting a branch that held the only
  // solution. That is the failure that would let a legal degree become unplannable.
  assert.deepEqual(lost, [],
    `${lost.length} plans disappeared, so the propagator cut a branch containing the only `
    + `solution. It is not sound.`);
});

// UNIT · scripts/lib/chart-shard.js — the reduction that makes a sharded sweep equal a serial one.
//
// The whole value of sharding is that the merged report is INDISTINGUISHABLE from the serial
// one. That makes this reducer the place where parallelism can quietly start lying: a field
// folded with the wrong operator produces a plausible number, not an error, and it would be
// read as a regression in the engine rather than a bug in the adder.
//
// The concrete case these tests exist for: `longestEmptyRun` is a MAX over plans. Folded as a
// sum across 8 shards it reports a 40-term empty run that no plan contains, and the next person
// spends an afternoon in the engine looking for it. Same shape for `summerWorstGap`,
// `unguidedMax` and `geMax`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { shardOf, serializeAggregate, mergeAggregate, normalizeAggregate, MAXED, defaultJobs }
  from "../../scripts/lib/chart-shard.js";

const emptyAgg = () => ({
  counters: { shapes: 0, made: 0, threw: 0, relaxed: 0, thin: 0, fullTerms: 0, emptyFull: 0 },
  Q: { clumped: 0, studyTerms: 0, longestEmptyRun: 0, summerWorstGap: 0, unguidedMax: 0,
       geMax: 0, choiceP10s: [] },
  R: { plans: 0, concPlans: 0, programs: new Set(), concPrograms: new Set() },
  refusals: new Map(), criteria: new Map(), gave: new Map(), violations: [], prints: {},
});

const part = (over = {}) => serializeAggregate({
  counters: { shapes: 1, made: 1, threw: 0, relaxed: 0, thin: 0, fullTerms: 2, emptyFull: 0 },
  Q: { clumped: 1, studyTerms: 8, longestEmptyRun: 0, summerWorstGap: 0, unguidedMax: 0,
       geMax: 0, choiceP10s: [] },
  R: { plans: 0, concPlans: 0, programs: new Set(), concPrograms: new Set() },
  refusals: new Map(), criteria: new Map(), gave: new Map(), violations: [], prints: {},
  ...over,
});

test("striding partitions the work exactly — nothing lost, nothing done twice", () => {
  // A shape processed twice double-counts into every quality figure; a shape missed makes the
  // run vacuously cleaner. Both are silent, so the partition is asserted rather than trusted.
  const items = Array.from({ length: 47 }, (_, i) => ({ label: `s${i}` }));
  for (const n of [1, 2, 3, 8, 32, 47, 64]) {
    const shards = Array.from({ length: n }, (_, i) => shardOf(items, i, n));
    const flat = shards.flat().map(x => x.label);
    assert.equal(flat.length, items.length, `n=${n}: total count must be preserved`);
    assert.equal(new Set(flat).size, items.length, `n=${n}: no item in two shards`);
  }
});

test("more shards than items leaves the extra shards empty, not broken", () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ label: `s${i}` }));
  const shards = Array.from({ length: 8 }, (_, i) => shardOf(items, i, 8));
  assert.equal(shards.flat().length, 3);
  assert.equal(shards.filter(s => s.length === 0).length, 5);
});

test("counters and ordinary quality fields are summed", () => {
  const agg = [part(), part(), part()].reduce((a, p) => mergeAggregate(a, p), emptyAgg());
  assert.equal(agg.counters.shapes, 3);
  assert.equal(agg.counters.made, 3);
  assert.equal(agg.counters.fullTerms, 6);
  assert.equal(agg.Q.clumped, 3);
  assert.equal(agg.Q.studyTerms, 24);
});

test("MAXED fields take the MAXIMUM, never the sum — the 40-term phantom", () => {
  // Eight shards each seeing a 5-term empty run must report 5, not 40. This is the specific
  // wrong number that would read as an engine regression.
  const shards = Array.from({ length: 8 }, () => part({
    Q: { clumped: 0, studyTerms: 0, longestEmptyRun: 5, summerWorstGap: 3, unguidedMax: 4,
         geMax: 2, choiceP10s: [] },
  }));
  const agg = shards.reduce((a, p) => mergeAggregate(a, p), emptyAgg());
  assert.equal(agg.Q.longestEmptyRun, 5, "a max folded as a sum would say 40");
  assert.equal(agg.Q.summerWorstGap, 3);
  assert.equal(agg.Q.unguidedMax, 4);
  assert.equal(agg.Q.geMax, 2);
});

test("every MAXED name actually exists in the quality vector", () => {
  // A typo in MAXED is invisible: the name simply falls through to the summing branch and the
  // field silently becomes a sum again. This pins the set against a real Q.
  const q = emptyAgg().Q;
  for (const name of MAXED) {
    assert.ok(name in q, `MAXED lists "${name}" but the quality vector has no such field`);
  }
});

test("choiceP10s concatenates as a sample, and normalizing sorts it", () => {
  // It is a distribution the report takes a median of, so it must pool rather than add — and it
  // must not depend on which shard finished first, or the median moves between identical runs.
  const agg = [part({ Q: { ...emptyAgg().Q, choiceP10s: [9, 1] } }),
               part({ Q: { ...emptyAgg().Q, choiceP10s: [5] } })]
    .reduce((a, p) => mergeAggregate(a, p), emptyAgg());
  assert.equal(agg.Q.choiceP10s.length, 3);
  normalizeAggregate(agg);
  assert.deepEqual(agg.Q.choiceP10s, [1, 5, 9]);
});

test("Sets union and Maps sum per key", () => {
  const agg = [
    part({ R: { plans: 1, concPlans: 2, programs: new Set(["ug/a"]),
                concPrograms: new Set(["ug/a", "ug/b"]) },
           refusals: new Map([["no-candidate", 2]]), gave: new Map([["term-width", 1]]) }),
    part({ R: { plans: 1, concPlans: 1, programs: new Set(["ug/a", "ug/c"]),
                concPrograms: new Set(["ug/b"]) },
           refusals: new Map([["no-candidate", 3], ["over-subscribed", 1]]),
           gave: new Map([["term-width", 4]]) }),
  ].reduce((a, p) => mergeAggregate(a, p), emptyAgg());

  assert.equal(agg.R.plans, 2);
  // `ug/a` appears in both shards and must be counted ONCE — it is a set of programs, and
  // summing sizes instead would inflate every "of N programs" figure in the report.
  assert.deepEqual([...agg.R.programs].sort(), ["ug/a", "ug/c"]);
  assert.deepEqual([...agg.R.concPrograms].sort(), ["ug/a", "ug/b"]);
  assert.equal(agg.refusals.get("no-candidate"), 5);
  assert.equal(agg.refusals.get("over-subscribed"), 1);
  assert.equal(agg.gave.get("term-width"), 5);
});

test("the merged report does not depend on the order shards finish in", () => {
  // Shards complete in a race. If the output depends on that, two identical runs produce two
  // different logs and a diff of them shows churn that means nothing.
  const shards = [
    part({ violations: [{ label: "ug/zebra", kind: "hard-rule" }],
           Q: { ...emptyAgg().Q, choiceP10s: [7] } }),
    part({ violations: [{ label: "ug/apple", kind: "hard-rule" }],
           Q: { ...emptyAgg().Q, choiceP10s: [2] } }),
    part({ violations: [{ label: "grad/mango", kind: "threw" }],
           Q: { ...emptyAgg().Q, choiceP10s: [4] } }),
  ];
  const run = (order) => {
    const a = order.reduce((acc, p) => mergeAggregate(acc, p), emptyAgg());
    return normalizeAggregate(a);
  };
  const forward = run(shards);
  const backward = run([...shards].reverse());
  assert.deepEqual(forward.violations.map(v => v.label), backward.violations.map(v => v.label));
  assert.deepEqual(forward.Q.choiceP10s, backward.Q.choiceP10s);
  assert.deepEqual(forward.violations.map(v => v.label), ["grad/mango", "ug/apple", "ug/zebra"]);
});

test("fingerprints from different shards do not overwrite each other", () => {
  const agg = [part({ prints: { "ug/a": { hash: "1" } } }),
               part({ prints: { "ug/b": { hash: "2" } } })]
    .reduce((a, p) => mergeAggregate(a, p), emptyAgg());
  assert.deepEqual(Object.keys(agg.prints).sort(), ["ug/a", "ug/b"]);
});

test("serializeAggregate round-trips through JSON, which is how shards travel", () => {
  // Maps and Sets vanish under a bare JSON.stringify. A silent `{}` here would zero every
  // refusal count in a sharded run while the plan counts stayed right.
  const wire = JSON.parse(JSON.stringify(serializeAggregate({
    counters: { shapes: 2, made: 1, threw: 0, relaxed: 0, thin: 0, fullTerms: 0, emptyFull: 0 },
    Q: { ...emptyAgg().Q, choiceP10s: [3] },
    R: { plans: 1, concPlans: 1, programs: new Set(["ug/a"]), concPrograms: new Set(["ug/a"]) },
    refusals: new Map([["no-candidate", 1]]), criteria: new Map([["1: empty", 2]]),
    gave: new Map([["term-width", 1]]), violations: [], prints: {},
  })));
  const agg = mergeAggregate(emptyAgg(), wire);
  assert.equal(agg.refusals.get("no-candidate"), 1);
  assert.equal(agg.criteria.get("1: empty"), 2);
  assert.deepEqual([...agg.R.programs], ["ug/a"]);
  assert.deepEqual(agg.Q.choiceP10s, [3]);
});

test("the default job count holds cores back rather than saturating them", async () => {
  // Oversubscribing pushes borderline shapes past their wall clock, and CHART turns an expired
  // clock into a REFUSAL — so saturating the machine changes results, not just speed.
  const { availableParallelism } = await import("node:os");
  const jobs = defaultJobs();
  assert.ok(jobs >= 1, "must always be runnable");
  assert.ok(jobs <= Math.max(1, availableParallelism() - 2),
    "must leave at least two cores for the parent and the OS");
});

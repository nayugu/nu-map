// ═══════════════════════════════════════════════════════════════════
// CHART · SHARDING — spending the other nine cores
//
// The sweep ran at 94% of ONE core on a 10-core machine, sequentially, for 4–10
// minutes. Every shape is an independent pure function of (program, variant, catalog),
// and every accumulator in `verify-chart.js` is a sum, a max, a Map or a Set — so the
// run is embarrassingly parallel and the reduction is exact, not approximate.
//
// ── Why child processes and not worker_threads ──────────────────────
//
// Separate heaps. Each child re-reads the catalog, which is **364 ms** — measured, and
// the reason the "throwaway scripts reload the catalog" complaint was never the real
// cost. Against a multi-minute run that is free, and it buys total isolation: no shared
// mutable engine state, no structured-clone of the 8,000-course map, and a child that
// throws cannot corrupt the parent's tally.
//
// ── The determinism hazard, stated plainly ──────────────────────────
//
// This is NOT a free lunch, for a reason specific to this engine. The search is
// node-bounded, but the wall clock survives as an outer guard, and when it fires the
// answer is a REFUSAL (`search-budget-exhausted`). So a shape that is slow enough to
// sit near its 5,000 ms budget can generate on an idle machine and refuse on a loaded
// one. Contention therefore changes results — which is exactly why running two sweeps
// at once produced two unusable numbers.
//
// Two things follow, and both are load-bearing:
//
//   1. Default `--jobs` to cores-2, never cores. Oversubscribing is what pushes
//      borderline shapes over their budget.
//   2. A sharded run must be proved equal to a serial one, not assumed equal. Take
//      `--fingerprint` both ways and diff with `chart-fingerprint-diff`; `moved` and
//      `lost` must be 0. Do this on the SAMPLE (3:47 serial) rather than the corpus,
//      so the check costs four minutes instead of twenty.
//
// If a fingerprint diff ever shows movement, the answer is fewer jobs — never a bigger
// budget, which would only move the boundary rather than remove it.
// ═══════════════════════════════════════════════════════════════════

import { availableParallelism } from "node:os";

/**
 * Default worker count: two cores held back deliberately.
 *
 * One for the parent and one for the OS, so the workers are not competing with the
 * thing collecting their results. See the determinism hazard above — this is a
 * correctness margin, not politeness.
 */
export function defaultJobs() {
  return Math.max(1, (availableParallelism?.() ?? 4) - 2);
}

/**
 * Which shapes belong to shard `i` of `n`.
 *
 * Strided (`index % n`), not contiguous blocks. Cost per shape varies by more than an
 * order of magnitude and the corpus is ordered by college, so contiguous blocks give
 * one worker every hard program in a department and the run takes as long as its
 * unluckiest shard. Striding mixes cheap and expensive shapes into every worker.
 */
export function shardOf(items, i, n) {
  return items.filter((_, idx) => idx % n === i);
}

/** The accumulator set, as JSON. Maps and Sets do not survive `JSON.stringify` alone. */
export function serializeAggregate(a) {
  return {
    counters: a.counters,
    Q: a.Q,
    R: { plans: a.R.plans, concPlans: a.R.concPlans,
         programs: [...a.R.programs], concPrograms: [...a.R.concPrograms] },
    refusals: [...a.refusals], criteria: [...a.criteria], gave: [...a.gave],
    violations: a.violations,
    prints: a.prints,
  };
}

/**
 * Fold one shard's result into the parent's accumulators, in place.
 *
 * Every field is reduced by the operation its own semantics demand — and the three
 * kinds are NOT interchangeable. `longestEmptyRun` is a max over plans; folding it as a
 * sum would report a 40-term empty run across eight shards and send someone hunting a
 * defect that does not exist. `summerWorstGap`, `unguidedMax` and `geMax` are the same
 * shape. Everything else in Q is a sum, and `choiceP10s` is a sample that concatenates.
 */
export const MAXED = new Set(["longestEmptyRun", "summerWorstGap", "unguidedMax", "geMax"]);

export function mergeAggregate(into, part) {
  for (const [k, v] of Object.entries(part.counters)) into.counters[k] += v;
  for (const [k, v] of Object.entries(part.Q)) {
    if (k === "choiceP10s") into.Q.choiceP10s.push(...v);
    else if (MAXED.has(k)) into.Q[k] = Math.max(into.Q[k], v);
    else into.Q[k] += v;
  }
  into.R.plans += part.R.plans;
  into.R.concPlans += part.R.concPlans;
  for (const p of part.R.programs) into.R.programs.add(p);
  for (const p of part.R.concPrograms) into.R.concPrograms.add(p);
  for (const [k, n] of part.refusals) into.refusals.set(k, (into.refusals.get(k) ?? 0) + n);
  for (const [k, n] of part.criteria) into.criteria.set(k, (into.criteria.get(k) ?? 0) + n);
  for (const [k, n] of part.gave) into.gave.set(k, (into.gave.get(k) ?? 0) + n);
  into.violations.push(...part.violations);
  Object.assign(into.prints, part.prints);
  return into;
}

/**
 * Order-independence, asserted rather than hoped for.
 *
 * `violations` arrives in shard-completion order, which is a race. Left alone, the
 * "first 25" the report prints would differ run to run and a diff of two logs would show
 * churn that means nothing. Sorting by label makes the output a function of the inputs
 * only — the same property the engine's own determinism rule protects.
 */
export function normalizeAggregate(a) {
  a.violations.sort((x, y) => String(x.label).localeCompare(String(y.label)));
  a.Q.choiceP10s.sort((x, y) => x - y);
  return a;
}

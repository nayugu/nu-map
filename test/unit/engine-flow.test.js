// UNIT · max-flow and feasibility under lower bounds.
//
// This is the one piece of the engine that is pure algorithm, which cuts both ways: it can be
// tested against ground truth, and it MUST be, because a subtly wrong flow does not crash —
// it returns a plausible number, and every conclusion drawn from it is wrong in a way that
// looks like a scheduling opinion.
//
// So the last test here is differential against brute force over hundreds of random
// instances. Hand-written cases catch what you thought of; the differential catches what you
// did not, and it is the only one of these that could find an error in the DFS retreat logic.
import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, addEdge, maxFlow, feasibleWithLowerBounds } from "../../src/engine/flow.js";

const flowOf = (n, edges, s, t) => {
  const g = buildGraph(n);
  for (const [u, v, c] of edges) addEdge(g, u, v, c);
  return maxFlow(g, s, t);
};

test("flow › a single arc carries its capacity", () => {
  assert.equal(flowOf(2, [[0, 1, 5]], 0, 1), 5);
});

test("flow › a chain is limited by its narrowest arc", () => {
  assert.equal(flowOf(4, [[0, 1, 10], [1, 2, 3], [2, 3, 10]], 0, 3), 3);
});

test("flow › parallel paths sum", () => {
  assert.equal(flowOf(4, [[0, 1, 4], [1, 3, 4], [0, 2, 6], [2, 3, 6]], 0, 3), 10);
});

test("flow › the classic instance that needs a residual PUSH BACK", () => {
  // CLRS figure 26.1. A greedy path through the middle arc must be partly undone, so a solver
  // without working reverse edges reports 19 and this returns 23. The single most valuable
  // hand-written case here.
  const edges = [
    [0, 1, 16], [0, 2, 13], [1, 2, 10], [2, 1, 4],
    [1, 3, 12], [3, 2, 9], [2, 4, 14], [4, 3, 7], [3, 5, 20], [4, 5, 4],
  ];
  assert.equal(flowOf(6, edges, 0, 5), 23);
});

test("flow › no path means no flow", () => {
  assert.equal(flowOf(3, [[0, 1, 5]], 0, 2), 0);
});

test("flow › source and sink the same node", () => {
  assert.equal(flowOf(2, [[0, 1, 5]], 0, 0), 0);
});

test("flow › a zero-capacity arc carries nothing", () => {
  assert.equal(flowOf(2, [[0, 1, 0]], 0, 1), 0);
});

test("flow › a cycle does not spin forever", () => {
  // A graph where the level construction has to break a cycle. If it did not, this hangs
  // rather than fails, which is why it is here.
  assert.equal(flowOf(4, [[0, 1, 5], [1, 2, 5], [2, 1, 5], [2, 3, 5], [1, 3, 2]], 0, 3), 5);
});

// ── Lower bounds ───────────────────────────────────────────────────

test("flow › a lower bound that can be met is feasible", () => {
  // s -> a -> t, needing at least 2 and allowing 5.
  const arcs = [{ u: 0, v: 1, lo: 2, hi: 5 }, { u: 1, v: 2, lo: 2, hi: 5 }];
  assert.equal(feasibleWithLowerBounds(arcs, 3, 0, 2), true);
});

test("flow › a lower bound that cannot be met is infeasible", () => {
  // The second arc cannot carry the 4 the first one demands.
  const arcs = [{ u: 0, v: 1, lo: 4, hi: 4 }, { u: 1, v: 2, lo: 0, hi: 3 }];
  assert.equal(feasibleWithLowerBounds(arcs, 3, 0, 2), false);
});

test("flow › lo greater than hi is refused rather than trusted", () => {
  assert.equal(feasibleWithLowerBounds([{ u: 0, v: 1, lo: 5, hi: 2 }], 2, 0, 1), false);
});

test("flow › no lower bounds at all is trivially feasible", () => {
  assert.equal(feasibleWithLowerBounds([{ u: 0, v: 1, lo: 0, hi: 3 }], 2, 0, 1), true);
});

test("flow › THE SHAPE WE ACTUALLY ASK: four cells, two terms needing two each", () => {
  // cells 1..4, terms 5,6, source 0, sink 7. Every cell may go in either term.
  const arcs = [];
  for (const c of [1, 2, 3, 4]) {
    arcs.push({ u: 0, v: c, lo: 0, hi: 1 });
    arcs.push({ u: c, v: 5, lo: 0, hi: 1 });
    arcs.push({ u: c, v: 6, lo: 0, hi: 1 });
  }
  arcs.push({ u: 5, v: 7, lo: 2, hi: 2 });
  arcs.push({ u: 6, v: 7, lo: 2, hi: 2 });
  assert.equal(feasibleWithLowerBounds(arcs, 8, 0, 7), true, "two and two, exactly tight");
});

test("flow › the same shape with a cell locked to one term becomes INFEASIBLE", () => {
  // Three of the four can only go in term 5, so term 6 cannot reach its two. This is the
  // International Business failure in miniature: enough courses in total, wrongly reachable.
  const arcs = [];
  for (const c of [1, 2, 3]) {
    arcs.push({ u: 0, v: c, lo: 0, hi: 1 });
    arcs.push({ u: c, v: 5, lo: 0, hi: 1 });
  }
  arcs.push({ u: 0, v: 4, lo: 0, hi: 1 });
  arcs.push({ u: 4, v: 6, lo: 0, hi: 1 });
  arcs.push({ u: 5, v: 7, lo: 2, hi: 3 });
  arcs.push({ u: 6, v: 7, lo: 2, hi: 2 });
  assert.equal(feasibleWithLowerBounds(arcs, 8, 0, 7), false);
});

// ── Differential, against ground truth ─────────────────────────────

test("flow › matches brute force on 300 random small instances", () => {
  // Deterministic PRNG, so a failure is reproducible rather than a story about one CI run.
  let seed = 20260814;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };

  // Ground truth for a bipartite b-matching: try every assignment of cells to terms.
  const brute = (cellDomains, lo, hi) => {
    const T = lo.length;
    let ok = false;
    const rec = (i, load) => {
      if (ok) return;
      if (i === cellDomains.length) {
        ok = load.every((v, k) => v >= lo[k] && v <= hi[k]);
        return;
      }
      // A cell may also go UNPLACED, which the flow models by not saturating its source arc.
      rec(i + 1, load);
      for (const t of cellDomains[i]) {
        load[t] += 1;
        if (load[t] <= hi[t]) rec(i + 1, load);
        load[t] -= 1;
      }
    };
    rec(0, new Array(T).fill(0));
    return ok;
  };

  for (let trial = 0; trial < 300; trial++) {
    const T = 1 + rnd(3);          // 1..3 terms
    const C = 1 + rnd(5);          // 1..5 cells
    const domains = [];
    for (let c = 0; c < C; c++) {
      const d = [];
      for (let t = 0; t < T; t++) if (rnd(2)) d.push(t);
      domains.push(d);
    }
    const lo = [], hi = [];
    for (let t = 0; t < T; t++) { const a = rnd(3); lo.push(a); hi.push(a + rnd(3)); }

    // source 0, cells 1..C, terms C+1..C+T, sink C+T+1
    const S = 0, SINK = C + T + 1;
    const arcs = [];
    for (let c = 0; c < C; c++) {
      arcs.push({ u: S, v: 1 + c, lo: 0, hi: 1 });
      for (const t of domains[c]) arcs.push({ u: 1 + c, v: 1 + C + t, lo: 0, hi: 1 });
    }
    for (let t = 0; t < T; t++) arcs.push({ u: 1 + C + t, v: SINK, lo: lo[t], hi: hi[t] });

    const got = feasibleWithLowerBounds(arcs, C + T + 2, S, SINK);
    const want = brute(domains, lo, hi);
    assert.equal(got, want,
      `trial ${trial}: domains=${JSON.stringify(domains)} lo=${lo} hi=${hi}`);
  }
});

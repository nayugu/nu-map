// ═══════════════════════════════════════════════════════════════════
// FLOW — max-flow, and feasibility under LOWER BOUNDS
//
// The engine already matches: `witness.js` runs Kuhn's to prove a reservation can be filled
// by a distinct real course. That is a unit-capacity bipartite matching, and it answers one
// question — "is there a course for every cell". This file answers the other one: "is there a
// TERM for every cell such that every full term gets its four".
//
// The difference is lower bounds. A matching can say a term holds at most four cells; it
// cannot say a term must hold at least four, and "at least" is exactly what our first hard
// criterion is. Feasible flow with lower bounds can, through a standard transformation, and
// it is the only way to answer the question EXACTLY rather than by trying arrangements until
// the budget runs out.
//
// ── Why exactness is worth a max-flow ───────────────────────────────
//
// International Business has 32 real courses for exactly 32 slots. Every greedy that fills an
// early term to the credit cap starves a later one, and discovers it only when some cell has
// nowhere left to go; the DFS wanders 23,000 nodes over the same ground. A degree like that
// has no slack for a heuristic to absorb, and the honest options are an exact method or a
// refusal. Dinic's is O(V^2 E) in theory and microseconds here — the biggest instance in the
// corpus is around 60 cells and 16 terms — so exactness is simply cheaper than guessing.
//
// ── What this is NOT ────────────────────────────────────────────────
//
// A flow cannot express the whole problem, and pretending otherwise would be the more
// expensive mistake. Credit caps are a second resource on the same edge (multi-dimensional
// packing); precedence is an ordering between cells; the witness is a nested matching that
// depends on the assignment. None of those are flows.
//
// So this solves a RELAXATION, and a relaxation is precisely what a sound pruner needs: if
// the relaxed problem is infeasible, the real one is infeasible, and the search can stop
// without exploring. If it is feasible, nothing is claimed — the arrangement it finds may
// violate credit or precedence, and it is used as guidance, never as an answer.
// ═══════════════════════════════════════════════════════════════════

/**
 * A directed graph with residual capacities, in adjacency-list form.
 *
 * Edges are stored in pairs — `i` and `i ^ 1` are each other's reverse — which is what makes
 * pushing flow back along an edge a single index flip. `to`, `cap` and `head` are flat arrays
 * rather than objects because this is rebuilt per call.
 */
export function buildGraph(n) {
  return { n, to: [], cap: [], next: [], head: new Array(n).fill(-1) };
}

/** Add `capacity` from `u` to `v`, and its zero-capacity reverse. */
export function addEdge(g, u, v, capacity) {
  g.to.push(v); g.cap.push(capacity); g.next.push(g.head[u]); g.head[u] = g.to.length - 1;
  g.to.push(u); g.cap.push(0);        g.next.push(g.head[v]); g.head[v] = g.to.length - 1;
}

/**
 * Dinic's algorithm: the maximum flow from `s` to `t`.
 *
 * Level graph by BFS, then blocking flow by DFS with an `iter` cursor per node so each edge is
 * considered once per phase. Chosen over Edmonds-Karp because the unit-capacity bipartite
 * shape here is where Dinic's is at its fastest, and over a hand-rolled augmenting-path
 * matching because lower bounds need real capacities, not just a matching.
 */
export function maxFlow(g, s, t) {
  // Degenerate, and it HANGS rather than misreports if unguarded: with `s === t` the search
  // reaches the sink before traversing an edge, so it augments by `Infinity` against no
  // bottleneck and the augmenting loop never terminates. Zero is the meaningful answer —
  // there is no cut to saturate — and a caller that asks this is asking about an empty
  // problem. Found by the edge-case test rather than by reading the code.
  if (s === t) return 0;
  const { n, to, cap, next, head } = g;
  const level = new Array(n), iter = new Array(n);
  let flow = 0;

  const bfs = () => {
    level.fill(-1);
    const q = [s];
    level[s] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      for (let e = head[u]; e !== -1; e = next[e]) {
        if (cap[e] > 0 && level[to[e]] < 0) { level[to[e]] = level[u] + 1; q.push(to[e]); }
      }
    }
    return level[t] >= 0;
  };

  // Recursive, and the depth is bounded by the LEVEL graph rather than by the instance: each
  // step goes strictly one level deeper, and our networks are four levels tall
  // (source → cell → term → sink) at around eighty nodes. An iterative version was written
  // first, on a general worry about stack depth that does not apply at this size, and its
  // retreat logic looped forever on the cycle test below. The plain form is the correct one
  // to prefer when the reason for the clever one does not hold.
  const dfs = (u, limit) => {
    if (u === t) return limit;
    for (; iter[u] !== -1; iter[u] = next[iter[u]]) {
      const e = iter[u], v = to[e];
      if (cap[e] <= 0 || level[v] !== level[u] + 1) continue;
      const d = dfs(v, Math.min(limit, cap[e]));
      if (d > 0) { cap[e] -= d; cap[e ^ 1] += d; return d; }
    }
    // Nothing from here reaches `t` in this level graph; do not visit it again this phase.
    level[u] = -1;
    return 0;
  };

  while (bfs()) {
    for (let i = 0; i < n; i++) iter[i] = head[i];
    let f;
    while ((f = dfs(s, Infinity)) > 0) flow += f;
  }
  return flow;
}

/**
 * Is there a flow respecting a LOWER BOUND on every arc?
 *
 * The standard reduction. Each arc `u -> v` with bounds `[lo, hi]` becomes an arc of capacity
 * `hi - lo`, plus a mandatory `lo` recorded as an excess at `v` and a deficit at `u`. A super
 * source and sink supply those, and the original problem is feasible exactly when every
 * super-source arc saturates.
 *
 * `s -> t` is closed with an infinite arc back from `t` to `s`, which turns the circulation
 * problem the reduction assumes into the s-t problem we actually have.
 *
 * @param {{u:number, v:number, lo:number, hi:number}[]} arcs
 * @param {number} n   node count, ids 0..n-1
 * @param {number} s
 * @param {number} t
 * @returns {boolean}  feasible
 */
export function feasibleWithLowerBounds(arcs, n, s, t) {
  const SS = n, TT = n + 1;
  const g = buildGraph(n + 2);
  const excess = new Array(n).fill(0);
  for (const a of arcs) {
    if (a.hi < a.lo) return false;              // an arc that cannot be satisfied at all
    addEdge(g, a.u, a.v, a.hi - a.lo);
    excess[a.v] += a.lo;
    excess[a.u] -= a.lo;
  }
  addEdge(g, t, s, Infinity);

  let need = 0;
  for (let i = 0; i < n; i++) {
    if (excess[i] > 0) { addEdge(g, SS, i, excess[i]); need += excess[i]; }
    else if (excess[i] < 0) addEdge(g, i, TT, -excess[i]);
  }
  if (need === 0) return true;
  return maxFlow(g, SS, TT) === need;
}

// UNIT · src/core/planModel.js — getConnectionsToDepth prereq-tree traversal.
// Pure, deterministic, no I/O. Naming: "subject › condition › expected".
import { test } from "node:test";
import assert from "node:assert/strict";
import { getConnections, getConnectionsToDepth } from "../../src/core/planModel.js";

// A linear prereq chain A → B → C → D plus one dependent of B: B → X.
// Edge direction is "from is the prerequisite of to".
const edge = (from, to, type = "prerequisite") => ({ from, to, type });
const EDGES = [
  edge("A", "B"),
  edge("B", "C"),
  edge("C", "D"),
  edge("B", "X"),
];
const froms = (list) => list.map(e => e.from).sort();
const tos   = (list) => list.map(e => e.to).sort();

test("getConnectionsToDepth › both depths = 1 › matches getConnections", () => {
  const at1 = getConnectionsToDepth("C", EDGES, 1, 1);
  assert.deepEqual(new Set(at1), new Set(getConnections("C", EDGES)));
  // C's 1-degree neighbourhood: B→C (prereq) and C→D (dependent).
  assert.equal(at1.length, 2);
});

test("getConnectionsToDepth › upstream only › follows prerequisites, ignores dependents", () => {
  const up = getConnectionsToDepth("D", EDGES, Infinity, 0);
  // Whole chain up from D: C→D, B→C, A→B. No B→X (that is downstream of B).
  assert.deepEqual(froms(up), ["A", "B", "C"]);
  assert.deepEqual(tos(up),   ["B", "C", "D"]);
});

test("getConnectionsToDepth › downstream only › follows dependents, ignores prerequisites", () => {
  const down = getConnectionsToDepth("A", EDGES, 0, Infinity);
  // From A downstream: A→B, B→C, C→D, B→X — the full forward reach.
  assert.equal(down.length, 4);
  assert.deepEqual(tos(down), ["B", "C", "D", "X"]);
});

test("getConnectionsToDepth › bounded depth › stops at the hop budget", () => {
  // Upstream 2 hops from D: C→D (hop 1) and B→C (hop 2), but not A→B (hop 3).
  const up2 = getConnectionsToDepth("D", EDGES, 2, 0);
  assert.deepEqual(froms(up2), ["B", "C"]);
});

test("getConnectionsToDepth › Max both directions from a middle node › whole connected chain", () => {
  const all = getConnectionsToDepth("C", EDGES, Infinity, Infinity);
  // Up: B→C, A→B. Down: C→D. B is reached upstream, but its dependent X is a
  // sibling branch (downstream of B), not reachable from C, so X is excluded.
  assert.equal(all.length, 3);
  assert.deepEqual(new Set(all.map(e => `${e.from}->${e.to}`)),
    new Set(["A->B", "B->C", "C->D"]));
});

test("getConnectionsToDepth › returns edge objects by reference › identity holds", () => {
  const [e0] = getConnectionsToDepth("A", EDGES, 0, 1).filter(e => e.from === "A");
  assert.equal(e0, EDGES[0]); // same object, so callers can dedup by identity
});

test("getConnectionsToDepth › restricted edge list › does not hop past excluded nodes", () => {
  // Drop B→C: the chain is severed at C, so a Max walk up from D reaches only C.
  const severed = EDGES.filter(e => !(e.from === "B" && e.to === "C"));
  const up = getConnectionsToDepth("D", severed, Infinity, 0);
  assert.deepEqual(froms(up), ["C"]);
});

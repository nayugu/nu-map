// UNIT · the fallback constructor's REACHABILITY.
//
// Not what the packer builds — that is `engine-fullness` and the corpus gate. This file is
// about whether it ever gets asked, because twice now the answer was no in exactly the cases
// that needed it, and both times the plan was sitting one control-flow decision away.
//
//   1. it was gated on `now() <= deadline`, and the tiers before it spend the whole budget by
//      construction. International Business exhausted the clock at 18,622 nodes and 40
//      restarts; the packer was skipped and the degree refused. Given 200 nodes, so the
//      ladder failed early instead, the packer solved it immediately.
//
//   2. when the ladder SUCCEEDED with a plan the hard criteria then refused, `placeCells` had
//      already returned, so the packer was unreachable — the fallback built to turn refusals
//      into plans could not run precisely when the search's answer was unusable.
//
// Both are structural rather than arithmetic, which is why they survived every measurement of
// plan QUALITY. The tests here are about control flow.
import test from "node:test";
import assert from "node:assert/strict";
import { placeCells } from "../../src/engine/search.js";
import { permissivePorts } from "../../src/engine/ports.js";

const term = (i, weight = 1) => ({ index: i, weight, work: false, unused: false });

// Cells naming a REAL course, because the packer verifies its arrangement with the same
// witness the search uses: an unbounded cell against an empty catalog has nothing to fill it
// with, and the pack is correctly refused. A fixture that cannot pass the witness would test
// the witness, not the fallback.
const course = (id, sh = 4) => ({ id, subject: "XX", number: id.replace(/\D/g, ""), sh, prereqs: null });
const plan = (id, domain, sh = 4) => ({
  cell: { id, title: id, kind: "named", sh, target: 0, groups: [[id]] },
  domain, candidates: [id],
});
const mapOf = (plans) => Object.fromEntries(
  plans.map(p => [p.cell.id, course(p.cell.id, p.cell.sh)]));

const base = (plans, terms) => ({
  plans, terms, ports: permissivePorts(), studentType: "undergraduate",
  courseMap: mapOf(plans), repeatable: () => false, precedence: null,
});

test("fallback › the packer runs even with NO time left on the clock", () => {
  // The regression that refused International Business. `now` is pinned past the deadline, so
  // every tier that consults the clock is closed; the packer must still answer.
  const terms = [term(0), term(1)];
  const plans = [plan("a1", [0, 1]), plan("b2", [0, 1])];
  const r = placeCells({
    ...base(plans, terms),
    // Already expired before the first node: the harshest possible version of "the ladder
    // spent it all", and the one the old `now() <= deadline` gate turned into a refusal.
    timeBudgetMs: 0, now: () => 1e12,
  });
  assert.equal(r.ok, true, "a fixed-cost greedy must not be funded out of leftovers");
  assert.equal(r.termOf.size, 2);
});

test("fallback › a starved node budget reaches the packer rather than refusing", () => {
  const terms = [term(0), term(1), term(2)];
  const plans = ["a1", "b2", "c3", "d4"].map(id => plan(id, [0, 1, 2]));
  const r = placeCells({ ...base(plans, terms), nodeBudget: 1 });
  assert.equal(r.ok, true);
  assert.ok(r.relaxed?.includes("packed-largest-first"),
    "and it must SAY the plan came from the packer");
});

test("fallback › packOnly skips the ladder entirely and still verifies", () => {
  // The second attempt `withPackerRetry` makes. It must be a different CONSTRUCTOR, not the
  // same deterministic search asked twice — which would return the identical plan.
  const terms = [term(0), term(1)];
  const plans = [plan("a1", [0, 1]), plan("b2", [0, 1])];
  const r = placeCells({ ...base(plans, terms), packOnly: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.relaxed, ["packed-largest-first"]);
  assert.equal(r.nodes, 0, "no search nodes were spent");
});

test("fallback › packOnly still REFUSES what it cannot legally place", () => {
  // The fallback exists to rescue plans, not to wave them through. A cell with nowhere to go
  // must come back as a refusal carrying a reason, never as a plan with a hole in it.
  const terms = [term(0)];
  const plans = [plan("a1", [])];
  const r = placeCells({ ...base(plans, terms), packOnly: true });
  assert.equal(r.ok, false);
  assert.ok(r.failure, "a refusal has to say why");
});

test("fallback › the packer names the cell it could not place", () => {
  // It returned a bare `{ ok: false }`, so "the greedy also failed" was the entire report —
  // useless for the one question that matters, which is whether ROOM or the courses ran out.
  const terms = [term(0)];
  // One term and two 19 SH cells, against a REAL credit ceiling. `permissivePorts` has none —
  // a missing port degrades permissively by design — so without this the two would both fit
  // and the test would assert nothing.
  const plans = [plan("a1", [0], 19), plan("b2", [0], 19)];
  const r = placeCells({
    ...base(plans, terms),
    ports: { ...permissivePorts(), creditMax: () => 19 },
    packOnly: true,
  });
  assert.equal(r.ok, false);
  const passes = r.failure?.passes ?? [];
  assert.ok(passes.length > 0, "each pass reports separately");
  assert.equal(passes[0].kind, "packer-cell-has-no-term");
  assert.ok(passes[0].cell, "and names the cell");
  assert.ok(passes[0].blocked.credit > 0, "and what turned its terms away");
});

test("fallback › determinism: the same input packs the same way twice", () => {
  const terms = [term(0), term(1), term(2)];
  const mk = () => ["a1", "b2", "c3", "d4", "e5"].map(id => plan(id, [0, 1, 2]));
  const one = placeCells({ ...base(mk(), terms), packOnly: true });
  const two = placeCells({ ...base(mk(), terms), packOnly: true });
  assert.deepEqual([...one.termOf].sort(), [...two.termOf].sort());
});

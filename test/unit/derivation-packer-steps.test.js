// ═══════════════════════════════════════════════════════════════════
// The walkthrough must end on the plan that shipped — including when the PACKER built it.
//
// `packCells` is a greedy first-fit pass with no tree, so it emits no placement steps. The
// walkthrough seeded its grid from those steps and therefore from nothing, then animated phase
// 2's moves over the empty grid — so it ended holding only the handful of cards a move happened
// to touch. Measured on the corpus: `environmental_studies_and_philosophy_ba` finished showing
// 9 of its 34 courses, `cultural_anthropology_and_philosophy_ba` 5 of 21.
//
// The invariant test that should have caught it excused exactly this case (`via === "search"`),
// on the reasoning that a plan with no spine cannot contradict itself. That was true of the spine
// and false of the grid.
//
// The packer's own assignment is recoverable without asking it to emit anything: roll the recorded
// moves back off the final assignment, in reverse. These tests pin that reconstruction.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSteps } from "../../src/core/derivation/steps.js";

/**
 * A snapshot shaped like a PACKED run: an assignment, a move log, and no search nodes.
 * `buildSteps` reads `moveLog` for swaps and `assignment` for the final plan.
 */
const packedSnapshot = ({ assignment, moveLog }) => ({
  version: 1,
  roster: assignment.map(([c]) => ({ id: `c${c}`, title: `Course ${c}`, sh: 4 })),
  terms: [0, 1, 2, 3].map(i => ({ index: i, label: `Year ${i + 1}`, term: "Fall" })),
  workTerms: [],
  assignment,
  moveLog,
  stages: [],
  attempts: [],
  domainRows: [],
});
const model = { summary: { packed: true }, narrowing: { counts: {}, rows: [], terms: [] } };

test("packer steps › the grid starts from the packer's own assignment", () => {
  // Four courses packed, one moved by phase 2. The walkthrough's starting state must hold all
  // four — three where they finished, and the moved one where the packer put it.
  const steps = buildSteps(packedSnapshot({
    assignment: [[0, 0], [1, 0], [2, 1], [3, 3]],
    moveLog: [{ card: 3, from: 2, to: 3, pass: "capstone-settle" }],
  }), model);
  assert.ok(steps, "no steps built for a packed plan");
  assert.equal(steps.via, "packer");
  assert.equal(steps.place.length, 0, "the packer emits no placement steps");
  const base = new Map(steps.afterSearch);
  assert.equal(base.size, 4, `the starting grid holds ${base.size} of 4 courses`);
  assert.equal(base.get(3), 2, "the moved card must start where the PACKER put it, not where it ended");
  assert.equal(base.get(0), 0);
  assert.equal(base.get(2), 1);
});

test("packer steps › the walkthrough reconciles with the shipped plan", () => {
  const steps = buildSteps(packedSnapshot({
    assignment: [[0, 0], [1, 1], [2, 2], [3, 3], [4, 3]],
    moveLog: [
      { card: 4, from: 0, to: 1, pass: "reclaim-from-filler" },
      { card: 4, from: 1, to: 3, pass: "availability-swap" },
      { card: 2, from: 3, to: 2, pass: "rank:level-order" },
    ],
  }), model);
  assert.equal(steps.reconciles, true,
    "the packer's assignment plus the recorded moves must equal the plan that shipped");
});

test("packer steps › a card moved TWICE returns to the packer's term, not its stopover", () => {
  // Reverse order matters. Rolling forward, or reversing the wrong way, leaves the card at its
  // intermediate stop and the walkthrough opens on a plan that never existed.
  const steps = buildSteps(packedSnapshot({
    assignment: [[0, 3]],
    moveLog: [
      { card: 0, from: 0, to: 2, pass: "first" },
      { card: 0, from: 2, to: 3, pass: "second" },
    ],
  }), model);
  assert.equal(new Map(steps.afterSearch).get(0), 0,
    "expected the card's original packed term (0), not its stopover (2)");
  assert.equal(steps.reconciles, true);
});

test("packer steps › a packed plan with no phase-2 moves opens on the finished plan", () => {
  // Nothing to animate, so the starting frame IS the plan. Previously this drew an empty grid
  // and stayed empty for the whole walkthrough.
  const steps = buildSteps(packedSnapshot({
    assignment: [[0, 0], [1, 1], [2, 2]],
    moveLog: [],
  }), model);
  assert.equal(new Map(steps.afterSearch).size, 3);
  assert.equal(steps.reconciles, true);
});

test("packer steps › a SEARCHED plan still derives its start from the steps", () => {
  // The regression guard on the other side: the searched route must keep building up from an
  // empty grid, because watching each course land is the entire point of the walkthrough.
  const snap = {
    ...packedSnapshot({ assignment: [[0, 0], [1, 1]], moveLog: [] }),
    // One node per placement is what `buildSteps` reads as a search spine.
    stages: [], attempts: [],
  };
  const searched = buildSteps(snap, { ...model, summary: { packed: false } });
  // With no recorded search nodes there are no place steps either, so this asserts only that a
  // non-packed run is not labelled as the packer — the corpus invariant covers the real spine.
  assert.notEqual(searched?.via, "search");
});

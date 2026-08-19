// ═══════════════════════════════════════════════════════════════════
// A PASS IS ONE STEP, BECAUSE A PASS IS ONE STATE.
//
// Phase 2 records its work by diffing each named pass: two complete assignments subtracted,
// once per pass. The entries of one such diff are simultaneous. They have no order among
// themselves — the diff walks a Map, so what order they appear in is the roster's — and any
// proper subset of them describes an assignment the engine never held.
//
// The walkthrough replayed that log one entry at a time. Over the corpus, 580 of 786 generated
// plans have a pass that moved more than one course, and on 406 of them a frame put more credits
// in a term than the plan EVER held in any real state. The loudest is
// `physics_and_music_with_concentration_in_music_technology_bs_(boston)`, whose
// `reclaim-from-filler` pass performs two exchanges: ENGW 1102 trades places with a general
// elective in Year 1 Fall, and that elective then trades with MATH 2341. Net, three cards move.
// Replayed one at a time, ENGW 1102 arrives before the elective leaves and the first semester
// reads 21 SH — five cards in a four-slot fall, two credits over the registration cap that
// `fitsCapacity` screens every single trial against.
//
// The reader is told they are watching the plan they have in front of them get built. For those
// two frames they were watching a plan that could not exist.
//
// These tests pin the fix at its source: `buildSteps` hands out PASSES, `frameAt` is the only
// frame sequence there is, and both the panel and the corpus invariant read it.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSteps, frameAt, frameCount, frameLoad } from "../../src/core/derivation/steps.js";

/**
 * A snapshot shaped like a PACKED run — an assignment and a move log, no search nodes — so the
 * whole walkthrough is phase 2 and every frame is a pass boundary. That is the shape these
 * tests are about; the searched route adds placement steps in front and changes nothing here.
 *
 * `cards` lets a test give a card a credit value and a slot cost; anything unnamed is a
 * 4 SH one-course cell.
 */
const snapshotOf = ({ assignment, moveLog, cards = {}, terms = 4 }) => ({
  version: 1,
  roster: assignment.map(([c]) => ({
    id: `c${c}`, title: `Course ${c}`, sh: 4, slots: 1, ...(cards[c] ?? {}),
  })),
  // 19 SH is the undergraduate registration cap; 6 slots is what a first fall holding a
  // three-course corequisite plus three ordinary cells legitimately needs.
  terms: Array.from({ length: terms }, (_, i) => ({
    index: i, label: `Year ${i + 1}`, term: "Fall", capSH: 19, slots: 6,
  })),
  workTerms: [],
  assignment,
  moveLog,
  stages: [],
  attempts: [],
  domainRows: [],
});
const PACKED = { summary: { packed: true }, narrowing: { counts: {}, rows: [], terms: [] } };

// ── The reported defect, reduced to its arithmetic ──────────────────

/**
 * Physics + Music Technology's `reclaim-from-filler`, at the sizes that made it visible.
 *
 * Card 0 is ENGW 1102 (4 SH, in term 1), card 1 the general elective it displaces (4 SH, in
 * term 0), card 2 MATH 2341 (4 SH, in term 3). Cards 3–5 are the rest of the first semester:
 * MATH 1341, the MUSC cell and the three-course PHYS corequisite at 5 SH. Term 0 therefore
 * holds 17 SH before the pass and 17 SH after it, and 21 SH in between if the exchange is
 * drawn in halves.
 */
const physicsLike = () => snapshotOf({
  assignment: [[0, 0], [1, 3], [2, 1], [3, 0], [4, 0], [5, 0]],
  cards: { 5: { sh: 5, slots: 3 } },
  moveLog: [
    // One pass, three net changes: the elective moved twice and its stopover is not recorded.
    { card: 0, from: 1, to: 0, seq: 4, pass: "reclaim-from-filler" },
    { card: 2, from: 3, to: 1, seq: 4, pass: "reclaim-from-filler" },
    { card: 1, from: 0, to: 3, seq: 4, pass: "reclaim-from-filler" },
  ],
});

test("pass frames › the first semester is never drawn over its cap", () => {
  const steps = buildSteps(physicsLike(), PACKED);
  const seen = [];
  for (let k = 0; k <= frameCount(steps); k++) seen.push(frameLoad(steps, frameAt(steps, k)).sh[0]);
  // Two frames, both 17 SH: before the pass and after it. The old view produced 17, 21, 21, 17.
  assert.deepEqual(seen, [17, 17], `first semester read ${seen.join(", ")} SH across the frames`);
});

test("pass frames › no frame exceeds the term's credit or slot capacity", () => {
  const steps = buildSteps(physicsLike(), PACKED);
  for (let k = 0; k <= frameCount(steps); k++) {
    const load = frameLoad(steps, frameAt(steps, k));
    steps.terms.forEach((tm, ti) => {
      assert.ok(load.sh[ti] <= tm.capSH,
        `frame ${k}: term ${ti} holds ${load.sh[ti]} SH against a cap of ${tm.capSH}`);
      assert.ok(load.slots[ti] <= tm.slots,
        `frame ${k}: term ${ti} holds ${load.slots[ti]} courses against ${tm.slots} slots`);
    });
  }
});

test("pass frames › the old replay is not reachable, because the moves are not handed out flat", () => {
  // The structural claim. A caller that wanted to animate move-by-move would have to take the
  // moves apart itself; the shape it is given is one entry per pass.
  const steps = buildSteps(physicsLike(), PACKED);
  assert.equal(steps.swaps, undefined, "the flat move list must not be part of the contract");
  assert.equal(steps.passes.length, 1, "three moves of one pass are one step");
  assert.equal(steps.passes[0].moves.length, 3);
  assert.equal(frameCount(steps), 1, "one pass, one step");
});

// ── The grouping itself ─────────────────────────────────────────────

test("pass frames › different passes are different steps", () => {
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 1], [1, 2], [2, 3]],
    moveLog: [
      { card: 0, from: 0, to: 1, seq: 1, pass: "rank:robustness" },
      { card: 1, from: 0, to: 2, seq: 2, pass: "fill-full-terms" },
      { card: 2, from: 0, to: 3, seq: 2, pass: "fill-full-terms" },
    ],
  }), PACKED);
  assert.equal(steps.passes.length, 2);
  assert.deepEqual(steps.passes.map(p => p.moves.length), [1, 2]);
  assert.equal(frameCount(steps), 2);
  // Frame 1 applies only the first pass; card 1 has not moved yet.
  assert.equal(frameAt(steps, 1).get(0), 1);
  assert.equal(frameAt(steps, 1).get(1), 0);
  assert.equal(frameAt(steps, 2).get(1), 2);
});

test("pass frames › two adjacent passes sharing a NAME stay two steps", () => {
  // The reason the grouping is on the engine's `seq` and not on the pass name. A ranked
  // objective listed twice — or any future pipeline that runs a pass again — produces two
  // consecutive runs with identical names, and merging them would hide a real checkpoint.
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 1], [1, 2]],
    moveLog: [
      { card: 0, from: 0, to: 1, seq: 7, pass: "rank:robustness" },
      { card: 1, from: 0, to: 2, seq: 8, pass: "rank:robustness" },
    ],
  }), PACKED);
  assert.equal(steps.passes.length, 2, "same name, different pass — two steps");
});

test("pass frames › a recording with no seq falls back to the pass name", () => {
  // Older recordings carry no stamp. Grouping by name can only MERGE two same-named passes,
  // which drops a checkpoint; it can never split one, so it cannot invent a frame. The safe
  // direction, and the reason the fallback is allowed to exist.
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 1], [1, 2], [2, 3]],
    moveLog: [
      { card: 0, from: 0, to: 1, pass: "reclaim-from-filler" },
      { card: 1, from: 0, to: 2, pass: "reclaim-from-filler" },
      { card: 2, from: 0, to: 3, pass: "capstone-settle" },
    ],
  }), PACKED);
  assert.deepEqual(steps.passes.map(p => p.moves.length), [2, 1]);
  assert.equal(steps.passes[0].seq, null);
});

test("pass frames › a card moved twice inside ONE pass lands only on its net term", () => {
  // The engine can move a cell twice within a pass and the diff records only the net change,
  // so there is no stopover to draw even if a caller wanted one.
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 3]],
    moveLog: [{ card: 0, from: 0, to: 3, seq: 2, pass: "reclaim-from-filler" }],
  }), PACKED);
  assert.equal(frameAt(steps, 0).get(0), 0);
  assert.equal(frameAt(steps, 1).get(0), 3);
  assert.equal(steps.reconciles, true);
});

// ── `frameAt` and `frameLoad` at their edges ────────────────────────

test("pass frames › frameAt clamps rather than refusing, because the player seeks", () => {
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 1]],
    moveLog: [{ card: 0, from: 0, to: 1, seq: 1, pass: "rank:robustness" }],
  }), PACKED);
  assert.equal(frameAt(steps, -50).get(0), 0, "before the start is the start");
  assert.equal(frameAt(steps, 999).get(0), 1, "past the end is the finished plan");
  assert.equal(frameAt(steps, 1.9).get(0), 1, "a fractional seek does not fall through");
});

test("pass frames › the last frame IS the plan that shipped", () => {
  const snap = physicsLike();
  const steps = buildSteps(snap, PACKED);
  const last = frameAt(steps, frameCount(steps));
  assert.deepEqual([...last].sort((a, b) => a[0] - b[0]), snap.assignment,
    "the frame the reader stops on must be the assignment the plan was emitted from");
});

test("pass frames › slots are the CELL's cost, not the number of cards drawn", () => {
  // A choice cell resolves to no course list and still takes two slots when the longer of its
  // branches is a corequisite pair. Counting the cards the grid draws would let a frame overfill
  // a term and pass the check that exists to notice.
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 0], [1, 0]],
    cards: { 0: { slots: 2, courses: null }, 1: { slots: 3, courses: null } },
    moveLog: [],
  }), PACKED);
  assert.equal(frameLoad(steps, frameAt(steps, 0)).slots[0], 5);
});

test("pass frames › a card in no term at all is not counted into one", () => {
  // Hostile input: a move log naming a term the shape does not have. It must not land in term 0
  // by coercion, which is how an out-of-range index quietly becomes a fat first semester.
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 0], [1, 99]],
    moveLog: [],
  }), PACKED);
  const load = frameLoad(steps, frameAt(steps, 0));
  assert.equal(load.sh[0], 4, "only the card that has a term counts");
  assert.equal(load.sh.length, 4, "the load array is one entry per term of the shape");
});

test("pass frames › a plan with no phase-2 moves has exactly one frame", () => {
  const steps = buildSteps(snapshotOf({
    assignment: [[0, 0], [1, 1]],
    moveLog: [],
  }), PACKED);
  assert.equal(steps.passes.length, 0);
  assert.equal(frameCount(steps), 0);
  assert.equal(frameAt(steps, 0).size, 2, "the only frame is the finished plan");
});

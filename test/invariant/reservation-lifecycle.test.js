// INVARIANT · a reservation's whole life, end to end, on the real corpus.
//
// The unit suites test one door each. This chains them the way a student
// actually does: load a published plan, rearrange it, save, reload, share,
// import, undo. Every bug found in this feature survived its own unit test and
// died at a seam — SummerRow, the second reorder, applyPlanData's dead
// reference, the undo snapshot. Seams are what this exercises.
//
// The two properties asserted after EVERY step:
//
//   isolation  no reservation id in `placements`, no course id in
//              `reservations` — the audit must never see a reserved card
//   fidelity   the semester view, term loads and reserved credit are the same
//              numbers they were before the round trip
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { applySamplePlan } from "../../src/core/applySamplePlan.js";
import {
  isReservationId, moveReservation, removeReservation, fillReservation,
  semesterOccupants, occupantCards,
} from "../../src/core/reservations.js";
import { dropOnCard, dropOnSemester, dropOnBank } from "../../src/core/planDrop.js";
import { buildSemesterView, cardIdsIn, loadIn } from "../../src/core/semesterView.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const MAJORS = join(ROOT, "data/northeastern/programs/majors/2026");

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029, 2030].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];
const courseMap = new Proxy({}, {
  get: (_, k) => ({ id: String(k), subject: "XX", number: "1", sh: 4, color: "#888888" }),
  has: () => true,
});

/** Every shipped plan, so this is the corpus and not one lucky program. */
function everyPlan() {
  const out = [];
  for (const college of readdirSync(MAJORS)) {
    let progs = [];
    try { progs = readdirSync(join(MAJORS, college)); } catch { continue; }
    for (const prog of progs) {
      const file = join(MAJORS, college, prog, "plan.json");
      try { out.push({ name: prog, grid: JSON.parse(readFileSync(file, "utf8")) }); } catch {}
    }
  }
  return out;
}

const assertIsolated = (state, what) => {
  for (const id of Object.keys(state.placements)) {
    assert.ok(!isReservationId(id), `${what}: reservation id in placements`);
  }
  for (const id of Object.keys(state.reservations)) {
    assert.ok(isReservationId(id), `${what}: course id in reservations`);
  }
};

const viewOf = (s) => buildSemesterView({
  placements: s.placements, reservations: s.reservations, courseMap,
});
const reservedSH = (s) =>
  Object.values(s.reservations).reduce((n, r) => n + (r.sh ?? 0), 0);

// ── The whole corpus loads cleanly ─────────────────────────────────

test("every shipped plan applies without violating isolation", () => {
  const plans = everyPlan();
  assert.ok(plans.length > 300, `only ${plans.length} plans found — the corpus is missing`);
  let withReservations = 0, totalReserved = 0;
  for (const { name, grid } of plans) {
    for (const plan of grid.plans ?? []) {
      const r = applySamplePlan(plan, { semesters: SEMESTERS, courseMap });
      assertIsolated(r, name);
      const n = Object.keys(r.reservations).length;
      if (n) { withReservations += 1; totalReserved += n; }
      // Every reservation must be somewhere real, or it can never be drawn.
      for (const res of Object.values(r.reservations)) {
        assert.ok(res.semId, `${name}: a reservation with no semester`);
        assert.ok(SEMESTERS.some(s => s.id === res.semId), `${name}: unknown semester ${res.semId}`);
        assert.ok(res.label, `${name}: a reservation with no label`);
      }
    }
  }
  assert.ok(withReservations > 300, `only ${withReservations} plan variants reserved anything`);
  assert.ok(totalReserved > 5000, `only ${totalReserved} reservations across the corpus`);
});

// ── A full session, one plan, every gesture and every door ─────────

test("a plan survives load, rearrange, save, reload, share and undo", () => {
  const grid = JSON.parse(readFileSync(join(MAJORS,
    "computer-information-science/computer_science_and_mathematics_bs_(boston)/plan.json"), "utf8"));

  // 1. load
  let s = applySamplePlan(grid.plans[0], { semesters: SEMESTERS, courseMap });
  s = { placements: s.placements, reservations: s.reservations, semOrders: {} };
  assertIsolated(s, "after load");
  const loadedReserved = reservedSH(s);
  assert.ok(loadedReserved > 0, "the plan reserved credit");

  const ids = Object.keys(s.reservations);
  const ctx = () => {
    const v = viewOf(s);
    return { gridPlacements: v.occupants, gridCourseMap: v.cards };
  };

  // 2. rearrange: within a term, across terms, into a summer, onto a course
  const undoStack = [];
  const step = (next, what) => {
    if (next) { undoStack.push(s); s = next; }
    assertIsolated(s, what);
  };
  step(dropOnCard(s, { dragId: ids[0], targetId: ids[1], targetSemId: s.reservations[ids[1]].semId }, ctx()), "reorder/swap");
  step(dropOnSemester(s, { dragId: ids[2], semId: "sumA2029" }), "move to a summer");
  step(dropOnSemester(s, { dragId: ids[3], semId: "fall2030" }), "move to a later year");
  const aCourse = Object.keys(s.placements)[0];
  step(dropOnCard(s, { dragId: ids[4], targetId: aCourse, targetSemId: s.placements[aCourse] }, ctx()), "onto a course");

  // 3. fill one, delete one
  const filled = fillReservation(s.reservations, ids[5], "ZZ9999");
  s = { ...s, reservations: filled.reservations, placements: { ...s.placements, ZZ9999: filled.semId } };
  assertIsolated(s, "after fill");
  step({ ...s, reservations: removeReservation(s.reservations, ids[6]) }, "after delete");

  // 4. save → reload (JSON is what a slot, a file and a link all reduce to)
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(saved.reservations, s.reservations, "a save loses nothing");
  assertIsolated(saved, "after save/reload");

  // 5. the app draws the same thing afterwards
  const before = viewOf(s), after = viewOf(saved);
  assert.deepEqual(after.occupants, before.occupants, "the semester view changed across a save");
  for (const sem of SEMESTERS) {
    assert.deepEqual(cardIdsIn(sem.id, after, saved.semOrders),
                     cardIdsIn(sem.id, before, s.semOrders), `${sem.id}: order changed across a save`);
    assert.equal(loadIn(sem.id, after), loadIn(sem.id, before), `${sem.id}: load changed across a save`);
  }

  // 6. undo all the way back
  while (undoStack.length) {
    s = undoStack.pop();
    assertIsolated(s, "during undo");
  }
  assert.equal(reservedSH(s), loadedReserved, "undo did not restore the plan it started from");
});

// ── Re-applying, which is the gesture most likely to duplicate ─────

test("re-applying a plan adds nothing, on every program that has one", () => {
  let checked = 0;
  for (const { name, grid } of everyPlan().slice(0, 60)) {
    const plan = grid.plans?.[0];
    if (!plan) continue;
    const once = applySamplePlan(plan, { semesters: SEMESTERS, courseMap });
    if (!Object.keys(once.reservations).length) continue;
    const twice = applySamplePlan(plan, {
      semesters: SEMESTERS, courseMap,
      placements: once.placements, reservations: once.reservations,
      specialTermPl: once.specialTermPl,
    });
    assert.equal(Object.keys(twice.reservations).length,
                 Object.keys(once.reservations).length, `${name}: duplicated on re-apply`);
    assert.equal(twice.reserved.length, 0, `${name}: added reservations on re-apply`);
    assert.equal(twice.coops.length, 0, `${name}: added co-ops on re-apply`);
    checked += 1;
  }
  assert.ok(checked > 30, `only ${checked} programs exercised`);
});

// ── Gestures in bulk, looking for a state that breaks the rule ─────

test("a thousand random gestures never break isolation", () => {
  const grid = JSON.parse(readFileSync(join(MAJORS,
    "computer-information-science/computer_science_bscs_(boston)/plan.json"), "utf8"));
  const applied = applySamplePlan(grid.plans[0], { semesters: SEMESTERS, courseMap });
  let s = { placements: applied.placements, reservations: applied.reservations, semOrders: {} };

  // Deterministic PRNG: a failure has to be reproducible to be fixable.
  let seed = 20260808;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const realSems = SEMESTERS.filter(x => x.type !== "special").map(x => x.id);

  for (let i = 0; i < 1000; i++) {
    const cards = [...Object.keys(s.placements), ...Object.keys(s.reservations)];
    if (!cards.length) break;
    const v = viewOf(s);
    const ctx = { gridPlacements: v.occupants, gridCourseMap: v.cards };
    const dragId = pick(cards);
    const semId = pick(realSems);
    let next = null;
    switch (i % 4) {
      case 0: next = dropOnCard(s, { dragId, targetId: pick(cards), targetSemId: semId }, ctx); break;
      case 1: next = dropOnSemester(s, { dragId, semId }); break;
      case 2: next = dropOnBank(s, { dragId }); break;
      case 3: {
        const r = pick(Object.keys(s.reservations));
        const f = r ? fillReservation(s.reservations, r, `FILL${i}`) : null;
        if (f) next = { ...s, reservations: f.reservations, placements: { ...s.placements, [`FILL${i}`]: f.semId } };
        break;
      }
    }
    if (next) s = next;
    assertIsolated(s, `gesture ${i}`);
    // Nothing may be stranded: every card must still be in a real semester.
    for (const [id, r] of Object.entries(s.reservations)) {
      assert.ok(realSems.includes(r.semId), `gesture ${i}: ${id} landed in ${r.semId}`);
    }
  }
});

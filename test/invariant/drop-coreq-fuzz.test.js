// INVARIANT · corequisites survive any sequence of drops.
//
// The rule "cards that must be taken together move together" was enforced by
// six hand-written copies, and the copy for the DISPLACED card in a swap was
// simply never written. A single example test would have missed it: the bug
// needs a target that is both occupied and in another term, with a partner
// that may itself be in a third term. So this drives the pure resolver with
// hundreds of random gestures and asserts the invariant after every one.
//
// Deterministic: a seeded LCG, so a failure reprints the exact sequence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropOnCard } from "../../src/core/planDrop.js";
import { coreqPartnersOf } from "../../src/core/courseModel.js";
import { createReservation, isReservationId } from "../../src/core/reservations.js";

const SEMS = ["fall2026", "spr2027", "sumA2027", "fall2027", "spr2028"];

/** Small deterministic PRNG — reproducible failures beat a lucky seed. */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

/**
 * A plan with a known corequisite graph:
 *   LEC1–LAB1   an ordinary pair
 *   LEC2–LAB2   a second pair, so two groups can collide
 *   LEC3–LAB3A, LEC3–LAB3B   one lecture, two partners
 *   SOLO*       no partners at all
 */
function makeWorld(rand) {
  const edges = [
    { from: "LAB1",  to: "LEC1", type: "corequisite" },
    { from: "LAB2",  to: "LEC2", type: "corequisite" },
    { from: "LAB3A", to: "LEC3", type: "corequisite" },
    { from: "LAB3B", to: "LEC3", type: "corequisite" },
    // A prerequisite edge that must never cause a move.
    { from: "LEC1",  to: "LEC2", type: "prerequisite" },
  ];
  const courses = ["LEC1", "LAB1", "LEC2", "LAB2", "LEC3", "LAB3A", "LAB3B",
                   "SOLO1", "SOLO2", "SOLO3"];

  const placements = {};
  for (const id of courses) placements[id] = SEMS[Math.floor(rand() * SEMS.length)];

  // Two reservations, because a reservation dropped onto a course is the door
  // through which the shared resolver reaches the swap.
  const reservations = {};
  for (let i = 0; i < 2; i++) {
    const r = createReservation({
      semId: SEMS[Math.floor(rand() * SEMS.length)],
      label: `Elective ${i}`, sh: 4, origin: `fuzz-${i}`,
    });
    reservations[r.id] = r;
  }

  const courseMap = Object.fromEntries(courses.map(id => [id, { id, code: id, sh: 4 }]));
  for (const r of Object.values(reservations)) courseMap[r.id] = { id: r.id, code: r.label, sh: 4 };

  return { state: { placements, reservations, semOrders: {} }, edges, courseMap, courses };
}

/** Where a card sits, whichever map holds it. */
const semOf = (st, id) => (isReservationId(id) ? st.reservations[id]?.semId : st.placements[id]);

/** THE invariant: every corequisite pair that is placed sits in one term. */
function checkTogether(state, edges, trace) {
  for (const e of edges) {
    if (e.type !== "corequisite") continue;
    const a = semOf(state, e.from), b = semOf(state, e.to);
    if (a === undefined || b === undefined) continue;   // one of them is unplaced
    assert.equal(a, b,
      `${e.from} (${a}) and ${e.to} (${b}) are corequisites in different terms\n` +
      `after:\n  ${trace.join("\n  ")}`);
  }
}

test("drop fuzz › corequisites never end up in different terms", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rand = rng(seed);
    const { state: start, edges, courseMap, courses } = makeWorld(rand);
    const partnersOf = (id) => coreqPartnersOf(edges, id);

    let state = start;
    // Start from a legal board: the generator scatters partners, so settle
    // them first with one deliberate drop each.
    for (const e of edges.filter(x => x.type === "corequisite")) {
      state = { ...state, placements: { ...state.placements, [e.from]: state.placements[e.to] } };
    }
    checkTogether(state, edges, ["(setup)"]);

    const trace = [];
    for (let step = 0; step < 40; step++) {
      const ids = [...courses, ...Object.keys(state.reservations)];
      const dragId = ids[Math.floor(rand() * ids.length)];
      const targetSemId = SEMS[Math.floor(rand() * SEMS.length)];
      const inTarget = ids.filter(id => semOf(state, id) === targetSemId && id !== dragId);
      // Sometimes drop on a card, sometimes on empty space.
      const targetId = inTarget.length && rand() < 0.8
        ? inTarget[Math.floor(rand() * inTarget.length)]
        : null;
      if (!targetId) continue;

      const next = dropOnCard(state, { dragId, targetId, targetSemId }, {
        gridPlacements: state.placements,
        gridCourseMap: courseMap,
        coreqPartners: partnersOf(dragId),
        partnersOf,
      });
      trace.push(`drop ${dragId} onto ${targetId} in ${targetSemId}`);
      if (!next) continue;
      state = next;
      checkTogether(state, edges, trace);
    }
  }
});

test("drop fuzz › a swap never loses or duplicates a card", () => {
  for (let seed = 100; seed < 140; seed++) {
    const rand = rng(seed);
    const { state: start, edges, courseMap, courses } = makeWorld(rand);
    const partnersOf = (id) => coreqPartnersOf(edges, id);
    let state = start;

    for (let step = 0; step < 30; step++) {
      const ids = [...courses, ...Object.keys(state.reservations)];
      const dragId = ids[Math.floor(rand() * ids.length)];
      const targetSemId = SEMS[Math.floor(rand() * SEMS.length)];
      const inTarget = ids.filter(id => semOf(state, id) === targetSemId && id !== dragId);
      if (!inTarget.length) continue;
      const targetId = inTarget[Math.floor(rand() * inTarget.length)];

      const next = dropOnCard(state, { dragId, targetId, targetSemId }, {
        gridPlacements: state.placements, gridCourseMap: courseMap,
        coreqPartners: partnersOf(dragId), partnersOf,
      });
      if (!next) continue;

      // Conservation: the same cards exist afterwards, each in exactly one term.
      assert.deepEqual(
        Object.keys(next.placements).sort(), Object.keys(state.placements).sort(),
        "a drop added or dropped a placement");
      assert.deepEqual(
        Object.keys(next.reservations).sort(), Object.keys(state.reservations).sort(),
        "a drop added or dropped a reservation");
      for (const [semId, order] of Object.entries(next.semOrders)) {
        assert.equal(new Set(order).size, order.length,
          `${semId} lists a card twice: ${order.join(", ")}`);
      }
      state = next;
    }
  }
});

test("drop fuzz › a stored order never keeps a card that left the term", () => {
  // Not visible on the grid (getOrderedCourses filters an order against what
  // is actually in the term) but it rides into every export, and a file full
  // of references to cards that are elsewhere is what makes an export hard to
  // trust.
  for (let seed = 200; seed < 230; seed++) {
    const rand = rng(seed);
    const { state: start, edges, courseMap, courses } = makeWorld(rand);
    const partnersOf = (id) => coreqPartnersOf(edges, id);
    let state = start;

    for (let step = 0; step < 30; step++) {
      const ids = [...courses, ...Object.keys(state.reservations)];
      const dragId = ids[Math.floor(rand() * ids.length)];
      const targetSemId = SEMS[Math.floor(rand() * SEMS.length)];
      const inTarget = ids.filter(id => semOf(state, id) === targetSemId && id !== dragId);
      if (!inTarget.length) continue;
      const targetId = inTarget[Math.floor(rand() * inTarget.length)];

      const next = dropOnCard(state, { dragId, targetId, targetSemId }, {
        gridPlacements: state.placements, gridCourseMap: courseMap,
        coreqPartners: partnersOf(dragId), partnersOf,
      });
      if (!next) continue;
      state = next;

      for (const [semId, order] of Object.entries(state.semOrders)) {
        for (const id of order) {
          assert.equal(semOf(state, id), semId,
            `${semId}'s order lists ${id}, which is in ${semOf(state, id) ?? "no term"}`);
        }
      }
    }
  }
});

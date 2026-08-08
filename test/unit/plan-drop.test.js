// UNIT · what a drag-and-drop gesture does to plan state.
//
// The logic used to live inside a React handler as a sequence of setX calls,
// where it could not be tested — and three reservation bugs shipped and had to
// be reported by hand before anyone could see them. Written as a function from
// state to state, the cases can simply be enumerated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropOnCard, dropOnSemester, dropOnBank } from "../../src/core/planDrop.js";
import { createReservation, isReservationId } from "../../src/core/reservations.js";
import { semesterOccupants, occupantCards } from "../../src/core/reservations.js";

const FALL = "fall2026", SPR = "spr2027", SUMA = "sumA2027", SUMB = "sumB2027";

function setup() {
  const r1 = createReservation({ semId: FALL, label: "Khoury Elective", sh: 4 });
  const r2 = createReservation({ semId: SUMA, label: "General Elective", sh: 4 });
  const reservations = { [r1.id]: r1, [r2.id]: r2 };
  const placements = { CS2500: FALL, CS2510: SPR, CS3000: SUMA, CS2101: SPR };
  const courseMap = Object.fromEntries(
    ["CS2500", "CS2510", "CS3000", "CS2101"].map(id => [id, { id, sh: 4 }]));
  const state = { placements, reservations, semOrders: {} };
  const ctx = {
    gridPlacements: semesterOccupants(placements, reservations),
    gridCourseMap: occupantCards(courseMap, reservations),
  };
  return { state, ctx, r1, r2 };
}

/** The rule the whole design rests on, checked after every gesture. */
function assertIsolated(next, what) {
  for (const id of Object.keys(next.placements)) {
    assert.ok(!isReservationId(id), `${what}: reservation id in placements`);
  }
  for (const id of Object.keys(next.reservations)) {
    assert.ok(isReservationId(id), `${what}: course id in reservations`);
  }
}

// ── Course onto a reservation ──────────────────────────────────────

test("a course dropped on a reservation replaces it, in that term", () => {
  const { state, ctx, r1 } = setup();
  const next = dropOnCard(state, { dragId: "CS2510", targetId: r1.id, targetSemId: FALL }, ctx);
  assert.ok(!next.reservations[r1.id], "the card is gone");
  assert.equal(next.placements.CS2510, FALL, "and the course is there instead");
  assertIsolated(next, "fill");
});

test("the course takes the card's exact position in the term", () => {
  const { state, ctx, r1 } = setup();
  // Fall holds [CS2500, r1]; dropping CS2510 on r1 must land it where r1 was.
  const next = dropOnCard(state, { dragId: "CS2510", targetId: r1.id, targetSemId: FALL }, ctx);
  assert.deepEqual(next.semOrders[FALL], ["CS2500", "CS2510"]);
});

test("coreq partners travel with the course, as on any other drop", () => {
  // Leaving them behind would split a pair the catalog requires together.
  const { state, ctx, r1 } = setup();
  const next = dropOnCard(state, { dragId: "CS2100", targetId: r1.id, targetSemId: FALL },
    { ...ctx, coreqPartners: ["CS2101"] });
  assert.equal(next.placements.CS2100, FALL);
  assert.equal(next.placements.CS2101, FALL, "the partner came along");
  assert.ok(next.semOrders[FALL].includes("CS2101"));
});

test("filling with a course from ANOTHER term moves it, leaving nothing behind", () => {
  const { state, ctx, r2 } = setup();
  const next = dropOnCard(state, { dragId: "CS2500", targetId: r2.id, targetSemId: SUMA }, ctx);
  assert.equal(next.placements.CS2500, SUMA, "moved out of Fall");
  assert.ok(!next.reservations[r2.id]);
  assert.ok(!next.semOrders[SUMA].includes(r2.id), "the card is not left in the order");
});

// ── A reservation being dragged ────────────────────────────────────

test("a reservation dragged to another term moves, and never enters placements", () => {
  const { state, ctx, r1 } = setup();
  const next = dropOnCard(state, { dragId: r1.id, targetId: "CS3000", targetSemId: SUMA }, ctx);
  assert.equal(next.reservations[r1.id].semId, SUMA);
  assertIsolated(next, "cross-term move");
});

test("a reservation dragged within its term reorders", () => {
  const { state, ctx, r1 } = setup();
  const next = dropOnCard(state, { dragId: r1.id, targetId: "CS2500", targetSemId: FALL }, ctx);
  assert.deepEqual(next.semOrders[FALL], [r1.id, "CS2500"], "it takes the target's place");
  assertIsolated(next, "reorder");
});

test("summer terms behave exactly like any other term", () => {
  // Summers render through a different component, which is how they were
  // missed; the state transition must not know or care.
  const { state, ctx, r1, r2 } = setup();
  const toSummer = dropOnCard(state, { dragId: r1.id, targetId: r2.id, targetSemId: SUMA }, ctx);
  assert.equal(toSummer.reservations[r1.id].semId, SUMA);

  const between = dropOnCard(toSummer, { dragId: r2.id, targetId: "x", targetSemId: SUMB },
    { ...ctx, gridPlacements: semesterOccupants(toSummer.placements, toSummer.reservations) });
  assert.equal(between.reservations[r2.id].semId, SUMB, "summer 1 to summer 2");
  assertIsolated(between, "summer moves");
});

// ── The other two targets ──────────────────────────────────────────

test("dropping on a semester's empty space moves a reservation", () => {
  const { state, r1 } = setup();
  const next = dropOnSemester(state, { dragId: r1.id, semId: SUMB });
  assert.equal(next.reservations[r1.id].semId, SUMB);
  assertIsolated(next, "semester drop");
  assert.equal(dropOnSemester(state, { dragId: "CS2500", semId: SUMB }), null,
    "a course is the caller's own path");
});

test("dropping a reservation on the bank deletes it", () => {
  const { state, r1 } = setup();
  const next = dropOnBank(state, { dragId: r1.id });
  assert.ok(!next.reservations[r1.id]);
  assertIsolated(next, "bank drop");
  assert.equal(dropOnBank(state, { dragId: "CS2500" }), null);
});

// ── Gestures that mean nothing ─────────────────────────────────────

test("meaningless gestures change nothing rather than half-acting", () => {
  const { state, ctx, r1 } = setup();
  assert.equal(dropOnCard(state, { dragId: r1.id, targetId: r1.id, targetSemId: FALL }, ctx), null,
    "onto itself");
  assert.equal(dropOnCard(state, { dragId: "CS2500", targetId: "CS2510", targetSemId: SPR }, ctx), null,
    "course onto course is the caller's existing path");
  assert.equal(dropOnCard(state, { dragId: "CS2500", targetId: "~res:gone", targetSemId: FALL }, ctx), null,
    "onto a reservation that no longer exists");
});

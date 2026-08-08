// UNIT · what a drag-and-drop gesture does to plan state.
//
// The logic used to live inside a React handler as a sequence of setX calls,
// where it could not be tested — and three reservation bugs shipped and had to
// be reported by hand before anyone could see them. Written as a function from
// state to state, the cases can simply be enumerated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropOnCard, dropOnSemester, dropOnBank } from "../../src/core/planDrop.js";
import { createReservation, isReservationId, fillReservation } from "../../src/core/reservations.js";
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

test("a course dropped on a reservation reorders, exactly as onto a course", () => {
  // Dragging means the same thing wherever it lands. A gesture that sometimes
  // reorders and sometimes consumes its target would be two gestures wearing
  // one costume. Answering a reservation is a separate act with its own
  // affordance — fillReservation() is what that calls.
  const { state, ctx, r1 } = setup();
  // CS2510 sits in Spring; Fall holds [CS2500, r1]. Dropping it on either card
  // in Fall must produce the same SHAPE of result: a swap into Fall at the
  // target's position, with the target sent back to Spring.
  const onReservation = dropOnCard(state, { dragId: "CS2510", targetId: r1.id, targetSemId: FALL }, ctx);
  const onCourse      = dropOnCard(state, { dragId: "CS2510", targetId: "CS2500", targetSemId: FALL }, ctx);
  assert.equal(onReservation.placements.CS2510, FALL);
  assert.equal(onCourse.placements.CS2510, FALL);
  assert.equal(onReservation.reservations[r1.id].semId, SPR, "the reservation swapped back");
  assert.equal(onCourse.placements.CS2500, SPR, "the course swapped back — same rule");
});

test("filling is still available, just not as a drag", () => {
  const { state, r1 } = setup();
  const filled = fillReservation(state.reservations, r1.id, "CS2510");
  assert.ok(!filled.reservations[r1.id], "the card goes");
  assert.equal(filled.courseId, "CS2510");
  assert.equal(filled.semId, FALL, "and the course belongs in its term");
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
  assert.equal(dropOnCard(state, { dragId: "~res:gone", targetId: "CS2500", targetSemId: FALL }, ctx), null,
    "dragging a card that does not exist");
  // A card dropped on a target that no longer exists lands at the END of the
  // term rather than doing nothing. Silently ignoring a drag reads as the app
  // being broken; putting it somewhere sensible reads as a rule.
  const stale = dropOnCard(state, { dragId: "CS2500", targetId: "~res:gone", targetSemId: FALL }, ctx);
  assert.ok(stale, "resolved rather than ignored");
  assert.equal(stale.semOrders[FALL].at(-1), "CS2500");
});

// ── The two cases that silently did nothing ────────────────────────

test("one reservation swaps with another in the same term", () => {
  const { ctx } = setup();
  const a = createReservation({ semId: FALL, label: "Khoury Elective", sh: 4 });
  const b = createReservation({ semId: FALL, label: "General Elective", sh: 4 });
  const state = {
    placements: { CS2500: FALL },
    reservations: { [a.id]: a, [b.id]: b },
    semOrders: {},
  };
  const c = {
    gridPlacements: semesterOccupants(state.placements, state.reservations),
    gridCourseMap: occupantCards({ CS2500: { id: "CS2500", sh: 4 } }, state.reservations),
  };
  const next = dropOnCard(state, { dragId: b.id, targetId: a.id, targetSemId: FALL }, c);
  assert.ok(next, "the gesture did something");
  assert.ok(next.semOrders[FALL].indexOf(b.id) < next.semOrders[FALL].indexOf(a.id),
    "the dragged card took the target's place");
});

test("a STALE stored order does not make a drag silently do nothing", () => {
  // The stored order is written by any drop, so it can predate the cards now in
  // the term. Reading it raw gave a list missing the ids being moved, indexOf
  // returned -1, and the gesture bailed — which is what "you can't swap between
  // reservations" was.
  const a = createReservation({ semId: FALL, label: "Khoury Elective", sh: 4 });
  const b = createReservation({ semId: FALL, label: "General Elective", sh: 4 });
  const state = {
    placements: { CS2500: FALL },
    reservations: { [a.id]: a, [b.id]: b },
    semOrders: { [FALL]: ["CS2500"] },      // written before either card existed
  };
  const c = {
    gridPlacements: semesterOccupants(state.placements, state.reservations),
    gridCourseMap: occupantCards({ CS2500: { id: "CS2500", sh: 4 } }, state.reservations),
  };
  const next = dropOnCard(state, { dragId: b.id, targetId: a.id, targetSemId: FALL }, c);
  assert.ok(next, "still resolves against a stale order");
  assert.ok(next.semOrders[FALL].includes(a.id) && next.semOrders[FALL].includes(b.id),
    "and the order now contains every card actually in the term");
});

test("a reservation dropped on a course in ANOTHER term lands at that position", () => {
  // Moving without touching the order left it at the end of the target term,
  // which reads as the drag having gone somewhere else entirely.
  const r = createReservation({ semId: FALL, label: "Khoury Elective", sh: 4 });
  const state = {
    placements: { CS2510: SPR, CS3000: SPR },
    reservations: { [r.id]: r },
    semOrders: { [SPR]: ["CS2510", "CS3000"] },
  };
  const cmap = { CS2510: { id: "CS2510", sh: 4 }, CS3000: { id: "CS3000", sh: 4 } };
  const c = {
    gridPlacements: semesterOccupants(state.placements, state.reservations),
    gridCourseMap: occupantCards(cmap, state.reservations),
  };
  const next = dropOnCard(state, { dragId: r.id, targetId: "CS2510", targetSemId: SPR }, c);
  assert.equal(next.reservations[r.id].semId, SPR, "it moved");
  assert.equal(next.placements.CS2510, FALL, "and the course it landed on swapped back");
  assert.deepEqual(next.semOrders[SPR], [r.id, "CS3000"],
    "it took the target's position, not the end of the term");
});

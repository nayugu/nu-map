// UNIT · dropping a card that has no seat.
//
// A course dragged from the bank, the requirements panel or the info panel is
// not in `placements`. Before this path existed, `dropOnCard` bailed on
// `exists(state, dragId)` and the whole family did nothing at all — and the
// course-onto-course case in PlannerContext wrote `placements[targetId] =
// undefined`, un-placing the card that was dropped on.
//
// Both are the same shape: a swap needs two seats, and this gesture has one.
// The tests below try to break the replacement from every direction — bad
// targets, coreq partners parked elsewhere, ordering, summers, idempotence,
// and whether anything leaks across the reservation/placement boundary.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dropOnCard, dropOnSemester, dropOnBank, semOf } from "../../src/core/planDrop.js";
import { isReservationId } from "../../src/core/reservations.js";

const RES = "~res:a";
const RES2 = "~res:b";

const courseMap = {
  CS2000: { id: "CS2000", sh: 4, color: "#111111" },
  CS3000: { id: "CS3000", sh: 4, color: "#111111" },
  CS3100: { id: "CS3100", sh: 4, color: "#111111" },
  CS3200: { id: "CS3200", sh: 4, color: "#111111" },
  LAB1:   { id: "LAB1",   sh: 1, color: "#111111" },
  NEW1:   { id: "NEW1",   sh: 4, color: "#111111" },
  NEW2:   { id: "NEW2",   sh: 4, color: "#111111" },
  [RES]:  { id: RES, sh: 4, isReservation: true, color: "#94a3b8" },
  [RES2]: { id: RES2, sh: 4, isReservation: true, color: "#94a3b8" },
};

/** A plan with two real terms, two courses and two reservations. */
const base = () => ({
  placements: { CS2000: "fall2026", CS3000: "fall2026", CS3100: "spr2027" },
  reservations: {
    [RES]:  { id: RES,  semId: "fall2026", label: "Khoury Elective", sh: 4 },
    [RES2]: { id: RES2, semId: "spr2027",  label: "MATH Elective",   sh: 4 },
  },
  semOrders: {
    fall2026: ["CS2000", RES, "CS3000"],
    spr2027:  ["CS3100", RES2],
  },
});

const ctxFor = (s, coreqPartners = []) => ({
  gridPlacements: {
    ...s.placements,
    ...Object.fromEntries(Object.values(s.reservations).map(r => [r.id, r.semId])),
  },
  gridCourseMap: courseMap,
  coreqPartners,
});

const assertIsolated = (s, what) => {
  for (const id of Object.keys(s.placements)) {
    assert.ok(!isReservationId(id), `${what}: reservation id leaked into placements`);
  }
  for (const id of Object.keys(s.reservations)) {
    assert.ok(isReservationId(id), `${what}: course id leaked into reservations`);
  }
};

// ── The gesture that was silently doing nothing ────────────────────

test("a bank course dropped on a reservation answers it", () => {
  const s = base();
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(s));
  assert.ok(next, "the gesture was ignored — the original bug");
  assert.equal(next.placements.NEW1, "fall2026", "the course did not land in the term");
  assert.ok(!next.reservations[RES], "the reservation survived being answered");
  assert.ok(next.reservations[RES2], "an unrelated reservation was removed");
  assertIsolated(next, "fill");
});

test("the arriving course takes the reservation's exact slot", () => {
  const s = base();
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(s));
  assert.deepEqual(next.semOrders.fall2026, ["CS2000", "NEW1", "CS3000"],
    "the answer should sit where the reservation sat");
});

test("a bank course dropped on a COURSE lands beside it and un-places nothing", () => {
  // The second half of the same bug: this used to set placements[target] to
  // undefined, because it reused the swap path with no seat to swap from.
  const s = base();
  const next = dropOnCard(s, { dragId: "NEW1", targetId: "CS3000", targetSemId: "fall2026" }, ctxFor(s));
  assert.ok(next, "gesture ignored");
  assert.equal(next.placements.CS3000, "fall2026", "the target course was un-placed");
  assert.equal(next.placements.NEW1, "fall2026", "the new course did not land");
  assert.deepEqual(next.semOrders.fall2026, ["CS2000", RES, "NEW1", "CS3000"],
    "the new card should take the target's position and push it down");
  assert.ok(!Object.prototype.hasOwnProperty.call(next.placements, "undefined"),
    "an 'undefined' placement key was written");
  assert.ok(!Object.prototype.hasOwnProperty.call(next.semOrders, "undefined"),
    "an 'undefined' semester order was written");
});

test("no placement is ever set to undefined by this path", () => {
  const s = base();
  for (const target of [RES, RES2, "CS2000", "CS3000", "CS3100"]) {
    const next = dropOnCard(s, { dragId: "NEW1", targetId: target, targetSemId: semOf(s, target) }, ctxFor(s));
    if (!next) continue;
    for (const [k, v] of Object.entries(next.placements)) {
      assert.ok(v, `placements[${k}] became ${v} after dropping on ${target}`);
    }
    for (const r of Object.values(next.reservations)) {
      assert.ok(r.semId, `a reservation lost its semester after dropping on ${target}`);
    }
  }
});

// ── Targets that should refuse ─────────────────────────────────────

test("a drop on a target that does not exist is refused, not guessed at", () => {
  const s = base();
  for (const target of [undefined, null, "", "NOT_A_CARD", "~res:ghost"]) {
    const next = dropOnCard(s, { dragId: "NEW1", targetId: target, targetSemId: "fall2026" }, ctxFor(s));
    assert.equal(next, null, `dropping on ${JSON.stringify(target)} should be refused`);
  }
});

test("dropping a card on itself is still a no-op", () => {
  const s = base();
  assert.equal(dropOnCard(s, { dragId: "NEW1", targetId: "NEW1", targetSemId: "fall2026" }, ctxFor(s)), null);
  assert.equal(dropOnCard(s, { dragId: RES, targetId: RES, targetSemId: "fall2026" }, ctxFor(s)), null);
});

test("a missing dragId is refused", () => {
  const s = base();
  for (const drag of [undefined, null, ""]) {
    assert.equal(dropOnCard(s, { dragId: drag, targetId: RES, targetSemId: "fall2026" }, ctxFor(s)), null);
  }
});

test("a STALE reservation id is refused, not treated as an arrival", () => {
  // "No seat" means "arrived from outside the grid" only for a course.
  // Reservations live nowhere else, so one with no record has been answered or
  // deleted — and admitting it inserted a ghost id into the term order.
  const s = base();
  for (const target of [RES2, "CS2000", "CS3100"]) {
    const next = dropOnCard(s, { dragId: "~res:gone", targetId: target, targetSemId: semOf(s, target) }, ctxFor(s));
    assert.equal(next, null, `a stale reservation was accepted onto ${target}`);
  }
});

test("no term order ever lists a card that exists in neither map", () => {
  const s = base();
  const known = new Set([...Object.keys(courseMap)]);
  for (const drag of ["~res:gone", "NEW1", "CS2000"]) {
    for (const target of [RES, RES2, "CS2000", "CS3100"]) {
      const next = dropOnCard(s, { dragId: drag, targetId: target, targetSemId: semOf(s, target) }, ctxFor(s));
      if (!next) continue;
      for (const [sem, order] of Object.entries(next.semOrders)) {
        for (const id of order) {
          assert.ok(known.has(id), `${sem} lists ${id}, which is not a real card (drag ${drag} → ${target})`);
        }
      }
    }
  }
});

// ── Coreq partners ─────────────────────────────────────────────────

test("coreq partners come along, and leave the term they were in", () => {
  const s = base();
  s.placements.LAB1 = "spr2027";
  s.semOrders.spr2027 = ["CS3100", RES2, "LAB1"];
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" },
                          ctxFor(s, ["LAB1"]));
  assert.equal(next.placements.NEW1, "fall2026");
  assert.equal(next.placements.LAB1, "fall2026", "the coreq partner did not follow");
  assert.ok(!next.semOrders.spr2027.includes("LAB1"),
    "the partner is still listed in the term it left");
  assert.ok(next.semOrders.fall2026.includes("LAB1"), "the partner is not listed in its new term");
});

test("a coreq partner that is itself a reservation is not dragged around", () => {
  // Reservations have no coreqs; a partner list containing one means an edge
  // was matched against the wrong kind of card, and acting on it would move a
  // card the student never touched.
  const s = base();
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" },
                          ctxFor(s, [RES2]));
  assert.equal(next.reservations[RES2].semId, "spr2027", "an unrelated reservation was moved");
  assertIsolated(next, "reservation partner");
});

test("a partner already in the destination is not duplicated", () => {
  const s = base();
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" },
                          ctxFor(s, ["CS2000"]));
  const order = next.semOrders.fall2026;
  assert.equal(order.filter(x => x === "CS2000").length, 1, `CS2000 appears twice: ${order}`);
  assert.equal(next.placements.CS2000, "fall2026");
});

// ── Ordering edge cases ────────────────────────────────────────────

test("filling the first and last card in a term keeps everything else in order", () => {
  const first = base();
  first.semOrders.fall2026 = [RES, "CS2000", "CS3000"];
  const a = dropOnCard(first, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(first));
  assert.deepEqual(a.semOrders.fall2026, ["NEW1", "CS2000", "CS3000"], "first slot");

  const last = base();
  last.semOrders.fall2026 = ["CS2000", "CS3000", RES];
  const b = dropOnCard(last, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(last));
  assert.deepEqual(b.semOrders.fall2026, ["CS2000", "CS3000", "NEW1"], "last slot");
});

test("a term with no stored order still places the card sensibly", () => {
  const s = base();
  s.semOrders = {};
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(s));
  assert.ok(next.semOrders.fall2026.includes("NEW1"), "the card is not in the term order");
  assert.ok(!next.semOrders.fall2026.includes(RES), "the answered reservation is still listed");
  assert.equal(new Set(next.semOrders.fall2026).size, next.semOrders.fall2026.length,
    "the derived order contains duplicates");
});

test("the target's own semester wins over a mismatched targetSemId", () => {
  // The UI passes the term it thinks it is dropping into. If that disagrees
  // with where the target actually is, the target is the truth — otherwise a
  // stale hover state could file the card under a term it was never in.
  const s = base();
  const next = dropOnCard(s, { dragId: "NEW1", targetId: RES2, targetSemId: "fall2026" }, ctxFor(s));
  assert.equal(next.placements.NEW1, "spr2027", "the card followed the hover, not the target");
  assert.ok(next.semOrders.spr2027.includes("NEW1"));
});

// ── Interaction with the rest of the gesture set ───────────────────

test("filling twice with different courses does not resurrect the reservation", () => {
  const s = base();
  const once = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(s));
  const twice = dropOnCard(once, { dragId: "NEW2", targetId: RES, targetSemId: "fall2026" }, ctxFor(once));
  assert.equal(twice, null, "answering an already-answered reservation should be refused");
  assert.ok(!once.reservations[RES]);
});

test("a filled reservation's course behaves as an ordinary card afterwards", () => {
  const s = base();
  const filled = dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(s));
  // now it must swap, move and delete like anything else
  const swapped = dropOnCard(filled, { dragId: "NEW1", targetId: "CS3100", targetSemId: "spr2027" }, ctxFor(filled));
  assert.equal(swapped.placements.NEW1, "spr2027", "no swap out");
  assert.equal(swapped.placements.CS3100, "fall2026", "no swap back");
  assert.equal(dropOnSemester(filled, { dragId: "NEW1", semId: "spr2027" }), null,
    "a course is not the reservation-move path's business");
  assert.equal(dropOnBank(filled, { dragId: "NEW1" }), null,
    "a course is not the reservation-delete path's business");
});

test("an unplaced card dropped on a term's empty space is still not this path", () => {
  const s = base();
  assert.equal(dropOnSemester(s, { dragId: "NEW1", semId: "fall2026" }), null,
    "dropOnSemester must keep ignoring courses — the caller owns that");
});

// ── Inputs are not mutated ─────────────────────────────────────────

test("the incoming state is never mutated", () => {
  const s = base();
  const before = JSON.stringify(s);
  dropOnCard(s, { dragId: "NEW1", targetId: RES, targetSemId: "fall2026" }, ctxFor(s, ["LAB1"]));
  dropOnCard(s, { dragId: "NEW1", targetId: "CS3000", targetSemId: "fall2026" }, ctxFor(s));
  assert.equal(JSON.stringify(s), before, "dropOnCard mutated the state it was given");
});

// ── A run of mixed gestures, checking nothing drifts ───────────────

test("a long mixed sequence keeps every card in exactly one place", () => {
  let s = base();
  let seed = 4242;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const sems = ["fall2026", "spr2027"];
  const bank = ["NEW1", "NEW2", "CS3200"];

  for (let i = 0; i < 300; i++) {
    const cards = [...Object.keys(s.placements), ...Object.keys(s.reservations)];
    const dragId = i % 3 === 0 ? pick(bank) : pick(cards);
    const targetId = pick(cards);
    const next = dropOnCard(s, { dragId, targetId, targetSemId: semOf(s, targetId) ?? pick(sems) }, ctxFor(s));
    if (next) s = next;
    assertIsolated(s, `step ${i}`);

    // Every card sits in exactly one term, and appears once in that order.
    for (const [id, sem] of Object.entries(s.placements)) {
      assert.ok(sem, `step ${i}: ${id} has no semester`);
      const order = s.semOrders[sem] ?? [];
      const n = order.filter(x => x === id).length;
      assert.ok(n <= 1, `step ${i}: ${id} appears ${n} times in ${sem}`);
    }
    for (const [id, r] of Object.entries(s.reservations)) {
      assert.ok(sems.includes(r.semId), `step ${i}: ${id} landed in ${r.semId}`);
    }
    // No order may list a card that is not in that term.
    for (const [sem, order] of Object.entries(s.semOrders)) {
      for (const id of order) {
        const where = semOf(s, id);
        if (where === undefined) continue;   // bank cards may linger in a stale order
        assert.equal(where, sem, `step ${i}: ${id} listed in ${sem} but lives in ${where}`);
      }
    }
  }
});

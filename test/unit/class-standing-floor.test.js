// UNIT · src/engine/prereqDepth.js › cellLevelFloor with a stated class standing
//
// `cellLevelFloor` used to read the course-level DIGIT as a proxy for class
// standing. Banner now states the standing directly, so these tests hold the two
// apart: where the registrar has spoken we must use its answer, and where it has
// not, the level-digit p10 must behave exactly as it did before — the whole engine
// is calibrated on that fallback and 1,952 existing tests depend on it.
//
// The measured case that motivated all of it: ENGW 3302 is level 3, so the proxy
// allowed it at 0.22 — term 2 of 8 — while all 24 of its sections require junior
// standing. And the reverse: a 4000-level capstone is held to 0.67 by the proxy
// where a JR/SR gate is 0.50, so real data BUYS freedom as often as it removes it.

import { test } from "node:test";
import assert   from "node:assert/strict";
import { cellLevelFloor, cellStanding, LEVEL_FLOOR } from "../../src/engine/prereqDepth.js";
import { STANDING_FLOOR, standingFloorOf } from "../../src/core/classStanding.js";

/** A course record shaped like the normalized Course the engine sees. */
const course = (id, std) => ({ id, ...(std ? { offering: { std } } : {}) });
const mapOf  = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

/** A cell with a single flat candidate list (an OR over courses). */
const cellOf = (...ids) => ({ cell: { }, candidates: ids });
/** A cell whose options are groups (AND within, OR across). */
const groupCell = (...groups) => ({ cell: { groups }, candidates: groups.flat() });

// ── The fallback must not move ───────────────────────────────────────

test("with no restriction data, the level-digit floor is unchanged", () => {
  const map = mapOf(course("ENGW3302"), course("CS4530"), course("MATH1341"));
  assert.equal(cellLevelFloor(cellOf("ENGW3302"), map), LEVEL_FLOOR[3]);
  assert.equal(cellLevelFloor(cellOf("CS4530"),   map), LEVEL_FLOOR[4]);
  assert.equal(cellLevelFloor(cellOf("MATH1341"), map), LEVEL_FLOOR[1]);
});

test("a course with an unreadable number contributes nothing, not zero", () => {
  // The old code did this with .filter(Boolean) on levels. If "SPECIAL" were
  // treated as floor 0 it would drag the whole cell to the front of the plan.
  const map = mapOf(course("SPECIAL"), course("CS4530"));
  assert.equal(cellLevelFloor(groupCell(["CS4530", "SPECIAL"]), map), LEVEL_FLOOR[4]);
  assert.equal(cellLevelFloor(cellOf("SPECIAL"), map), 0, "nothing known at all = no floor");
});

test("an empty cell has no floor", () => {
  assert.equal(cellLevelFloor(cellOf(), {}), 0);
  assert.equal(cellLevelFloor({ cell: {} }, {}), 0);
  assert.equal(cellLevelFloor({ cell: {}, candidates: ["CS4530"] }, undefined), LEVEL_FLOOR[4]);
});

// ── The stated standing wins ─────────────────────────────────────────

test("ENGW 3302's junior gate overrides its 3000-level estimate", () => {
  const map = mapOf(course("ENGW3302", "JR"));
  assert.equal(cellLevelFloor(cellOf("ENGW3302"), map), STANDING_FLOOR.JR);
  assert.ok(STANDING_FLOOR.JR > LEVEL_FLOOR[3],
    "the whole point: the proxy was too permissive here, by more than two terms of an 8-term plan");
});

test("a 4000-level course gated JR|SR is LOOSENED by the real data", () => {
  // The direction that is easy to forget: real data is not uniformly stricter.
  // JR|SR is the most common 4xxx pattern, and its lenient reading is JR = 0.50
  // against the proxy's 0.67 — the course gains about 1.4 terms of an 8-term plan.
  const map = mapOf(course("EECE4792", "JR"));
  assert.equal(cellLevelFloor(cellOf("EECE4792"), map), STANDING_FLOOR.JR);
  assert.ok(STANDING_FLOOR.JR < LEVEL_FLOOR[4], `${STANDING_FLOOR.JR} !< ${LEVEL_FLOOR[4]}`);
});

test("a senior-ONLY 4000-level course is TIGHTENED instead", () => {
  // Recorded because it contradicts the obvious summary of this change. SR is 0.75
  // and the 4xxx proxy is 0.67 (a p10 over observed placements), so an SR-only
  // capstone moves half a term LATER, not earlier. Both directions are real, and
  // which one applies depends on the gate rather than on the level.
  const map = mapOf(course("MEIE4702", "SR"));
  assert.equal(cellLevelFloor(cellOf("MEIE4702"), map), STANDING_FLOOR.SR);
  assert.ok(STANDING_FLOOR.SR > LEVEL_FLOOR[4], `${STANDING_FLOOR.SR} !> ${LEVEL_FLOOR[4]}`);
});

test("a graduate plan has no standing floor at all", () => {
  // A master's student takes 5000-level courses in their first term; a stated
  // undergraduate gate must not survive into a graduate plan.
  const map = mapOf(course("ENGW3302", "JR"));
  assert.equal(cellLevelFloor(cellOf("ENGW3302"), map, "graduate"), 0);
});

// ── Combination across options ───────────────────────────────────────

test("across OR options the most lenient floor wins, mixing stated and estimated", () => {
  // A student may pick the ungated option, so the cell is not gated.
  const map = mapOf(course("ENGW3302", "JR"), course("ENGW1111"));
  assert.equal(cellLevelFloor(cellOf("ENGW3302", "ENGW1111"), map), LEVEL_FLOOR[1]);
});

test("within an AND group the strictest member sets the floor", () => {
  const map = mapOf(course("BIOL2301"), course("BIOL4701", "SR"));
  assert.equal(cellLevelFloor(groupCell(["BIOL2301", "BIOL4701"]), map), STANDING_FLOOR.SR);
});

test("groups combine as max-within, min-across", () => {
  const map = mapOf(
    course("A4000", "SR"), course("B2000"),     // group 1 → max(0.75, LEVEL_FLOOR[2])
    course("C3000", "JR"), course("D1000"),     // group 2 → max(0.50, LEVEL_FLOOR[1])
  );
  const floor = cellLevelFloor(groupCell(["A4000", "B2000"], ["C3000", "D1000"]), map);
  assert.equal(floor, STANDING_FLOOR.JR, "the junior group is the reachable one");
});

test("all four standings map to distinct, ordered floors", () => {
  for (const [a, b] of [["FR", "SH"], ["SH", "JR"], ["JR", "SR"]]) {
    const map = mapOf(course("X1000", a), course("Y1000", b));
    assert.ok(cellLevelFloor(cellOf("X1000"), map) < cellLevelFloor(cellOf("Y1000"), map),
      `${a} must floor earlier than ${b}`);
  }
});

// ── standingFloorOf's own contract ───────────────────────────────────

test("standingFloorOf returns null for absent or unknown data, never 0", () => {
  // Null vs 0 is load-bearing: 0 would mean "the registrar says day one" and
  // suppress the level-digit fallback entirely.
  assert.equal(standingFloorOf(undefined), null);
  assert.equal(standingFloorOf({}), null);
  assert.equal(standingFloorOf({ offering: {} }), null);
  assert.equal(standingFloorOf({ offering: { std: "GR" } }), null, "GR is not an undergrad rung");
  assert.equal(standingFloorOf({ offering: { std: "XX" } }), null);
  assert.equal(standingFloorOf({ offering: { std: 7 } }), null);
  assert.equal(standingFloorOf({ offering: { std: "FR" } }), 0, "FR really is 0, and is not null");
});

test("a GR-only course falls back to its level digit rather than losing its floor", () => {
  // GR yields null from standingFloorOf, so the cell must still get the 5xxx floor.
  const map = mapOf(course("CS7980", "GR"));
  assert.equal(cellLevelFloor(cellOf("CS7980"), map), LEVEL_FLOOR[5]);
});

// ── cellStanding: what standing a whole CELL requires ────────────────
//
// This is what the generator asks, and it combines the opposite way in each
// direction: strictest within an AND group, most lenient across OR options.

test("cellStanding reads a single gated course", () => {
  const map = mapOf(course("ENGW3302", "JR"));
  assert.equal(cellStanding(cellOf("ENGW3302"), map), "JR");
});

test("one ungated option ungates the whole cell", () => {
  // The student can simply choose the open course, so the requirement does not
  // gate the cell. Not a loophole — it is what "one of these" means.
  const map = mapOf(course("ENGW3302", "JR"), course("ENGW1111"));
  assert.equal(cellStanding(cellOf("ENGW3302", "ENGW1111"), map), null);
});

test("across gated options the most lenient wins", () => {
  const map = mapOf(course("A", "SR"), course("B", "JR"), course("C", "SH"));
  assert.equal(cellStanding(cellOf("A", "B", "C"), map), "SH");
});

test("within an AND group the strictest wins", () => {
  const map = mapOf(course("A", "SH"), course("B", "SR"));
  assert.equal(cellStanding(groupCell(["A", "B"]), map), "SR");
});

test("groups combine strictest-within, most-lenient-across", () => {
  const map = mapOf(
    course("A", "SH"), course("B", "SR"),   // group 1 → SR
    course("C", "JR"), course("D", "JR"),   // group 2 → JR
  );
  assert.equal(cellStanding(groupCell(["A", "B"], ["C", "D"]), map), "JR");
});

test("a group with any ungated member is still gated by its gated members", () => {
  // An AND group needs BOTH courses, so an ungated member cannot rescue it.
  const map = mapOf(course("A"), course("B", "SR"));
  assert.equal(cellStanding(groupCell(["A", "B"]), map), "SR");
});

test("cellStanding is null for GR, empty and malformed cells", () => {
  assert.equal(cellStanding(cellOf("CS7980"), mapOf(course("CS7980", "GR"))), null);
  assert.equal(cellStanding(cellOf(), {}), null);
  assert.equal(cellStanding({ cell: {} }, {}), null);
  assert.equal(cellStanding(undefined, undefined), null);
  assert.equal(cellStanding(cellOf("X"), mapOf(course("X", "XX"))), null);
});

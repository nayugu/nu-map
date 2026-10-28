// UNIT · finalWorkTermWithNothingAfter — the co-op/graduation warning.
//
// Rule (careers.northeastern.edu → Co-op Information): undergraduates need "a
// minimum of one academic requirement or course remaining in degree program
// following completion of final co-op experience", and "for Spring/Summer
// co-ops that end in Summer A, the final requirement(s) may be completed in
// Summer B."
//
// This replaced "does a work term touch the graduation term". The two agreed
// while plans ended only in Fall or Spring; a summer ending split them (Jan–Jun
// co-op, empty Summer B), so the cases below include both the ones the old
// check caught and the one it could not. Real adapters, real grid, because
// whether a term spans into the next is decided by the adapter's weights.
import { test } from "node:test";
import assert from "node:assert/strict";
import calendar from "../../src/adapters/northeastern/calendar.js";
import specialTerms from "../../src/adapters/northeastern/specialTerms.js";
import { buildCohortSemesters, deriveSemMaps } from "../../src/core/semGrid.js";
import { finalWorkTermWithNothingAfter } from "../../src/core/specialTermUtils.js";

const types = specialTerms.getTypes();

function check(gradSem, terms, { placements = {}, reservations = {} } = {}) {
  const SEMESTERS = buildCohortSemesters("fall", 2026, gradSem, 2030, calendar);
  const { SEM_INDEX, SEM_NEXT } = deriveSemMaps(SEMESTERS);
  const gradSemId = (gradSem === "spring" ? "spr" : gradSem) + "2030";
  const specialTermPl = Object.fromEntries(terms.map(([typeId, duration, semId], i) =>
    [`t${i}`, { typeId, duration, semId }]));
  return finalWorkTermWithNothingAfter({
    specialTermPl, types, SEMESTERS, SEM_INDEX, SEM_NEXT, gradSemId, placements, reservations,
  });
}

// ── The gap a summer ending opened ───────────────────────────────────
test("summer finish › Jan–Jun co-op with an EMPTY Summer B is flagged", () => {
  assert.equal(check("sumB", [["coop", 6, "spr2030"]])?.endSemId, "sumA2030");
});

test("summer finish › Jan–Jun co-op then a Summer B course is the legal path, not flagged", () => {
  assert.equal(check("sumB", [["coop", 6, "spr2030"]], { placements: { cs4100: "sumB2030" } }), null);
});

test("summer finish › Spring co-op with nothing in the whole summer is flagged", () => {
  assert.ok(check("sumB", [["coop", 4, "spr2030"]]));
  assert.equal(check("sumB", [["coop", 4, "spr2030"]], { placements: { x: "sumA2030" } }), null);
});

// ── What the old overlap check caught, still caught ─────────────────
test("a co-op IN the graduation term is flagged, even with courses before it", () => {
  assert.ok(check("spring", [["coop", 4, "spr2030"]], { placements: { x: "fall2029" } }));
  assert.ok(check("sumB", [["coop", 4, "sumA2030"]], { placements: { x: "spr2030" } }));
});

test("an internship in the graduation term is flagged, as it was before", () => {
  assert.ok(check("sumB", [["intern", 2, "sumB2030"]]));
});

// ── Not flagged ──────────────────────────────────────────────────────
test("a course in the co-op's OWN term does not count as after it", () => {
  // NU permits one course alongside a co-op; it is not "after" the co-op.
  assert.ok(check("sumB", [["coop", 6, "spr2030"]], { placements: { x: "sumA2030" } }));
});

test("a placeholder card after the co-op counts, so a sample-plan layout is not flagged", () => {
  assert.equal(check("sumB", [["coop", 6, "spr2030"]],
    { reservations: { r1: { semId: "sumB2030", label: "Elective" } } }), null);
});

test("only the FINAL work term is judged; an earlier one with a gap is fine", () => {
  // Fall 2028 co-op, empty Spring 2029, then a Fall 2029 co-op followed by Spring 2030 courses.
  assert.equal(check("spring", [["coop", 4, "fall2028"], ["coop", 4, "fall2029"]],
    { placements: { x: "spr2030" } }), null);
});

test("no work terms, or a course placed outside the timeline, never flags or counts", () => {
  assert.equal(check("sumB", []), null);
  // A course parked outside the plan's terms is not "after" anything.
  assert.ok(check("sumB", [["coop", 6, "spr2030"]], { placements: { x: "fall2031" } }));
});

// The seed: the department's own arrangement, used as a branch ORDER.
//
// The property that matters is not "the hint is good" — a hint is allowed to be wrong. It is
// that a hint can never change what is legal, and that a malformed published plan cannot take
// the engine down. A plan.json is scraped monthly and unattended, so every shape below is one
// a re-scrape can actually produce.
import test from "node:test";
import assert from "node:assert/strict";
import { seedFromPlan, seedTermFor, assignSeedHints } from "../../src/engine/seed.js";

const T = (...entries) => ({ term: "Fall", entries });
const Y = (label, ...terms) => ({ label, terms });
const named = (id, sh = 4) => ({ options: [[id]], sh });
const reserved = (sh = 4) => ({ options: [], sh });

test("seed › a course's term is read from the department's plan", () => {
  const s = seedFromPlan({ years: [Y("Year 1", T(named("CS1800")), T(named("CS2500")))] });
  assert.equal(s.courseTerm.get("CS1800"), 0);
  assert.equal(s.courseTerm.get("CS2500"), 1);
});

test("seed › term indices skip WORK terms, because a domain does", () => {
  // This asserted the opposite, on the reasoning that the traversal matches
  // `shapeFromPlan` and so produces the shape's term index. It does, and the shape's
  // index is the wrong space: a cell's `domain` indexes `studyTerms(shape)`, which
  // filters employment out — `index.js` says so where it hands the co-ops to the
  // derivation view as a separate list "so no term index moves".
  //
  // The two agree until the first co-op and then diverge by one per work term.
  // Computer Science and Biology runs domains 0–9 against hints that reached 13, so a
  // course the department puts in the last term was hinted past the end of the plan —
  // and `Math.abs(a - seededTerm)` then reads every term as too early, making the last
  // one always closest. The hint did not merely miss; it pulled late courses later.
  //
  // A blank term still counts, because `studyTerms` keeps `unused` terms and only
  // marks them optional.
  const s = seedFromPlan({
    years: [Y("Year 1", T(named("CS1800")), T({ coop: true }), T(), T(named("CS3500")))],
  });
  assert.equal(s.courseTerm.get("CS3500"), 2,
    "the blank term counts, the co-op does not");
});

test("seed › a shape maps terms by year and season, not by position", () => {
  // Required for a plan that is NOT this program's own — a stand-in borrowed from a
  // similar program, whose shape is derived rather than published. Positional counting
  // would land Year 2 Fall on whatever the second slot happens to be, which for a
  // summer-bearing shape is a summer.
  const shape = { terms: [
    { yearIndex: 0, semTypeId: "fall" }, { yearIndex: 0, semTypeId: "spring" },
    { yearIndex: 0, semTypeId: "sumA" }, { yearIndex: 0, semTypeId: "sumB" },
    { yearIndex: 1, semTypeId: "fall" }, { yearIndex: 1, semTypeId: "spring" },
  ] };
  const plan = { years: [
    { label: "Year 1", terms: [{ term: "Fall", type: "fall", entries: [named("AA1000")] }] },
    { label: "Year 2", terms: [{ term: "Fall", type: "fall", entries: [named("BB1000")] }] },
  ] };
  const s = seedFromPlan(plan, shape);
  assert.equal(s.courseTerm.get("AA1000"), 0);
  assert.equal(s.courseTerm.get("BB1000"), 4, "Year 2 Fall, not the second slot");
});

test("seed › a term the shape does not have is not hinted at all", () => {
  // Guessing a neighbouring term would be inventing the department's opinion.
  const shape = { terms: [{ yearIndex: 0, semTypeId: "fall" }] };
  const plan = { years: [{ label: "Year 1", terms: [
    { term: "Fall", type: "fall", entries: [named("AA1000")] },
    { term: "Summer 1", type: "sumA", entries: [named("BB1000")] },
  ] }] };
  const s = seedFromPlan(plan, shape);
  assert.equal(s.courseTerm.get("AA1000"), 0);
  assert.equal(s.courseTerm.has("BB1000"), false);
});

test("seed › reservations are recorded as a spread, one entry per reserved row", () => {
  const s = seedFromPlan({
    years: [Y("Year 1", T(named("CS1800"), reserved(), reserved()), T(reserved()))],
  });
  assert.deepEqual(s.reservationTerms, [0, 0, 1]);
});

test("seed › an `either` row is a reservation, not a course placement", () => {
  // Two options is a choice we are not entitled to make from the published plan.
  const s = seedFromPlan({ years: [Y("Year 1", T({ options: [["CS1800"], ["CS1801"]], sh: 4 }))] });
  assert.equal(s.courseTerm.size, 0);
  assert.deepEqual(s.reservationTerms, [0]);
});

test("seed › the FIRST placement wins when a department lists a course twice", () => {
  const s = seedFromPlan({ years: [Y("Year 1", T(named("CS1800")), T(named("CS1800")))] });
  assert.equal(s.courseTerm.get("CS1800"), 0);
});

test("seed › co-op, vacation and heading rows are not placements", () => {
  const s = seedFromPlan({
    years: [Y("Year 1", T({ coop: true, options: [["COOP3945"]] },
                          { vacation: true }, { heading: true, options: [["X1000"]] }))],
  });
  assert.equal(s.courseTerm.size, 0);
  assert.deepEqual(s.reservationTerms, []);
});

// ── The hint must agree, or say nothing ────────────────────────────

test("seed › candidates that scatter across terms produce NO hint", () => {
  const courseTerm = new Map([["A", 1], ["B", 5]]);
  assert.equal(seedTermFor(["A", "B"], courseTerm), null);
});

test("seed › candidates that agree produce the hint, ignoring unknown ones", () => {
  const courseTerm = new Map([["A", 3], ["B", 3]]);
  assert.equal(seedTermFor(["A", "B", "UNKNOWN"], courseTerm), 3);
});

test("seed › a filler cell has no candidates and no hint of its own", () => {
  assert.equal(seedTermFor(null, new Map([["A", 1]])), null);
  assert.equal(seedTermFor([], new Map([["A", 1]])), null);
});

// ── Dealing the spread ─────────────────────────────────────────────

const P = (id, candidates = null) => ({ cell: { id }, candidates });

// The reservation spread is deliberately NOT dealt any more. It paired our unhinted cells
// against the department's reserved rows in cell-id order, which is not a pairing — a cell
// could be handed Year 1 Spring because its id sorts early — and it displaced the level and
// unlock orderings that keep 4000-level courses late. What it produced was `CS 4530 or 4535`
// in year one and CS 3000 at the end of the degree. See `seed.js`.
test("seed › a RESERVATION is never hinted, whatever the department's spread says", () => {
  const seed = { courseTerm: new Map([["A", 0]]), reservationTerms: [2, 5, 5] };
  const hints = assignSeedHints([P("c1", ["A"]), P("c2"), P("c3"), P("c4")], seed);
  assert.equal(hints.get("c1"), 0, "a named cell's term is a fact and is kept");
  assert.equal(hints.size, 1, "the unhinted cells stay unhinted, for the preferences to order");
});

test("seed › with no named cells at all, nothing is hinted", () => {
  const seed = { courseTerm: new Map(), reservationTerms: [1] };
  assert.equal(assignSeedHints([P("a"), P("b"), P("c")], seed).size, 0);
});

test("seed › dealing is deterministic regardless of the order cells arrive in", () => {
  const seed = { courseTerm: new Map(), reservationTerms: [1, 2, 3] };
  const forward = assignSeedHints([P("a"), P("b"), P("c")], seed);
  const backward = assignSeedHints([P("c"), P("b"), P("a")], seed);
  assert.deepEqual([...forward].sort(), [...backward].sort());
});

test("seed › no published plan means no hints, and nothing throws", () => {
  assert.equal(assignSeedHints([P("a")], null).size, 0);
  const empty = seedFromPlan(undefined);
  assert.equal(empty.courseTerm.size, 0);
  assert.deepEqual(empty.reservationTerms, []);
});

// ── What a monthly re-scrape can hand us ───────────────────────────

test("seed › malformed published plans do not throw", () => {
  for (const bad of [
    { years: null },
    { years: [null, 7, "x"] },
    { years: [{ terms: null }] },
    { years: [{ terms: [null, 3, { entries: null }] }] },
    { years: [{ terms: [{ entries: [null, 5, { options: null }] }] }] },
    { years: [{ terms: [{ entries: [{ options: [[]] }] }] }] },
    { years: [{ terms: [{ entries: [{ options: "CS1800" }] }] }] },
    { years: [{ terms: [{ entries: [{ children: [{ options: [["CS1800"]], sh: 4 }] }] }] }] },
  ]) {
    assert.doesNotThrow(() => seedFromPlan(bad), JSON.stringify(bad));
  }
});

test("seed › a nested child placement is still found", () => {
  const s = seedFromPlan({
    years: [{ terms: [{ entries: [{ children: [{ options: [["CS1800"]], sh: 4 }] }] }] }],
  });
  assert.equal(s.courseTerm.get("CS1800"), 0);
});

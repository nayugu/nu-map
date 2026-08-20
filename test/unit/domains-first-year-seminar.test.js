// UNIT · src/engine/domains.js › the first-year seminar is pinned to the opening term
//
// 31 courses, one per Northeastern college, all 1 SH, all titled "<Subject> at
// Northeastern". The published plans put 418 of 421 (99.3%) in the first term, and
// several carry a Banner `FR` gate that makes a later one unregistrable.
//
// As an ordering preference this could never have held: Year 1 Fall is the most
// contested term in any plan, so a 1 SH seminar is the first thing capacity pressure
// gives up — which is how Mathematics and Physics BS ended up with INSC 1000 in Year 1
// Spring, behind a published plan that never printed the course at all.
//
// So it narrows the domain, and as with class standing the GUARD is what is really
// under test: the narrowing is adopted only when term 0 survives every hard bound, so
// no plan can be refused on account of a convention.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDomains } from "../../src/engine/domains.js";
import { EXCLUSION } from "../../src/core/derivation/events.js";

const SEMINAR = / at Northeastern\b/i;

const terms = (n = 6) =>
  Array.from({ length: n }, (_, i) => ({
    semTypeId: i % 2 === 0 ? "fall" : "spring", targetSH: 16, weight: 1,
    work: false, unused: false,
  }));

const course = (id, title, sh = 1) => ({ id, sh, title });
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));
// `kind: "named"` is load-bearing — without it `candidatesFor` reports an open pool and
// the bounds never engage. Same trap the class-standing suite documents.
const named = (...ids) => ({ id: `c_${ids.join("_")}`, kind: "named", title: ids[0], sh: 1,
                             groups: [ids] });

const run = (cells, courseMap, opts = {}) =>
  buildDomains(cells, opts.terms ?? terms(), {
    courseMap, offered: () => true, trace: true,
    cal: { firstYearSeminarTitle: SEMINAR }, ...opts,
  });

const MAP = mapOf(
  course("INSC1000", "Science at Northeastern"),
  course("MATH1000", "Mathematics at Northeastern"),
  course("THTR1000", "Theatre at Northeastern"),
  course("MATH1341", "Calculus 1 for Science and Engineering", 4),
  // A 1000-level course that is NOT one of these, to prove the rule reads the title
  // rather than the number.
  course("CS1200", "First Year Seminar", 1),
);

test("a first-year seminar is pinned to the opening term", () => {
  const { plans } = run([named("INSC1000")], MAP);
  assert.deepEqual(plans[0].domain, [0]);
});

test("the dropped terms say WHY, and it is not a prerequisite", () => {
  // A student asking "why not spring" must get the real reason. `DEPARTMENT_TERM` was
  // the cheap reuse and would have been a lie: this fires when the department printed
  // nothing at all.
  const { plans } = run([named("INSC1000")], MAP);
  const why = plans[0].excluded.filter(e => e.reason === EXCLUSION.FIRST_YEAR_SEMINAR);
  assert.deepEqual(why.map(e => e.term), [1, 2, 3, 4, 5]);
  assert.equal(plans[0].excluded.some(e => e.reason === EXCLUSION.BEFORE_PREREQS), false);
});

test("the rule reads the TITLE, not the course number", () => {
  const { plans } = run([named("CS1200")], MAP);
  assert.equal(plans[0].domain.length, 6, "a 1000-level non-seminar keeps every term");
});

test("an ordinary course is untouched", () => {
  const { plans } = run([named("MATH1341")], MAP);
  assert.equal(plans[0].domain.length, 6);
});

// ── The guard: a convention must never cause a refusal ──────────────

test("a seminar barred from term 0 by season keeps its whole domain", () => {
  // The one that matters. If term 0 is not legal, pinning would empty the domain and
  // turn a taste into an infeasibility — the failure that cost the level-digit proxy
  // 15 points of coverage.
  const { plans } = run([named("INSC1000")], MAP, {
    offered: (id, sem) => !(id === "INSC1000" && sem === "fall"),
  });
  assert.ok(plans[0].domain.length > 0, "never empty");
  assert.equal(plans[0].domain.includes(0), false, "term 0 really was illegal");
  assert.deepEqual(plans[0].domain, [1, 3, 5], "and the spring terms all survive");
});

test("a seminar behind a prerequisite is not dragged into term 0", () => {
  const { plans } = run([named("INSC1000")], MAP, { depthOf: (id) => id === "INSC1000" ? 2 : 0 });
  assert.equal(plans[0].domain.includes(0), false);
  assert.ok(plans[0].domain.length > 0);
});

// ── What must NOT be pinned ─────────────────────────────────────────

test("a co-requisite bundle pairing a seminar with a real course is not a seminar", () => {
  // Pinning this would drag a 4 SH course into term 0 on the strength of its 1 SH partner.
  const { plans } = run([named("INSC1000", "MATH1341")], MAP);
  assert.equal(plans[0].domain.length, 6);
});

test("a CHOICE between two seminars IS pinned — either answer is a seminar", () => {
  // The case that made the first version of this rule nearly inert. A combined major ORs the
  // two colleges' seminars, `OR(INSC 1000, POLS 1000)`, and 5 of the 8 programs still
  // mistimed after the first attempt were exactly this shape.
  const cell = { id: "c", kind: "named", title: "x", sh: 1,
                 groups: [["INSC1000"], ["MATH1000"]] };
  const { plans } = run([cell], MAP);
  assert.deepEqual(plans[0].domain, [0]);
});

test("a choice between a seminar and a REAL course is not pinned", () => {
  // Here one answer is an ordinary 4 SH course, so pinning would assert something false
  // about half the cell's options.
  const cell = { id: "c", kind: "named", title: "x", sh: 4,
                 groups: [["INSC1000"], ["MATH1341"]] };
  const { plans } = run([cell], MAP);
  assert.equal(plans[0].domain.length, 6);
});

test("an open pool that merely ADMITS a seminar is not pinned", () => {
  const cell = { id: "c", kind: "open", title: "Elective", sh: 4,
                 spec: { keys: new Set(["INSC1000", "MATH1341"]), ranges: [] } };
  const { plans } = run([cell], MAP);
  assert.ok(plans[0].domain.length > 1);
});

// ── The department outranks the convention ──────────────────────────

test("a seminar the DEPARTMENT published is left alone", () => {
  // `adoptEarlyTerms` runs after `buildDomains` and narrows a published course's domain to a
  // unit, and that narrowing is explicitly "the one thing that can turn a plan into a
  // refusal". So a convention that had pinned the same course to a different term would be
  // paid for in coverage rather than reported. 3 of 421 published placements are not term 0.
  const { plans } = run([named("INSC1000")], MAP, {
    departmentPlaced: new Set(["INSC1000"]),
  });
  assert.equal(plans[0].domain.length, 6, "the department's arrangement is not pre-empted");
});

test("a seminar the department did NOT publish is still pinned", () => {
  const { plans } = run([named("INSC1000")], MAP, {
    departmentPlaced: new Set(["MATH1341"]),
  });
  assert.deepEqual(plans[0].domain, [0]);
});

// ── The knob ────────────────────────────────────────────────────────

test("no configured title disables the rule entirely", () => {
  // The engine default. An institution with no such course must be unaffected.
  const { plans } = buildDomains([named("INSC1000")], terms(), {
    courseMap: MAP, offered: () => true, trace: true,
  });
  assert.equal(plans[0].domain.length, 6);
});

test("two seminars both want term 0, and both get it", () => {
  // Mathematics and Physics BS is exactly this: INSC 1000 for the college and MATH 1000
  // for the major. Capacity is the search's problem, not the domain's — the domain must
  // not arbitrate between them.
  const { plans } = run([named("INSC1000"), named("MATH1000")], MAP);
  assert.deepEqual(plans[0].domain, [0]);
  assert.deepEqual(plans[1].domain, [0]);
});

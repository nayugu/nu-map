// UNIT · src/engine/demand.js `breadthCodes` — which competencies the electives must carry.
//
// A general elective is the most flexible cell in a plan: any level, any subject, no
// ordering requirement at all. The ONE exception is breadth — the NUPath codes the
// degree's own named courses do not already guarantee have to come from somewhere, and
// electives are the only somewhere left. Binding those is what gives an otherwise
// `spec: null` cell a candidate set, and therefore a place in every ordering signal the
// engine has.
//
// Every test here is a way of getting that wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breadthCodes } from "../../src/engine/demand.js";

const course = (id, attributes = [], extra = {}) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh: 4,
  attributes, ...extra,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));
const named = (id, ids) => ({ id, kind: "named", groups: [ids], sh: 4, title: id });
const choice = (id, ids) => ({ id, kind: "choice", groups: [ids], sh: 4, title: id });

// Supply is deliberately unequal and never tied, so the ordering assertion tests RARITY
// rather than the alphabetical tie-break behind it. Mirrors the real spread, where WF has
// 5 courses corpus-wide, WD 16, and WI 327.
//   WF 1 course   <   EX 2   <   IC 3
const CM = mapOf(
  course("AAA1", ["IC"]), course("AAA2", ["IC"]), course("AAA3", ["IC"]),
  course("BBB1", ["WF"]),
  course("CCC1", ["EX"]), course("CCC2", ["EX"]),
  course("DDD1", []),
);

test("breadth › the unmet codes come back, rarest first", () => {
  const got = breadthCodes([], CM, []);
  assert.deepEqual(got.map(c => c.code), ["WF", "EX", "IC"],
    "scarcest competency first — it has the fewest terms it can possibly sit in");
  assert.deepEqual(got.find(c => c.code === "IC").ids.sort(), ["AAA1", "AAA2", "AAA3"]);
});

test("breadth › a code a NAMED course already carries is not asked for again", () => {
  const got = breadthCodes([named("n", ["AAA1"])], CM, []);
  assert.ok(!got.some(c => c.code === "IC"), "IC is guaranteed by a course the degree names");
  assert.deepEqual(got.map(c => c.code), ["WF", "EX"]);
});

test("breadth › a CHOICE cell guarantees nothing and must not count as covered", () => {
  // "AAA1 or BBB1" carries IC on one branch and WF on the other. Counting it would let a
  // degree read as covered by a competency no student is obliged to take, and the
  // student finds out at graduation.
  const got = breadthCodes([choice("c", ["AAA1", "BBB1"])], CM, []);
  assert.deepEqual(got.map(c => c.code), ["WF", "EX", "IC"],
    "neither branch may be assumed");
});

test("breadth › a granted code is not spent on an elective", () => {
  // EX is the most-unmet competency in the corpus (244 of 349 programs) and a co-op
  // carries it. Not crediting it burns a free elective on something the plan already
  // delivers, in about 70% of programs.
  const got = breadthCodes([], CM, ["EX"]);
  assert.deepEqual(got.map(c => c.code), ["WF", "IC"]);
});

test("breadth › no attribute data means NO CLAIM, not 'everything is unmet'", () => {
  // A catalog without NUPath would otherwise bind every elective to a code with no
  // courses in it, which is the loudest possible way to be wrong about missing data.
  assert.deepEqual(breadthCodes([], mapOf(course("ZZZ1", [])), []), []);
  assert.deepEqual(breadthCodes([], {}, []), []);
});

test("breadth › a named cell naming a course the catalog lost is skipped, not thrown on", () => {
  // 13.2% of prereq atoms are renumbered away; a group can name an id `courseMap` has
  // no entry for, and a crash here would refuse the whole degree over one stale code.
  assert.doesNotThrow(() => breadthCodes([named("n", ["GONE9999", "AAA1"])], CM, []));
  const got = breadthCodes([named("n", ["GONE9999", "AAA1"])], CM, []);
  assert.ok(!got.some(c => c.code === "IC"), "the readable half still counts");
});

// ── How a bound cell is expressed: LABELLED, never restricted ───────

test("breadth › a bound elective is named but keeps its freedom", async () => {
  // The decision this test exists to protect, and it was measured both ways. Giving the
  // cell a real spec — the courses carrying that code — was the obvious move and it cost
  // far more than it bought: over the plans it touched, empty full terms went 18 -> 63
  // while terms leaving 3+ cells unguided improved only ~12 -> 2. Labelling without
  // restricting lands at 19 and 3.
  //
  // The cause is what makes a general elective worth having: it is the most flexible cell
  // in the plan, so it is what fills a term that would otherwise be empty. A spec takes
  // that away and replaces it with nothing.
  //
  // It would also overclaim. `attributes` covers 1,516 of 7,966 courses, so a hard spec
  // excludes four fifths of the catalog on data we know is partial — a student satisfies
  // IC with any IC course, including the ones our scrape has not labelled.
  const { deriveCells } = await import("../../src/engine/demand.js");
  const cm = mapOf(course("XX1000", ["IC"]), course("XX1001", ["IC"]), course("XX1002", ["IC"]));
  const { cells } = deriveCells(
    { totalCreditsRequired: 40, requirementSections: [] }, { courseMap: cm });
  const bound = cells.filter(c => c.nupath);
  assert.ok(bound.length > 0, "a degree that is all free electives should bind at least one");
  for (const c of bound) {
    assert.equal(c.spec, null, "a breadth elective must NOT be restricted to a candidate set");
    // And it must not ANNOUNCE the competency either. The binding is guidance that spreads
    // breadth across the plan — one ordering among several — so printing it on the card
    // would read as an instruction to a student whose own choice of elective could carry
    // the code just as well. The cell keeps `nupath`; the card says "General Elective".
    assert.equal(c.title, "General Elective");
    assert.doesNotMatch(c.title, /\(/, "no competency, no parenthetical of any kind");
  }
});

test("breadth › malformed cells do not throw", () => {
  for (const cells of [
    [{ id: "x", kind: "named" }],
    [{ id: "x", kind: "named", groups: [] }],
    [{ id: "x", kind: "named", groups: [[]] }],
    [null],
  ]) {
    assert.doesNotThrow(() => breadthCodes(cells.filter(Boolean), CM, []),
      JSON.stringify(cells));
  }
});

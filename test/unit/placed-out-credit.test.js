// UNIT · a placed-out course earns no credit, so it is never a General Elective.
//
// Reported by a student: placing out of CHNS 2101 (and so CHNS 1101 and 1102)
// listed all three under General Electives at 4 SH each, adding 12 SH the
// degree never awarded, while the header's total correctly left them out. The
// bank defines placing out as "no credit, but satisfy prerequisites", and the
// audit disagreed with it.
//
// The cause was one set doing two jobs. `realPlacedSet` included placed-out
// courses and fed General Electives; it also feeds the minor cap, which counts
// placement as advanced standing ON PURPOSE. So General Electives now draws
// from its own set, `creditPlacedSet`, and the cap's set is untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePlanSets, withoutPlacedOut } from "../../src/core/planModel.js";
import { allocateMajorWithElectives } from "../../src/core/gradRequirements.js";

const SEM_IDX = { sem1: 0, sem2: 1, sem3: 2 };
const CUR_IDX = 1;

const courseMap = {
  CS1800:   { subject: "CS",   number: "1800", sh: 4 },
  ARTH1110: { subject: "ARTH", number: "1110", sh: 4 },
  CHNS1101: { subject: "CHNS", number: "1101", sh: 4 },
  CHNS1102: { subject: "CHNS", number: "1102", sh: 4 },
  CHNS2101: { subject: "CHNS", number: "2101", sh: 4 },
  CHNS2102: { subject: "CHNS", number: "2102", sh: 4 },
};

// The student's case: placed out of the first three, took 2102 for real.
const PLACEMENTS = { CS1800: "sem1", ARTH1110: "sem1", CHNS2102: "sem2" };
const PLACED_OUT = new Set(["CHNS1101", "CHNS1102", "CHNS2101"]);

// A degree that names CS 1800 and nothing in Chinese: everything else is free.
const MAJOR = {
  totalCreditsRequired: 128,
  requirementSections: [{
    type: "SECTION", title: "Core", minRequirementCount: 1,
    requirements: [{ type: "COURSE", subject: "CS", classId: 1800 }],
  }],
};

const sets = (extra = {}) => derivePlanSets({
  placements: PLACEMENTS, placedOut: PLACED_OUT, courseMap,
  dynSemIdx: SEM_IDX, curIdx: CUR_IDX, ...extra,
});

const geKeys = ge => ge.children.map(c => c.key).sort();

test("creditPlacedSet leaves placed-out courses out; the other sets keep them", () => {
  const { placedSet, realPlacedSet, creditPlacedSet } = sets();
  for (const k of PLACED_OUT) {
    assert.ok(placedSet.has(k), `${k} should still satisfy requirements and prerequisites`);
    assert.ok(realPlacedSet.has(k), `${k} left realPlacedSet, which the minor cap reads`);
    assert.ok(!creditPlacedSet.has(k), `${k} is in the set General Electives draws from`);
  }
  assert.ok(creditPlacedSet.has("CHNS2102"), "a course actually taken lost its credit");
});

test("the student's case: General Electives lists only courses actually taken", () => {
  const { placedSet, creditPlacedSet, doneKeys } = sets();
  const { generalElectives } = allocateMajorWithElectives(MAJOR, placedSet, courseMap,
    { completedSet: doneKeys, realPlacedSet: creditPlacedSet, geAllowance: 124 });
  assert.deepEqual(geKeys(generalElectives), ["ARTH1110", "CHNS2102"]);
  assert.equal(generalElectives.placedSH, 8);
});

test("the old input reproduces the bug, so the test above is not vacuous", () => {
  const { placedSet, realPlacedSet, doneKeys } = sets();
  const { generalElectives } = allocateMajorWithElectives(MAJOR, placedSet, courseMap,
    { completedSet: doneKeys, realPlacedSet, geAllowance: 124 });
  assert.equal(generalElectives.placedSH, 20, "12 SH of waived courses counted as electives");
});

test("a placed-out course still satisfies a requirement that names it", () => {
  const major = { ...MAJOR, requirementSections: [{
    type: "SECTION", title: "Language", minRequirementCount: 1,
    requirements: [{ type: "COURSE", subject: "CHNS", classId: 2101 }],
  }] };
  const { placedSet, creditPlacedSet, doneKeys } = sets();
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap,
    { completedSet: doneKeys, realPlacedSet: creditPlacedSet, geAllowance: 124 });
  assert.equal(sections[0].sat, true, "the waiver stopped satisfying the requirement");
});

test("a course both placed AND placed out earns no credit, matching the header's total", () => {
  // The app removes a course from the grid when it is placed out, so this
  // state comes only from an old or imported plan. The header's totalSHPlaced
  // drops it by id; General Electives must agree, or the two numbers differ.
  const { creditPlacedSet } = sets({ placements: { ...PLACEMENTS, CHNS1101: "sem1" } });
  assert.ok(!creditPlacedSet.has("CHNS1101"));
});

test("withoutPlacedOut accepts a Set or an array, and is identity when nothing is placed out", () => {
  const p = { a: "sem1", b: "sem2" };
  assert.equal(withoutPlacedOut(p, new Set()), p);
  assert.deepEqual(withoutPlacedOut(p, ["a"]), { b: "sem2" });
  assert.deepEqual(withoutPlacedOut(p, new Set(["b"])), { a: "sem1" });
  assert.deepEqual(withoutPlacedOut(undefined, ["a"]), {});
});

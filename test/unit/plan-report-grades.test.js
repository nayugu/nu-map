// The printed report's grade views.
//
// The defect this file exists for: GradPanel derived its placed/done sets
// through dropVoidTakes/dropUnearnedTakes, and the PDF export derived its own
// from RAW placements. So a course graded F, W, U or X was struck through on
// screen and printed as COMPLETED — toward requirement satisfaction, toward
// the NUPath grid and toward "SH completed" — on the one artifact a student
// hands to an advisor. Both now go through derivePlanSets.
//
// The invariant under everything, same as gradeSystem's: with no grades
// entered, every set is exactly what it was before grades existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePlanSets } from "../../src/core/planModel.js";

// Four semesters; "now" is sem3, so sem1/sem2 are completed.
const SEM_IDX = { sem1: 0, sem2: 1, sem3: 2, sem4: 3 };
const CUR_IDX = 2;

const courseMap = {
  a: { subject: "CS", number: "1800", sh: 4 },
  b: { subject: "CS", number: "2500", sh: 4 },
  c: { subject: "MATH", number: "1341", sh: 4 },
  d: { subject: "ENGW", number: "1111", sh: 4 },
  e: { subject: "PHYS", number: "1151", sh: 5 },
};

const PLACEMENTS = { a: "sem1", b: "sem1", c: "sem2", d: "sem3", e: "sem4" };

const derive = (grades, extra = {}) => derivePlanSets({
  placements: PLACEMENTS, grades, courseMap, dynSemIdx: SEM_IDX, curIdx: CUR_IDX, ...extra,
});

const keys = set => [...set].sort();

// ── the default path is unchanged ───────────────────────────────────

test("no grades entered › every set is identity, as if grades did not exist", () => {
  const { projected, earned, placedSet, doneKeys } = derive({});
  assert.equal(projected, PLACEMENTS, "projected should be the same reference");
  assert.equal(earned, PLACEMENTS, "earned should be the same reference");
  assert.deepEqual(keys(placedSet), ["CS1800", "CS2500", "ENGW1111", "MATH1341", "PHYS1151"]);
  // sem1 + sem2 are before curIdx; sem3 is "now" and sem4 is future.
  assert.deepEqual(keys(doneKeys), ["CS1800", "CS2500", "MATH1341"]);
});

// ── the failure the defect let through ──────────────────────────────

test("a failed course satisfies nothing and is not completed", () => {
  // CS 2500 taken in sem1 and failed. It is still ON the plan — the student
  // took it — but it satisfies no requirement and earned no hours.
  const { placedSet, doneKeys } = derive({ b: "F" });
  assert.ok(!placedSet.has("CS2500"), "an F still satisfies requirements");
  assert.ok(!doneKeys.has("CS2500"), "an F still counts as completed");
  // Its neighbours are untouched.
  assert.ok(placedSet.has("CS1800") && doneKeys.has("CS1800"));
});

test("every no-credit outcome is voided, not just F", () => {
  for (const g of ["F", "U", "W", "X"]) {
    const { placedSet, doneKeys } = derive({ b: g });
    assert.ok(!placedSet.has("CS2500"), `${g} still satisfies requirements`);
    assert.ok(!doneKeys.has("CS2500"), `${g} still counts as completed`);
  }
});

test("a passing grade changes nothing — the fix must not over-reach", () => {
  for (const g of ["A", "C-", "D-", "S", "T"]) {
    const { placedSet, doneKeys } = derive({ b: g });
    assert.ok(placedSet.has("CS2500"), `${g} was wrongly voided`);
    assert.ok(doneKeys.has("CS2500"), `${g} was wrongly marked incomplete`);
  }
});

// ── the two views genuinely differ, and I is where ───────────────────

test("an incomplete still projects toward the degree but has earned nothing", () => {
  // This is the whole reason there are two views rather than one filter.
  const { placedSet, doneKeys } = derive({ b: "I" });
  assert.ok(placedSet.has("CS2500"), "an I should still count toward the plan");
  assert.ok(!doneKeys.has("CS2500"), "an I has earned no hours yet");
});

// ── ordering: voids drop before substitutions re-apply ──────────────

test("a failed substituting course cannot smuggle its target back in", () => {
  // Substitution "placing `a` also satisfies MATH 1341" — but `a` was failed,
  // so the virtual target must not appear. Applying substitutions BEFORE
  // dropping voids would place the target under its own ungraded id, which
  // dropVoidTakes could then never remove.
  const subs = [{ from: "a", to: "zz" }];
  const map  = { ...courseMap, zz: { subject: "HONR", number: "1310", sh: 4 } };
  const { placedSet } = derivePlanSets({
    placements: PLACEMENTS, grades: { a: "F" }, substitutions: subs,
    courseMap: map, dynSemIdx: SEM_IDX, curIdx: CUR_IDX,
  });
  assert.ok(!placedSet.has("HONR1310"), "a failed course still granted its substitution target");
  assert.ok(!placedSet.has("CS1800"), "the failed course itself still satisfies");
});

test("realPlacedSet excludes substitution targets, placedSet includes them", () => {
  const subs = [{ from: "a", to: "zz" }];
  const map  = { ...courseMap, zz: { subject: "HONR", number: "1310", sh: 4 } };
  const { placedSet, realPlacedSet } = derivePlanSets({
    placements: PLACEMENTS, grades: {}, substitutions: subs,
    courseMap: map, dynSemIdx: SEM_IDX, curIdx: CUR_IDX,
  });
  assert.ok(placedSet.has("HONR1310"), "the substitution target should satisfy requirements");
  assert.ok(!realPlacedSet.has("HONR1310"), "the virtual target leaked into the real set");
});

// ── scoping rules that predate grades and must survive them ─────────

test("a course parked outside the timeline audits as nothing, graded or not", () => {
  const { placedSet, doneKeys } = derivePlanSets({
    placements: { ...PLACEMENTS, f: "__overflow:1" },
    grades: { f: "A" },
    courseMap: { ...courseMap, f: { subject: "BIOL", number: "1111", sh: 4 } },
    dynSemIdx: SEM_IDX, curIdx: CUR_IDX,
  });
  assert.ok(!placedSet.has("BIOL1111"), "a parked course satisfied a requirement");
  assert.ok(!doneKeys.has("BIOL1111"), "a parked course counted as completed");
});

test("placedOut courses satisfy regardless of grade view", () => {
  const { placedSet } = derivePlanSets({
    placements: PLACEMENTS, grades: {}, placedOut: new Set(["e"]),
    courseMap, dynSemIdx: SEM_IDX, curIdx: CUR_IDX,
  });
  assert.ok(placedSet.has("PHYS1151"));
});

// ── the completion rule is the caller's, not this function's ────────

test("isCompleted is honoured, so a caller can adopt this without changing 'done'", () => {
  // GradPanel's getSemStatus also calls the graduation semester completed once
  // the plan is graduated; the printed report never has. The default is the
  // report's rule, and a caller can pass its own.
  const { doneKeys } = derive({}, { isCompleted: semId => (SEM_IDX[semId] ?? 99) <= CUR_IDX });
  assert.ok(doneKeys.has("ENGW1111"), "the caller's completion rule was ignored");
  assert.ok(!doneKeys.has("PHYS1151"), "the caller's rule was over-applied");
});

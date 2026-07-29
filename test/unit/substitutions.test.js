// UNIT · substitution model — src/core/planModel.js applySubstitutions, composed
// with the two consumers that read its output: prereqEval and gradRequirements.
//
// A substitution { from, to } means "placing `from` also satisfies `to`". The
// transform adds a *virtual* placement of `to` at `from`'s semester. The load-
// bearing guarantees, and the ways they can silently lie to a student:
//   • the substitute satisfies the target's prereq/requirement slot,
//   • but only in a strictly-earlier semester (wrong-order still fires),
//   • credits are counted once (the virtual entry never inflates total SH),
//   • removing the substitution reverts the verdict entirely,
//   • one substitution fills at most one requirement (no double-fill).
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySubstitutions } from "../../src/core/planModel.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";
import {
  buildPlacedKeySet, checkReq, allocateMajorWithElectives, getTotalPlacedSH,
} from "../../src/core/gradRequirements.js";

const semIndex = { fall: 0, spring: 1, summer: 2 };
const ref = (subject, number, extra = {}) => ({ subject, number, ...extra });

// courseMap is keyed by canonical id ("CS2000"); each course carries sh for credit math.
const courseMap = {
  CS1000: { subject: "CS", number: "1000", sh: 4 }, // the substitute (what the student placed)
  CS2000: { subject: "CS", number: "2000", sh: 4 }, // the target (what a rule asks for)
  CS9999: { subject: "CS", number: "9999", sh: 4 },
};

// ── applySubstitutions: the transform itself ─────────────────────────
test("applySubstitutions › no substitutions › returns the same reference (no-op)", () => {
  const p = { CS1000: "fall" };
  assert.equal(applySubstitutions(p, []), p);
});

test("applySubstitutions › target placed at the substitute's semester › does not mutate input", () => {
  const p = { CS1000: "fall" };
  const ep = applySubstitutions(p, [{ from: "CS1000", to: "CS2000" }]);
  assert.deepEqual(ep, { CS1000: "fall", CS2000: "fall" });
  assert.deepEqual(p, { CS1000: "fall" }, "original placements must be untouched");
});

test("applySubstitutions › substitute not placed › target is not conjured", () => {
  // from-course absent → no virtual target (nothing to substitute yet).
  assert.deepEqual(applySubstitutions({}, [{ from: "CS1000", to: "CS2000" }]), {});
});

// ── Composed with prereqEval: substitute satisfies a target prereq ───
test("substitution › satisfies a course's prereq via the target › satisfied", () => {
  // Course X requires CS2000; student placed CS1000 (fall) and substitutes it for CS2000.
  const prereqsOfX = [ref("CS", "2000")];
  const ep = applySubstitutions({ CS1000: "fall" }, [{ from: "CS1000", to: "CS2000" }]);
  // X sits in spring (ti=1); the virtual CS2000 lands in fall (0) < 1 → satisfied.
  assert.equal(evalPrereqTree(prereqsOfX, ep, semIndex, 1), "satisfied");
});

test("substitution › substitute placed too late for the prereq › order (wrong-order variant)", () => {
  const prereqsOfX = [ref("CS", "2000")];
  // substitute placed in summer (2); course X in fall (ti=0) → virtual CS2000 at 2, not < 0 → order.
  const ep = applySubstitutions({ CS1000: "summer" }, [{ from: "CS1000", to: "CS2000" }]);
  assert.equal(evalPrereqTree(prereqsOfX, ep, semIndex, 0), "order");
});

test("substitution › removed › prereq reverts to missing (no residual satisfaction)", () => {
  const prereqsOfX = [ref("CS", "2000")];
  const ep = applySubstitutions({ CS1000: "fall" }, []); // substitution removed
  assert.equal(evalPrereqTree(prereqsOfX, ep, semIndex, 1), "missing");
});

test("substitution › target counts inside an Or prereq tree › satisfied", () => {
  // X requires (CS2000 Or CS9999); neither placed directly, but CS1000→CS2000 substitution stands in.
  const prereqsOfX = [ref("CS", "2000"), "Or", ref("CS", "9999")];
  const ep = applySubstitutions({ CS1000: "fall" }, [{ from: "CS1000", to: "CS2000" }]);
  assert.equal(evalPrereqTree(prereqsOfX, ep, semIndex, 1), "satisfied");
});

// ── Composed with gradRequirements: requirement satisfaction + credits ─
test("substitution › satisfies a required COURSE in the placed set", () => {
  const ep = applySubstitutions({ CS1000: "fall" }, [{ from: "CS1000", to: "CS2000" }]);
  const placedSet = buildPlacedKeySet(ep, new Set(), courseMap);
  assert.ok(placedSet.has("CS2000"), "target should be present for requirement checks");
  const result = checkReq({ type: "COURSE", subject: "CS", classId: "2000" }, placedSet, courseMap);
  assert.equal(result.sat, true);
});

test("substitution › credits count once — total SH uses real placements only", () => {
  // The virtual target must never add credits: the student took one 4-SH course.
  const realPlacements = { CS1000: "fall" };
  assert.equal(getTotalPlacedSH(realPlacements, courseMap), 4);
  // Even though the effective placed set carries both keys for satisfaction:
  const ep = applySubstitutions(realPlacements, [{ from: "CS1000", to: "CS2000" }]);
  const realKeys = buildPlacedKeySet(realPlacements, new Set(), courseMap);
  const effKeys = buildPlacedKeySet(ep, new Set(), courseMap);
  assert.ok(!realKeys.has("CS2000"), "real placed set excludes the virtual target");
  assert.ok(effKeys.has("CS2000"), "effective placed set includes it for satisfaction");
});

test("substitution › one substitution fills at most one of two identical requirements (no double-fill)", () => {
  // Two separate sections both require CS2000. A single (substituted) CS2000 can
  // satisfy exactly one — the allocator's used-set must starve the second.
  const major = {
    requirementSections: [
      { title: "Section A", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
      { title: "Section B", minRequirementCount: 1, requirements: [{ type: "COURSE", subject: "CS", classId: "2000" }] },
    ],
  };
  const ep = applySubstitutions({ CS1000: "fall" }, [{ from: "CS1000", to: "CS2000" }]);
  const placedSet = buildPlacedKeySet(ep, new Set(), courseMap);
  const realPlacedSet = buildPlacedKeySet({ CS1000: "fall" }, new Set(), courseMap);
  const { sections } = allocateMajorWithElectives(major, placedSet, courseMap, null, realPlacedSet);
  const satCount = sections.filter(s => s.sat).length;
  assert.equal(satCount, 1, "exactly one section should be satisfied, not both");
});

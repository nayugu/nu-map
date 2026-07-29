// UNIT · src/core/programEligibility.js — candidate-facing "could this course
// count toward the program, and how?" matcher backing the Course Bank
// required/elective filters. Complements gradRequirements.js (which matches
// *placed* courses); here we test *catalog* courses against a program's
// COURSE/RANGE leaves, split into required vs elective buckets. Pure; no I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectEligibleSpec, mergeSplitSpecs, courseEligible, countsAsElectiveOnly, emptySpec,
} from "../../src/core/programEligibility.js";

const course = (id, subject, number) => ({ id, subject, number });

// A section that must be taken in full (min === count) holds required courses;
// a "choose N of M" section, an XOM pool, and ranges are elective options.
const program = {
  requirementSections: [
    { type: "SECTION", title: "Core", minRequirementCount: 2, requirements: [
      { type: "COURSE", subject: "CS", classId: 2500 },   // required (take all)
      { type: "COURSE", subject: "CS", classId: 2510 },   // required (take all)
    ] },
    { type: "SECTION", title: "Choose one", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "CS", classId: 3000 },   // elective option
      { type: "COURSE", subject: "CS", classId: 3100 },   // elective option
    ] },
    { type: "SECTION", title: "Electives", minRequirementCount: 3, requirements: [
      { type: "XOM", numCreditsMin: 12, courses: [
        { type: "COURSE", subject: "CS", classId: 4100 }, // elective (pool)
        { type: "RANGE", subject: "MATH", idRangeStart: 3000, idRangeEnd: 3999,
          exceptions: [{ subject: "MATH", classId: 3200 }] }, // elective (range)
      ] },
    ] },
  ],
};

test("named must-take courses land in the required bucket", () => {
  const { required, elective } = collectEligibleSpec(program);
  assert.equal(courseEligible(course("CS2500", "CS", "2500"), required), true);
  assert.equal(courseEligible(course("CS2510", "CS", "2510"), required), true);
  // Not electives.
  assert.equal(courseEligible(course("CS2500", "CS", "2500"), elective), false);
});

test("choose-N-of-M section courses are elective, not required", () => {
  const { required, elective } = collectEligibleSpec(program);
  assert.equal(courseEligible(course("CS3000", "CS", "3000"), elective), true);
  assert.equal(courseEligible(course("CS3100", "CS", "3100"), elective), true);
  assert.equal(courseEligible(course("CS3000", "CS", "3000"), required), false);
});

test("XOM pool courses and ranges are elective", () => {
  const { elective } = collectEligibleSpec(program);
  assert.equal(courseEligible(course("CS4100", "CS", "4100"), elective), true);
  assert.equal(courseEligible(course("MATH3500", "MATH", "3500"), elective), true);
});

test("range exceptions are excluded", () => {
  const { elective } = collectEligibleSpec(program);
  assert.equal(courseEligible(course("MATH3200", "MATH", "3200"), elective), false);
});

test("a single-course XOM (split-credit) stays required", () => {
  const split = collectEligibleSpec({ requirementSections: [
    { type: "SECTION", minRequirementCount: 1, requirements: [
      { type: "XOM", numCreditsMin: 4, courses: [{ type: "COURSE", subject: "CS", classId: 5010 }] },
    ] },
  ] });
  assert.equal(courseEligible(course("CS5010", "CS", "5010"), split.required), true);
  assert.equal(courseEligible(course("CS5010", "CS", "5010"), split.elective), false);
});

test("a required course never counts as an elective, even if it also sits in a pool", () => {
  // A CS technical-elective range that happens to span a CS core requirement.
  const major = { requirementSections: [
    { type: "SECTION", title: "Core", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "CS", classId: 3500 },   // required core
    ] },
    { type: "SECTION", title: "Technical electives", minRequirementCount: 2, requirements: [
      { type: "XOM", numCreditsMin: 8, courses: [
        { type: "RANGE", subject: "CS", idRangeStart: 3000, idRangeEnd: 4999 }, // spans CS3500
      ] },
    ] },
  ] };
  const { required, elective } = collectEligibleSpec(major);
  // CS3500 is in the elective range bucket…
  assert.equal(courseEligible(course("CS3500", "CS", "3500"), elective), true);
  // …but it's a required core course, so it is NOT an elective.
  assert.equal(countsAsElectiveOnly(course("CS3500", "CS", "3500"), required, elective), false);
  // A non-core course in the same range IS a genuine elective.
  assert.equal(countsAsElectiveOnly(course("CS4100", "CS", "4100"), required, elective), true);
});

test("required-elsewhere courses are excluded from electives across merged programs", () => {
  const electiveHere = { requirementSections: [
    { type: "SECTION", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "CS", classId: 3000 },
      { type: "COURSE", subject: "CS", classId: 3200 },
    ] },
  ] };
  const requiredElsewhere = { requirementSections: [
    { type: "SECTION", minRequirementCount: 1, requirements: [
      { type: "COURSE", subject: "CS", classId: 3000 },
    ] },
  ] };
  const { required, elective } = mergeSplitSpecs(
    collectEligibleSpec(electiveHere), collectEligibleSpec(requiredElsewhere));
  assert.equal(countsAsElectiveOnly(course("CS3000", "CS", "3000"), required, elective), false);
  assert.equal(countsAsElectiveOnly(course("CS3200", "CS", "3200"), required, elective), true);
});

test("empty / null input matches nothing", () => {
  const { required, elective } = collectEligibleSpec(null);
  assert.equal(courseEligible(course("CS2500", "CS", "2500"), required), false);
  assert.equal(courseEligible(course("CS2500", "CS", "2500"), elective), false);
  assert.equal(courseEligible(course("CS2500", "CS", "2500"), emptySpec()), false);
});

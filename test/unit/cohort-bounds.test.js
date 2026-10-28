// UNIT · src/core/semGrid.js cohort-bound helpers — which terms a plan may
// start and end in, how they order, and how long the plan reads.
//
// Run against the REAL Northeastern calendar, because the defect these replace
// lived in how the calendar's list order was read: ranking by list position
// (Fall first) put Spring 2030 after Fall 2030, and a summer would have landed
// after the fall that follows it. A test on a hand-made calendar listing terms
// chronologically would pass both the old code and the new.
//
// Policy behind the summer choice: the registrar confers once per summer, after
// Session B, whichever session the last courses were in (2025–26 calendar:
// "Summer degree conferral", Aug 19, 2026; the Jun 24 date is "by exception").
import { test } from "node:test";
import assert from "node:assert/strict";
import calendar from "../../src/adapters/northeastern/calendar.js";
import {
  cohortTermChoices, cohortOrd, cohortTermKey, cohortDuration, buildCohortSemesters,
} from "../../src/core/semGrid.js";

const ord = (id, y) => cohortOrd(id, y, calendar);

test("cohortTermChoices › entry is the full terms; graduation adds ONE summer, stored as Session B", () => {
  const { entry, graduation } = cohortTermChoices(calendar);
  assert.deepEqual(entry, ["fall", "spring"]);
  assert.deepEqual(graduation, ["fall", "spring", "sumB"]);
});

test("cohortOrd › orders a calendar year Spring < Summer A < Summer B < Fall", () => {
  const seq = [["spring", 2030], ["sumA", 2030], ["sumB", 2030], ["fall", 2030], ["spring", 2031]];
  for (let i = 1; i < seq.length; i++) {
    assert.ok(ord(...seq[i - 1]) < ord(...seq[i]), `${seq[i - 1]} must precede ${seq[i]}`);
  }
});

test("cohortOrd › agrees with the timeline's own order for every bound in a real cohort", () => {
  // The grid is the ground truth for chronology; the ordinal must never disagree with it.
  const sems = buildCohortSemesters("fall", 2026, "sumB", 2031, calendar).slice(1);
  const ords = sems.map(s => ord(s.semTypeId, Number(s.id.match(/\d{4}$/)[0])));
  for (let i = 1; i < ords.length; i++) {
    assert.ok(ords[i - 1] < ords[i], `${sems[i - 1].id} must sort before ${sems[i].id}`);
  }
});

test("cohortOrd › a summer graduation in the entry's own calendar year is BEFORE a fall entry", () => {
  // Fall 2026 → Summer 2026 is graduating before starting; the picker must block it.
  assert.ok(ord("sumB", 2026) < ord("fall", 2026));
  assert.ok(ord("sumB", 2027) > ord("fall", 2026));
});

test("cohortTermKey › names a bound by its theme, so Session B reads as Summer", () => {
  assert.equal(cohortTermKey("fall", calendar), "header.cohort.fall");
  assert.equal(cohortTermKey("spring", calendar), "header.cohort.spring");
  assert.equal(cohortTermKey("sumB", calendar), "header.cohort.summer");
});

test("cohortDuration › counts full terms and reports a summer finish beside the count", () => {
  assert.deepEqual(cohortDuration("fall", 2026, "spring", 2030, calendar), { years: 4, summer: false });
  assert.deepEqual(cohortDuration("fall", 2026, "sumB", 2030, calendar), { years: 4, summer: true });
  assert.deepEqual(cohortDuration("spring", 2027, "sumB", 2030, calendar), { years: 3.5, summer: true });
  assert.deepEqual(cohortDuration("fall", 2026, "fall", 2030, calendar), { years: 4.5, summer: false });
});

test("buildCohortSemesters › a summer graduation keeps BOTH sessions and ends there", () => {
  const ids = buildCohortSemesters("fall", 2026, "sumB", 2030, calendar).map(s => s.id);
  assert.deepEqual(ids.slice(-3), ["spr2030", "sumA2030", "sumB2030"]);
  assert.equal(ids[0], "incoming");
  assert.equal(ids[1], "fall2026");
});

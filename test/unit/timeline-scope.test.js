// UNIT · timeline scope — calculations only count what is INSIDE the plan's
// timeline (the cohort SEMESTERS range). Placements/work terms parked outside
// it are kept in state (they return when the cohort widens) but must never
// influence credits, audits, stats, violations, or NUPath/EX grants.
// The "mystery co-op": a work term left at an out-of-range semester.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inTimeline, filterInTimeline } from "../../src/core/planModel.js";
import { computeGrantedAttrs } from "../../src/core/specialTermUtils.js";
import { takesUsed } from "../../src/core/repeatInstances.js";
import { inCohortWindow, completedCourseIds, checkViolations } from "../../src/adapters/mcp/plannerActionAdapter.js";

// A toy SEM_INDEX for a fall2026 → spr2028 cohort (as deriveSemMaps builds it)
const IDX = { incoming: 0, fall2026: 1, spr2027: 2, sumA2027: 3, sumB2027: 4, fall2027: 5, spr2028: 6 };

test("timeline › inTimeline / filterInTimeline", () => {
  assert.equal(inTimeline("fall2026", IDX), true);
  assert.equal(inTimeline("incoming", IDX), true);
  assert.equal(inTimeline("fall2024", IDX), false);             // parked in the past
  assert.equal(inTimeline("fall2030", IDX), false);             // parked in the future
  assert.equal(inTimeline("__overflow:fall2026", IDX), false);  // subsumes the old string check

  const placements = { A: "fall2026", B: "fall2024", C: "incoming", D: "__overflow:spr2027" };
  assert.deepEqual(filterInTimeline(placements, IDX), { A: "fall2026", C: "incoming" });
  assert.deepEqual(filterInTimeline(undefined, IDX), {});
});

test("timeline › the mystery co-op: parked work terms grant nothing", () => {
  const types = [{ id: "coop", attributeGrants: ["EX"] }];
  const parked = { w1: { typeId: "coop", semId: "fall2024" } };
  const inRange = { w2: { typeId: "coop", semId: "fall2026" } };

  assert.deepEqual([...computeGrantedAttrs(parked, types, IDX)], []);
  assert.deepEqual([...computeGrantedAttrs(inRange, types, IDX)], ["EX"]);
  // Backwards compatible: no semIndex → old unscoped behaviour
  assert.deepEqual([...computeGrantedAttrs(parked, types)], ["EX"]);
});

test("timeline › takesUsed counts only in-timeline takes when scoped", () => {
  const pl = { MUS1990: "fall2026", "MUS1990#2": "fall2024" };
  assert.equal(takesUsed("MUS1990", pl, undefined, IDX), 1);
  assert.equal(takesUsed("MUS1990", pl), 2); // unscoped (id assignment) unchanged
});

test("timeline › MCP inCohortWindow mirrors the UI test chronologically", () => {
  const plan = { entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2028 };
  assert.equal(inCohortWindow(plan, "fall2026"), true);
  assert.equal(inCohortWindow(plan, "sumA2027"), true);
  assert.equal(inCohortWindow(plan, "spr2028"), true);
  assert.equal(inCohortWindow(plan, "incoming"), true);
  assert.equal(inCohortWindow(plan, "fall2024"), false);
  assert.equal(inCohortWindow(plan, "fall2028"), false);
  assert.equal(inCohortWindow(plan, "__overflow:fall2026"), false);
  // No cohort info → don't filter
  assert.equal(inCohortWindow({}, "fall1999"), true);
});

test("timeline › MCP completedCourseIds excludes parked past placements", () => {
  const plan = {
    entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2028,
    currentSemId: "fall2027",
    placements: { OLD: "fall2024", DONE: "fall2026", FUTURE: "spr2028", INC: "incoming" },
  };
  assert.deepEqual(completedCourseIds(plan).sort(), ["DONE", "INC"]);
});

test("timeline › MCP checkViolations ignores parked placements entirely", () => {
  const courseMap = {
    CS2500: { id: "CS2500", prereqs: [] },
    CS3500: { id: "CS3500", prereqs: [{ subject: "CS", number: "2500" }] },
  };
  const base = { entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2028 };
  // Prereq parked outside the window → does NOT satisfy → missing-prereq violation
  const v1 = checkViolations({ ...base, placements: { CS2500: "fall2024", CS3500: "fall2026" } }, courseMap);
  assert.equal(v1.length, 1);
  assert.equal(v1[0].type, "prereq");
  // The parked course itself is not validated (no phantom violations)
  const v2 = checkViolations({ ...base, placements: { CS3500: "fall2024" } }, courseMap);
  assert.deepEqual(v2, []);
  // Both in range and ordered → clean
  const v3 = checkViolations({ ...base, placements: { CS2500: "fall2026", CS3500: "spr2027" } }, courseMap);
  assert.deepEqual(v3, []);
});

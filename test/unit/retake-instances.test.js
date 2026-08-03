// Retakes — repeatInstances.js. A nonrepeatable course unlocks a second
// take only when every existing take carries an entered terminal grade;
// ungraded courses keep relocate semantics bit-for-bit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAddId, retakeUnlocked } from "../../src/core/repeatInstances.js";

const CS2500 = { id: "CS2500", repeatable: false };
const MUS1990 = { id: "MUS1990", repeatable: true, repeatMax: 4 };

test("retake › no grades → nonrepeatable re-add stays a relocate (base id)", () => {
  const r = resolveAddId(CS2500, { CS2500: "fall" }, new Set());
  assert.deepEqual(r, { id: "CS2500", overLimit: false });
  const r2 = resolveAddId(CS2500, { CS2500: "fall" }, new Set(), {});
  assert.deepEqual(r2, { id: "CS2500", overLimit: false });
});

test("retake › F entered → next add is an instance id, never over-limit", () => {
  const r = resolveAddId(CS2500, { CS2500: "fall" }, new Set(), { CS2500: "F" });
  assert.deepEqual(r, { id: "CS2500#2", overLimit: false });
});

test("retake › any terminal grade unlocks (policy: retake to earn a better grade)", () => {
  for (const g of ["D-", "C", "U", "W", "S"]) {
    assert.equal(retakeUnlocked(CS2500, { CS2500: "fall" }, new Set(), { CS2500: g }), true, g);
  }
});

test("retake › I does NOT unlock — an incomplete resolves in place", () => {
  assert.equal(retakeUnlocked(CS2500, { CS2500: "fall" }, new Set(), { CS2500: "I" }), false);
});

test("retake › second retake needs the retake graded too", () => {
  const placements = { CS2500: "fall", "CS2500#2": "spring" };
  assert.equal(retakeUnlocked(CS2500, placements, new Set(), { CS2500: "F" }), false);
  const r = resolveAddId(CS2500, placements, new Set(), { CS2500: "F", "CS2500#2": "F" });
  assert.deepEqual(r, { id: "CS2500#3", overLimit: false });
});

test("retake › placed-out takes participate (a graded placed-out course can be retaken)", () => {
  const g = { CS2500: "U" };
  assert.equal(retakeUnlocked(CS2500, {}, new Set(["CS2500"]), g), true);
  const r = resolveAddId(CS2500, {}, new Set(["CS2500"]), g);
  assert.equal(r.id, "CS2500#2");
});

test("retake › repeatable courses are untouched by grades", () => {
  const r = resolveAddId(MUS1990, { MUS1990: "fall" }, new Set(), { MUS1990: "A" });
  assert.deepEqual(r, { id: "MUS1990#2", overLimit: false });
  assert.equal(retakeUnlocked(MUS1990, { MUS1990: "fall" }, new Set(), { MUS1990: "F" }), false);
});

test("retake › unplaced course is a plain add regardless of grades", () => {
  const r = resolveAddId(CS2500, {}, new Set(), { SOMETHING: "F" });
  assert.deepEqual(r, { id: "CS2500", overLimit: false });
});

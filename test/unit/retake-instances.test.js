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

test("retake › only definitive failure unlocks: F, U, W hand the slot back", () => {
  for (const g of ["F", "U", "W"]) {
    assert.equal(retakeUnlocked(CS2500, { CS2500: "fall" }, new Set(), { CS2500: g }), true, g);
  }
});

test("retake › a PASSED course is locked — no duplicates of earned credit", () => {
  for (const g of ["D-", "C", "A", "S"]) {
    assert.equal(retakeUnlocked(CS2500, { CS2500: "fall" }, new Set(), { CS2500: g }), false, g);
  }
});

test("retake › I does NOT unlock — an incomplete occupies its slot (resolves in place)", () => {
  assert.equal(retakeUnlocked(CS2500, { CS2500: "fall" }, new Set(), { CS2500: "I" }), false);
});

test("retake › failing the retake resets the counter again", () => {
  const placements = { CS2500: "fall", "CS2500#2": "spring" };
  // retake still ungraded → it occupies the slot, nothing to add
  assert.equal(retakeUnlocked(CS2500, placements, new Set(), { CS2500: "F" }), false);
  // retake failed too → counter back to zero, a third take opens
  const r = resolveAddId(CS2500, placements, new Set(), { CS2500: "F", "CS2500#2": "F" });
  assert.deepEqual(r, { id: "CS2500#3", overLimit: false });
  // retake passed → locked
  assert.equal(retakeUnlocked(CS2500, placements, new Set(), { CS2500: "F", "CS2500#2": "C" }), false);
});

test("repeatable › a failed take doesn't consume repeatMax", () => {
  const placements = { MUS1990: "fall", "MUS1990#2": "spring" };
  // raw: 2 takes; effective with one F: 1 — so a new add is NOT over-limit
  // even at repeatMax 2.
  const tight = { ...MUS1990, repeatMax: 2 };
  const withF = resolveAddId(tight, placements, new Set(), { MUS1990: "F" });
  assert.equal(withF.id, "MUS1990#3");
  assert.equal(withF.overLimit, false);
  const noGrades = resolveAddId(tight, placements, new Set(), {});
  assert.equal(noGrades.overLimit, true);
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

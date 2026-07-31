// UNIT · repeatInstances — synthetic instance ids for multiple takes of a
// repeatable course. First take = plain id, later takes = "ID#2", "ID#3"…
import { test } from "node:test";
import assert from "node:assert/strict";
import { baseId, isInstanceId, takesUsed, resolveAddId } from "../../src/core/repeatInstances.js";

const MUS = { id: "MUS1990", code: "MUS 1990", repeatable: true, repeatMax: null };
const TOPICS = { id: "CS2963", code: "CS 2963", repeatable: true, repeatMax: 4 };
const FIXED = { id: "CS2500", code: "CS 2500", repeatable: false, repeatMax: null };

test("repeatInstances › baseId / isInstanceId", () => {
  assert.equal(baseId("MUS1990"), "MUS1990");
  assert.equal(baseId("MUS1990#2"), "MUS1990");
  assert.equal(baseId("MUS1990#10"), "MUS1990");
  assert.equal(isInstanceId("MUS1990"), false);
  assert.equal(isInstanceId("MUS1990#2"), true);
});

test("repeatInstances › takesUsed counts placements and placed-out", () => {
  const pl = { "MUS1990": "fall2026", "MUS1990#2": "spring2027", "CS2500": "fall2026" };
  assert.equal(takesUsed("MUS1990", pl), 2);
  assert.equal(takesUsed("MUS1990", pl, new Set(["MUS1990#3"])), 3);
  assert.equal(takesUsed("CS2500", pl), 1);
  assert.equal(takesUsed("PHIL1101", pl), 0);
});

test("repeatInstances › resolveAddId: first take uses the plain id", () => {
  assert.deepEqual(resolveAddId(MUS, {}), { id: "MUS1990", overLimit: false });
  assert.deepEqual(resolveAddId(FIXED, {}), { id: "CS2500", overLimit: false });
});

test("repeatInstances › resolveAddId: non-repeatable already placed → base id (caller's move semantics)", () => {
  assert.deepEqual(resolveAddId(FIXED, { "CS2500": "fall2026" }), { id: "CS2500", overLimit: false });
});

test("repeatInstances › resolveAddId: repeatable already placed → lowest free instance id", () => {
  assert.deepEqual(resolveAddId(MUS, { "MUS1990": "fall2026" }), { id: "MUS1990#2", overLimit: false });
  assert.deepEqual(resolveAddId(MUS, { "MUS1990": "fall2026", "MUS1990#2": "spring2027" }), { id: "MUS1990#3", overLimit: false });
  // gap reuse: #2 was removed, #3 remains
  assert.deepEqual(resolveAddId(MUS, { "MUS1990": "fall2026", "MUS1990#3": "spring2027" }), { id: "MUS1990#2", overLimit: false });
  // first take removed but #2 remains → base id is free again
  assert.deepEqual(resolveAddId(MUS, { "MUS1990#2": "spring2027" }), { id: "MUS1990", overLimit: false });
});

test("repeatInstances › resolveAddId: placed-out takes block the base id and count toward the limit", () => {
  assert.deepEqual(resolveAddId(MUS, {}, new Set(["MUS1990"])), { id: "MUS1990#2", overLimit: false });
  const r = resolveAddId(TOPICS, { "CS2963": "f", "CS2963#2": "s" }, new Set(["CS2963#3", "CS2963#4"]));
  assert.deepEqual(r, { id: "CS2963#5", overLimit: true });
});

test("repeatInstances › resolveAddId: limit reported, never enforced (NU Map trusts the user)", () => {
  const pl = { "CS2963": "a", "CS2963#2": "b", "CS2963#3": "c", "CS2963#4": "d" };
  assert.deepEqual(resolveAddId(TOPICS, pl), { id: "CS2963#5", overLimit: true });
  // unlimited is never over
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i ? `MUS1990#${i + 1}` : "MUS1990", "x"]));
  assert.deepEqual(resolveAddId(MUS, many), { id: "MUS1990#31", overLimit: false });
});

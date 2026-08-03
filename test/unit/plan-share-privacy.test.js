// Share-link privacy — planShare.js.
// Grades are the most sensitive thing NU Map holds. They live in plan
// slots (localStorage) and MUST NOT survive into a share link: _KEYS is
// an allowlist, so this test pins the property that keeps it one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePlan, decodePlan } from "../../src/core/planShare.js";

const plan = {
  version: 1,
  entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2030,
  placements: { CS2500: "fall2026", "CS2500#2": "spr2027" },
  placedOut: ["ENGW1111"],
  major: "2026/khoury/computer_science_bscs_(boston)",
  planName: "test",
  // The sensitive part: must vanish in transit.
  grades: { CS2500: "F", ENGW1111: "C" },
};

test("share › grades never survive into a share link", async () => {
  const encoded = await encodePlan(plan);
  const decoded = await decodePlan(encoded);
  assert.equal(decoded.grades, undefined);
  // and not under any other name either — no value of the payload
  // contains a grade map shape or the entered symbols keyed by course
  assert.ok(!JSON.stringify(decoded).includes('"F"'));
  // the rest of the plan still round-trips
  assert.deepEqual(decoded.placements, plan.placements);
  assert.deepEqual(decoded.placedOut, plan.placedOut);
});

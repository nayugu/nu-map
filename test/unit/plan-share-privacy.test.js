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

test("share › a template's slots survive the round trip", async () => {
  // Half of a sample plan's credit is a slot, and some programs place nothing
  // BUT slots in their later years. Omitting them from the codec would deliver
  // a shared plan whose final year is empty, which reads as the sender's work
  // having been lost rather than as a missing feature.
  const plan = {
    placements: { CS2500: "fall2026" },
    slots: {
      "slot-fall2029-khoury-elective-0": {
        id: "slot-fall2029-khoury-elective-0", semId: "fall2029",
        label: "Khoury Elective", sh: 4, source: "requirement",
      },
    },
  };
  const back = await decodePlan(await encodePlan(plan));
  assert.deepEqual(back.slots, plan.slots);
});

test("share › a second major's concentration survives the round trip", async () => {
  // conc2 was absent from the codec: it survived a reload (it is written to
  // the plan slot) but was dropped from every share link and share code. 51
  // undergraduate programs REQUIRE a concentration, so a shared double major
  // could arrive unsatisfiable with nothing to indicate why.
  const back = await decodePlan(await encodePlan({ major2: "x", conc2: "Data Science" }));
  assert.equal(back.conc2, "Data Science");
});

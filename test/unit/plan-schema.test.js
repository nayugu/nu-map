// The canonical plan registry (planSchema.js) and the share door that derives
// from it. These tests are the safety net for collapsing the plan's several
// hand-repeated field lists onto one source of truth: they pin the share wire
// format (existing share URLs must keep decoding) and the private-field
// invariant (grades never leave the browser).
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePlan, decodePlan } from "../../src/core/planShare.js";
import { SHARE_KEYS, PLAN_FIELDS, PRIVATE_FIELDS } from "../../src/core/planSchema.js";

// The v2 share-link key map, frozen at the value it had when it was an inline
// literal in planShare.js. Share URLs are permanent — a code someone saved a
// year ago must still decode — so the compact keys are a WIRE FORMAT and may
// never change. If a registry edit changes this map, this test trips before it
// can silently break old links.
const FROZEN_SHARE_KEYS = {
  entSem: "es", entYear: "ey",
  gradSem: "gs", gradYear: "gy",
  placements: "p", specialTermPl: "sp",
  semOrders: "so", shOverrides: "sh",
  bonusSH: "b", currentSemId: "cs",
  offeredOverrides: "oo", collapsedSubs: "cl",
  major: "mj", major2: "mj2", conc: "cn", conc2: "cn2",
  minor1: "m1", minor2: "m2",
  reservations: "rv",
  placedOut: "po", planName: "pn",
  locale: "lc", substitutions: "su",
  studentType: "st",
  // APPENDED 2026-08-13 with the accelerated-pathway (PlusOne) field. Adding a
  // key is backward compatible — an old share link simply has no `p1` and
  // decodes exactly as before — but it is still recorded here deliberately, so
  // that a new field is a conscious act rather than a silent one.
  plusOne: "p1",
};

// The invariant that actually protects old links: every key that has ever
// shipped must still mean the same thing. Stated separately from the deepEqual
// below because the two catch different mistakes — this one catches RENAMING or
// REMOVING a key (which breaks saved URLs), the other catches adding one
// without recording it here.
test("schema › no shipped share key has changed meaning", () => {
  for (const [name, short] of Object.entries(FROZEN_SHARE_KEYS)) {
    assert.equal(SHARE_KEYS[name], short,
      `${name} was "${short}" in a shipped share link and must stay "${short}"`);
  }
});

test("schema › the derived share key map matches the frozen wire format", () => {
  assert.deepEqual(SHARE_KEYS, FROZEN_SHARE_KEYS);
});

test("schema › every private field is unshareable (grades can never leak)", () => {
  assert.ok(PRIVATE_FIELDS.includes("grades"));
  for (const name of PRIVATE_FIELDS) {
    const field = PLAN_FIELDS.find(f => f.name === name);
    assert.equal(field.share, null, `${name} is private but has a share key`);
  }
});

test("schema › no two fields collide on the same compact share key", () => {
  const shorts = Object.values(SHARE_KEYS);
  assert.equal(new Set(shorts).size, shorts.length);
});

// A plan with EVERY shareable field set to a distinct, non-empty value — the
// _isEmpty filter drops empty/zero/"" values, so every value here is non-empty.
const fullPlan = {
  entSem: "fall", entYear: 2026, gradSem: "spring", gradYear: 2030,
  placements: { CS2500: "fall2026", "CS2500#2": "spr2027" },
  reservations: { "fall2026:0": "elective" },
  specialTermPl: {
    inst1: { typeId: "coop", semId: "spr2027", duration: 4, company: "Acme", companyDomain: "acme.com", subline: "Software Eng" },
  },
  semOrders: { fall2026: ["CS2500"] },
  shOverrides: { CS2500: 4 },
  bonusSH: 8,
  currentSemId: "fall2026",
  offeredOverrides: { CS2500: true },
  collapsedSubs: { grp1: true },
  placedOut: ["ENGW1111"],
  substitutions: [{ from: "CS1800", to: "MATH1365" }],
  major: "2026/khoury/computer_science_bscs_(boston)",
  major2: "2026/coe/electrical_engineering_bsee",
  conc: "Artificial Intelligence",
  conc2: "Power Systems",
  minor1: "2026/khoury/data_science_minor",
  minor2: "2026/camd/music_minor",
  studentType: "undergrad",
  planName: "My Plan",
  locale: "en",
  // Deliberately NOT shared:
  grades: { CS2500: "A", ENGW1111: "B+" },
  appliedTemplate: "2026/khoury/computer_science_bscs_(boston)#sample1",
};

test("share › every shareable field survives a full round-trip", async () => {
  const decoded = await decodePlan(await encodePlan(fullPlan));
  for (const field of PLAN_FIELDS) {
    if (field.share == null) continue; // handled by the privacy test below
    assert.deepEqual(
      decoded[field.name], fullPlan[field.name],
      `${field.name} did not round-trip through a share link`,
    );
  }
});

test("share › unshared fields (grades, appliedTemplate) never appear in the payload", async () => {
  const decoded = await decodePlan(await encodePlan(fullPlan));
  assert.equal(decoded.grades, undefined);
  assert.equal(decoded.appliedTemplate, undefined);
  // Belt and suspenders: no grade symbol shape survives under any key.
  const asText = JSON.stringify(decoded);
  assert.ok(!asText.includes('"A"'));
  assert.ok(!asText.includes('"B+"'));
});

test("share › specialTermPl inner fields round-trip through compaction", async () => {
  const decoded = await decodePlan(await encodePlan(fullPlan));
  assert.deepEqual(decoded.specialTermPl.inst1, fullPlan.specialTermPl.inst1);
});

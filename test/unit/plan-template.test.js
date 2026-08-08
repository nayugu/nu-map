// UNIT · can this plan be loaded, and which variant?
//
// The expensive mistake here is one-directional. Deciding a canvas is empty
// when it is not applies a plan on top of a student's work; deciding it is
// occupied when it is not costs one extra click. So every ambiguous case must
// resolve to "occupied", and the tests below try to sneak an occupied canvas
// past the check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isPlanEmpty, variantsFor, templateYears, describeTemplate, sampleplanOffer,
} from "../../src/core/planTemplate.js";
import { applySamplePlan } from "../../src/core/applySamplePlan.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const EMPTY = { placements: {}, reservations: {}, specialTermPl: {}, placedOut: new Set() };

// ═══════════════════════════════════════════════════════════════════
// isPlanEmpty — every store that can hold a decision
// ═══════════════════════════════════════════════════════════════════

test("a canvas with nothing on it is empty", () => {
  assert.equal(isPlanEmpty(EMPTY), true);
  assert.equal(isPlanEmpty({}), true, "absent stores are empty");
  assert.equal(isPlanEmpty(), true, "no argument at all");
});

test("ANY store holding something makes it occupied", () => {
  // Each of these on its own. A canvas holding only co-op blocks, or only
  // reservations from a previous load, is not empty — and treating it as empty
  // would apply a plan on top of a plan.
  const cases = [
    ["placements",    { ...EMPTY, placements: { CS3000: "fall2026" } }],
    ["reservations",  { ...EMPTY, reservations: { "~res:a": { id: "~res:a", semId: "fall2026" } } }],
    ["specialTermPl", { ...EMPTY, specialTermPl: { "coop-1": { typeId: "coop", semId: "spr2027" } } }],
    ["placedOut",     { ...EMPTY, placedOut: new Set(["CS3000"]) }],
  ];
  for (const [name, state] of cases) {
    assert.equal(isPlanEmpty(state), false, `${name} alone should occupy the canvas`);
  }
});

test("a placedOut arriving as an ARRAY still occupies", () => {
  // It is a Set in the running app and an array in persisted JSON. Reading
  // `.size` on the array would give undefined and quietly report empty.
  assert.equal(isPlanEmpty({ ...EMPTY, placedOut: ["CS3000"] }), false,
    "a persisted placedOut was read as empty");
  assert.equal(isPlanEmpty({ ...EMPTY, placedOut: [] }), true);
});

test("cosmetic state does NOT occupy the canvas", () => {
  // Ordering is cosmetic, and a grade cannot exist without its placement.
  // Counting either would make a canvas permanently un-loadable after a stray
  // interaction.
  assert.equal(isPlanEmpty({ ...EMPTY, semOrders: { fall2026: [] } }), true);
  assert.equal(isPlanEmpty({ ...EMPTY, grades: {} }), true);
});

test("nulls and junk resolve to empty rather than throwing", () => {
  for (const bad of [
    { placements: null, reservations: null, specialTermPl: null, placedOut: null },
    { placements: undefined },
    { placedOut: undefined },
  ]) {
    assert.doesNotThrow(() => isPlanEmpty(bad), JSON.stringify(bad));
    assert.equal(isPlanEmpty(bad), true);
  }
});

// ═══════════════════════════════════════════════════════════════════
// variantsFor — narrow by length, never to nothing
// ═══════════════════════════════════════════════════════════════════

const P = (n, label = `${n}yr`) => ({ label, years: Array.from({ length: n }, () => ({ terms: [] })) });

test("counts years from the plan's own shape, not its label", () => {
  assert.equal(templateYears(P(4, "Six Years, Nine Co-ops")), 4);
  assert.equal(templateYears({}), 0);
  assert.equal(templateYears(null), 0);
});

test("a single variant is returned whatever the cohort says", () => {
  const only = [P(5)];
  assert.deepEqual(variantsFor(only, { years: 4 }), only, "the only plan was filtered away");
});

test("the student's year count resolves the year axis", () => {
  const plans = [P(4, "four/spring"), P(4, "four/fall"), P(5, "five/spring"), P(5, "five/fall")];
  const got = variantsFor(plans, { years: 4 });
  assert.equal(got.length, 2, "should leave only the co-op cycle to ask about");
  assert.ok(got.every(p => templateYears(p) === 4));
});

test("when nothing matches, everything is offered", () => {
  // 272 programs publish only a four-year plan; others only a five-, three- or
  // two-year one. A student whose cohort differs should see what exists, with a
  // warning — a planner warns, never blocks.
  const plans = [P(5, "a"), P(5, "b")];
  assert.deepEqual(variantsFor(plans, { years: 4 }), plans, "a mismatched cohort hid every plan");
});

test("no cohort means no filtering", () => {
  const plans = [P(4), P(5)];
  for (const years of [null, undefined, 0]) {
    assert.deepEqual(variantsFor(plans, { years }), plans, `years=${years} filtered anyway`);
  }
});

test("degenerate input returns a usable list", () => {
  assert.deepEqual(variantsFor(null, { years: 4 }), []);
  assert.deepEqual(variantsFor([], { years: 4 }), []);
  assert.deepEqual(variantsFor([null, undefined], { years: 4 }), []);
  assert.equal(variantsFor([P(4), null], { years: 4 }).length, 1, "a hole was counted as a variant");
});

test("filtering never invents, reorders or duplicates", () => {
  const plans = [P(4, "a"), P(5, "b"), P(4, "c")];
  const got = variantsFor(plans, { years: 4 });
  assert.deepEqual(got.map(p => p.label), ["a", "c"], "order or contents changed");
  for (const p of got) assert.ok(plans.includes(p), "a variant was rebuilt rather than passed through");
});

// ═══════════════════════════════════════════════════════════════════
// sampleplanOffer — the four questions, kept apart
// ═══════════════════════════════════════════════════════════════════

const OFFERABLE = { major: "cs", hasSamplePlan: true, canvasEmpty: true };

test("an empty canvas with a plan available offers Load", () => {
  const got = sampleplanOffer(OFFERABLE);
  assert.equal(got.show, true);
  assert.equal(got.state, "load");
  assert.deepEqual(got.verbs, ["load"]);
});

test("an occupied canvas leads with the SAFE verb, never a bare Load", () => {
  const got = sampleplanOffer({ ...OFFERABLE, canvasEmpty: false });
  assert.equal(got.state, "occupied");
  assert.equal(got.verbs[0], "new", "the destructive verb led");
  assert.ok(got.verbs.includes("replace"));
  assert.ok(!got.verbs.includes("load"), "would have overwritten a canvas without saying so");
});

test("ALREADY LOADED is a state, not a disappearance", () => {
  // Hiding the control once the plan is loaded makes it blink in and out, and
  // throws away the one thing worth saying: which plan this canvas came from.
  // A student otherwise has no way to see that and no route back to switch
  // variant.
  const applied = { programKey: "cs", planLabel: "Four Years, Two Co-ops" };
  const got = sampleplanOffer({ ...OFFERABLE, canvasEmpty: false, appliedTemplate: applied });
  assert.equal(got.show, true, "the control vanished once its plan was loaded");
  assert.equal(got.state, "loaded");
  assert.equal(got.reason, "already-applied");
  assert.ok(got.verbs.length, "no way back to switch variant");
});

test("THE STALE-MAJOR TRAP: changing major returns it to an actionable state", () => {
  const applied = { programKey: "cs", planLabel: "Four Years, Two Co-ops" };
  const afterSwitch = sampleplanOffer({
    ...OFFERABLE, major: "biology", canvasEmpty: false, appliedTemplate: applied,
  });
  assert.equal(afterSwitch.state, "occupied", "the stale plan was left with no way out");
  assert.ok(afterSwitch.verbs.includes("replace"));
});

test("a true double major is hidden entirely", () => {
  // 28 SH of free electives cannot absorb a second major's 40-60, and no
  // department publishes a plan for one. Suppressed rather than explained.
  for (const canvasEmpty of [true, false]) {
    const got = sampleplanOffer({ ...OFFERABLE, major2: "biology", canvasEmpty });
    assert.equal(got.show, false, `shown for a double major (empty=${canvasEmpty})`);
    assert.equal(got.state, "hidden");
    assert.equal(got.reason, "double-major");
    assert.deepEqual(got.verbs, []);
  }
});

test("a COMBINED major is one program and is unaffected", () => {
  // 269 of the 349 plan-shipping programs are combined ("X and Y"). They are a
  // single program with a single plan and major2 is empty, so the double-major
  // suppression must not touch them.
  const got = sampleplanOffer({ ...OFFERABLE, major: "computer_science_and_mathematics_bs" });
  assert.equal(got.show, true, "hid a combined major, which is the main audience");
});

test("only cases with nothing true to say are hidden", () => {
  // 632 of 1,017 programs publish no plan — a permanently present "none
  // available" row would be chrome that never does anything.
  assert.equal(sampleplanOffer({ ...OFFERABLE, major: "" }).reason, "no-program");
  assert.equal(sampleplanOffer({ ...OFFERABLE, hasSamplePlan: false }).reason, "no-sample-plan");
  assert.equal(sampleplanOffer({ ...OFFERABLE, hasSamplePlan: false }).show, false);
});

test("hidden order is stable — a double major with no plan reports one reason", () => {
  const got = sampleplanOffer({ major: "cs", major2: "bio", hasSamplePlan: false, canvasEmpty: true });
  assert.equal(got.show, false);
  assert.equal(got.reason, "double-major", "reason order changed");
});

test("degenerate input is hidden, never a broken state", () => {
  for (const bad of [undefined, {}, { major: null }, { major: "cs" }]) {
    const got = sampleplanOffer(bad);
    assert.equal(got.show, false, JSON.stringify(bad));
    assert.equal(got.state, "hidden");
    assert.deepEqual(got.verbs, []);
  }
});

test("an appliedTemplate for a DIFFERENT program is not 'loaded'", () => {
  for (const applied of [null, undefined, {}, { programKey: "" }, { programKey: "other" }]) {
    const got = sampleplanOffer({ ...OFFERABLE, appliedTemplate: applied });
    assert.equal(got.show, true, `hidden by ${JSON.stringify(applied)}`);
    assert.notEqual(got.state, "loaded", `read as loaded from ${JSON.stringify(applied)}`);
  }
});

test("every state is one of the four, and only 'hidden' renders nothing", () => {
  const inputs = [
    {}, OFFERABLE,
    { ...OFFERABLE, canvasEmpty: false },
    { ...OFFERABLE, appliedTemplate: { programKey: "cs" }, canvasEmpty: false },
    { ...OFFERABLE, major2: "bio" },
    { ...OFFERABLE, hasSamplePlan: false },
  ];
  for (const i of inputs) {
    const got = sampleplanOffer(i);
    assert.ok(["hidden", "load", "loaded", "occupied"].includes(got.state), `unknown state ${got.state}`);
    assert.equal(got.show, got.state !== "hidden", `show disagrees with state ${got.state}`);
  }
});

// ═══════════════════════════════════════════════════════════════════
// describeTemplate — the numbers on the checkbox must be the truth
// ═══════════════════════════════════════════════════════════════════

const SEMESTERS = [
  { id: "incoming", semTypeId: "incoming", type: "special" },
  ...[2026, 2027, 2028, 2029, 2030].flatMap(y => [
    { id: `fall${y}`,     semTypeId: "fall",   type: "fall",   weight: 1 },
    { id: `spr${y + 1}`,  semTypeId: "spring", type: "spring", weight: 1 },
    { id: `sumA${y + 1}`, semTypeId: "sumA",   type: "summer", weight: 0.5 },
    { id: `sumB${y + 1}`, semTypeId: "sumB",   type: "summer", weight: 0.5 },
  ]),
];

function aRealPlan() {
  const base = join(ROOT, "src/data/majors/2026");
  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs) {
      const f = join(base, college, prog, "plan.json");
      if (!existsSync(f)) continue;
      const grid = JSON.parse(readFileSync(f, "utf8"));
      if (grid.plans?.[0]?.years?.length >= 4) return { prog, plan: grid.plans[0] };
    }
  }
  return null;
}

test("REAL: the counts on the checkbox are what applying actually produces", () => {
  // The whole point of describing by applying: the number the student is shown
  // cannot describe something other than what happens. Checked across many
  // programs, not one.
  const courseMap = new Proxy({}, { get: (_, k) => ({ id: String(k), sh: 4 }), has: () => true });
  const ctx = { semesters: SEMESTERS, courseMap };
  const base = join(ROOT, "src/data/majors/2026");
  let checked = 0, sawPlaceholders = 0;

  for (const college of readdirSync(base)) {
    let progs = [];
    try { progs = readdirSync(join(base, college)); } catch { continue; }
    for (const prog of progs.slice(0, 20)) {
      const f = join(base, college, prog, "plan.json");
      if (!existsSync(f)) continue;
      for (const plan of (JSON.parse(readFileSync(f, "utf8")).plans ?? []).slice(0, 2)) {
        const described = describeTemplate(plan, ctx);
        const applied = applySamplePlan(plan, ctx);
        assert.equal(described.courses, applied.placed.length, `${prog}: course count differs`);
        assert.equal(described.placeholders, applied.reserved.length, `${prog}: placeholder count differs`);
        assert.equal(described.coops, applied.coops.length, `${prog}: co-op count differs`);
        checked += 1;
        if (described.placeholders > 0) sawPlaceholders += 1;
      }
    }
  }
  assert.ok(checked > 60, `only ${checked} plans described`);
  assert.ok(sawPlaceholders > checked * 0.7,
    `only ${sawPlaceholders}/${checked} plans reserved anything — half of one should`);
});

test("REAL: describing twice gives the same answer and changes nothing", () => {
  const found = aRealPlan();
  const courseMap = new Proxy({}, { get: (_, k) => ({ id: String(k), sh: 4 }), has: () => true });
  const ctx = { semesters: SEMESTERS, courseMap, placements: {}, reservations: {} };
  const a = describeTemplate(found.plan, ctx);
  const b = describeTemplate(found.plan, ctx);
  assert.deepEqual(a, b, "describing a template is not repeatable");
  assert.deepEqual(ctx.placements, {}, "describing mutated the caller's placements");
  assert.deepEqual(ctx.reservations, {}, "describing mutated the caller's reservations");
});

test("describing nothing is zero, not a crash", () => {
  assert.deepEqual(describeTemplate(null), { courses: 0, placeholders: 0, coops: 0 });
  assert.doesNotThrow(() => describeTemplate({ years: [] }, {}));
});

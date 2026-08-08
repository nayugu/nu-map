// UNIT · can an undecided card clear another course's prereq warning?
//
// Only when EVERY option it could become satisfies that prerequisite. The tests
// below try to get a warning cleared on a plan where some later choice would
// make the clearing wrong — an AND that each option only half-satisfies, a card
// sitting after the course it would feed, a phantom option, too many cards to
// decide about.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { satisfiedUnderEveryOption } from "../../src/core/reservationPrereqs.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const raw = JSON.parse(readFileSync(join(ROOT, "public/northeastern/catalog-courses.json"), "utf8"));
const CATALOG = {};
for (const c of raw) CATALOG[`${c.subject}${parseInt(c.number, 10)}`] = c;

const SEM_INDEX = {
  fall2026: 0, spr2027: 1, fall2027: 2, spr2028: 3, fall2028: 4, spr2029: 5, fall2029: 6,
};
const P = (subject, number) => ({ subject, number, minGrade: "D-" });
const res = (id, semId, options) => ({ id, semId, label: "x", sh: 4, options });

const ctx = (reservations, placements = {}) => ({
  reservations, placements, semIndex: SEM_INDEX, courseMap: CATALOG,
});

// ── The real case ──────────────────────────────────────────────────

test("REAL: IE 4516's warning clears, because both options satisfy it", () => {
  const ie4516 = CATALOG.IE4516;
  assert.ok(ie4516, "catalog no longer has IE 4516");
  const names = new Set(ie4516.prereqs.filter(t => t?.subject).map(t => `${t.subject}${parseInt(t.number, 10)}`));
  assert.ok(names.has("IE3412") && names.has("MATH3081"),
    "catalog changed: IE 4516 no longer requires IE 3412 or MATH 3081");

  const r = { "~res:a": res("~res:a", "spr2028", [["IE3412"], ["MATH3081"]]) };
  const got = satisfiedUnderEveryOption(ie4516, SEM_INDEX.spr2029, ctx(r));
  assert.equal(got, true, "the plan's own card should clear this warning");
});

test("REAL: with no card in the plan there is no opinion", () => {
  const got = satisfiedUnderEveryOption(CATALOG.IE4516, SEM_INDEX.spr2029, ctx({}));
  assert.equal(got, null, "should abstain rather than clear");
});

// ── The case that must NOT clear ───────────────────────────────────

test("an AND that each option only half-satisfies keeps the warning", () => {
  // "AAA1000 And BBB1000" against a card that is one or the other.
  const course = { prereqs: [P("AAA", "1000"), "And", P("BBB", "1000")] };
  const map = { AAA1000: {}, BBB1000: {} };
  const r = { "~res:a": res("~res:a", "spr2028", [["AAA1000"], ["BBB1000"]]) };
  const got = satisfiedUnderEveryOption(course, SEM_INDEX.spr2029,
    { ...ctx(r), courseMap: map });
  assert.equal(got, false, "cleared a warning that either choice would leave standing");
});

test("mentioning is not satisfying — the tree is evaluated, not scanned", () => {
  // Both options appear in the expression, which is what the EDGE rule tests.
  // Satisfaction is stricter and must disagree here.
  const course = { prereqs: [P("AAA", "1000"), "And", P("BBB", "1000")] };
  const map = { AAA1000: {}, BBB1000: {} };
  const r = { "~res:a": res("~res:a", "spr2028", [["AAA1000"], ["BBB1000"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2029, { ...ctx(r), courseMap: map }), false);
});

test("only ONE option satisfying is not enough", () => {
  const course = { prereqs: [P("AAA", "1000")] };
  const map = { AAA1000: {}, BBB1000: {} };
  const r = { "~res:a": res("~res:a", "spr2028", [["AAA1000"], ["BBB1000"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2029, { ...ctx(r), courseMap: map }), false);
});

// ── Ordering ───────────────────────────────────────────────────────

test("a card sitting AFTER the course satisfies nothing", () => {
  const course = { prereqs: [P("AAA", "1000"), "Or", P("BBB", "1000")] };
  const map = { AAA1000: {}, BBB1000: {} };
  const late = { "~res:a": res("~res:a", "fall2029", [["AAA1000"], ["BBB1000"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(late), courseMap: map }), false,
    "a later card cleared an earlier course's warning");

  const early = { "~res:a": res("~res:a", "fall2026", [["AAA1000"], ["BBB1000"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(early), courseMap: map }), true);
});

test("a card in the SAME semester does not satisfy a non-concurrent prereq", () => {
  const course = { prereqs: [P("AAA", "1000"), "Or", P("BBB", "1000")] };
  const map = { AAA1000: {}, BBB1000: {} };
  const same = { "~res:a": res("~res:a", "spr2027", [["AAA1000"], ["BBB1000"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(same), courseMap: map }), false);
});

// ── Real placements are never disturbed ────────────────────────────

test("a virtual option never overrides where a course really sits", () => {
  // AAA1000 is genuinely placed late, so the prereq is genuinely out of order.
  // The card must not "re-place" it earlier and clear the warning.
  const course = { prereqs: [P("AAA", "1000")] };
  const map = { AAA1000: {} };
  const r = { "~res:a": res("~res:a", "fall2026", [["AAA1000"]]) };
  const placements = { AAA1000: "fall2029" };
  const got = satisfiedUnderEveryOption(course, SEM_INDEX.spr2027,
    { ...ctx(r, placements), courseMap: map });
  assert.equal(got, false, "a virtual placement moved a real course");
});

// ── Groups ─────────────────────────────────────────────────────────

test("a compound option supplies all of its courses at once", () => {
  const course = { prereqs: [P("PT", "5410"), "And", P("PT", "5411")] };
  const map = { PSYC3200: {}, PT5410: {}, PT5411: {} };
  // Only one option, and it supplies both halves.
  const r = { "~res:a": res("~res:a", "fall2026", [["PT5410", "PT5411"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(r), courseMap: map }), true);

  // Add an option that supplies neither: no longer true under every choice.
  const r2 = { "~res:a": res("~res:a", "fall2026", [["PT5410", "PT5411"], ["PSYC3200"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(r2), courseMap: map }), false);
});

test("a group naming a course we do not have is dropped, not counted", () => {
  const course = { prereqs: [P("AAA", "1000")] };
  const map = { AAA1000: {} };
  const r = { "~res:a": res("~res:a", "fall2026", [["AAA1000"], ["GONE9999"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(r), courseMap: map }), true,
    "a phantom option should not veto a real guarantee");
});

test("a card whose every option is phantom has no bearing", () => {
  const course = { prereqs: [P("AAA", "1000")] };
  const map = { AAA1000: {} };
  const r = { "~res:a": res("~res:a", "fall2026", [["GONE1"], ["GONE2"]]) };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(r), courseMap: map }), null);
});

// ── Several cards at once ──────────────────────────────────────────

test("two cards must BOTH work out, under every combination", () => {
  const course = { prereqs: [P("AAA", "1000"), "And", P("BBB", "1000")] };
  const map = { AAA1000: {}, BBB1000: {}, CCC1000: {} };
  const both = {
    "~res:a": res("~res:a", "fall2026", [["AAA1000"]]),
    "~res:b": res("~res:b", "fall2026", [["BBB1000"]]),
  };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(both), courseMap: map }), true);

  // One card might become something useless → not guaranteed.
  const risky = {
    "~res:a": res("~res:a", "fall2026", [["AAA1000"]]),
    "~res:b": res("~res:b", "fall2026", [["BBB1000"], ["CCC1000"]]),
  };
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(risky), courseMap: map }), false);
});

test("too many combinations means no opinion, not a guess", () => {
  const course = { prereqs: [P("AAA", "1000"), "Or", P("BBB", "1000")] };
  const map = { AAA1000: {}, BBB1000: {} };
  const many = {};
  for (let i = 0; i < 10; i++) {                       // 2^10 = 1024 worlds
    many[`~res:${i}`] = res(`~res:${i}`, "fall2026", [["AAA1000"], ["BBB1000"]]);
  }
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(many), courseMap: map }), null,
    "should abstain rather than explore an unbounded product");
});

test("the bound is on RELEVANT cards only — unrelated ones cost nothing", () => {
  const course = { prereqs: [P("AAA", "1000")] };
  const map = { AAA1000: {}, ZZZ1000: {} };
  const noise = { "~res:a": res("~res:a", "fall2026", [["AAA1000"]]) };
  for (let i = 0; i < 40; i++) {
    noise[`~res:n${i}`] = res(`~res:n${i}`, "fall2026", [["ZZZ1000"]]);
  }
  assert.equal(satisfiedUnderEveryOption(course, SEM_INDEX.spr2027, { ...ctx(noise), courseMap: map }), true,
    "irrelevant cards were counted toward the bound");
});

// ── Abstaining ─────────────────────────────────────────────────────

test("no relevant card, no prereqs, or an unnamed card: no opinion", () => {
  const map = { AAA1000: {}, ZZZ1000: {} };
  const course = { prereqs: [P("AAA", "1000")] };
  assert.equal(satisfiedUnderEveryOption({ prereqs: [] }, 1, ctx({})), null, "no prereqs");
  assert.equal(satisfiedUnderEveryOption({}, 1, ctx({})), null, "no prereq field");
  assert.equal(satisfiedUnderEveryOption(null, 1, ctx({})), null, "no course");
  const unnamed = { "~res:a": { id: "~res:a", semId: "fall2026", label: "Khoury Elective" } };
  assert.equal(satisfiedUnderEveryOption(course, 1, { ...ctx(unnamed), courseMap: map }), null,
    "an unnamed card should have no bearing");
  const unrelated = { "~res:a": res("~res:a", "fall2026", [["ZZZ1000"]]) };
  assert.equal(satisfiedUnderEveryOption(course, 1, { ...ctx(unrelated), courseMap: map }), null);
});

test("degenerate input does not throw", () => {
  const course = { prereqs: [P("AAA", "1000")] };
  assert.doesNotThrow(() => satisfiedUnderEveryOption(course, 1));
  assert.doesNotThrow(() => satisfiedUnderEveryOption(course, 1, {}));
  for (const r of [null, undefined, {}, { x: null }, { x: {} }, { x: { semId: "fall2026" } }]) {
    assert.doesNotThrow(() => satisfiedUnderEveryOption(course, 1, ctx(r)), JSON.stringify(r));
  }
  for (const options of [null, [], [[]], [null], ["x"], [["AAA1000"], null]]) {
    assert.doesNotThrow(
      () => satisfiedUnderEveryOption(course, 1, ctx({ a: res("a", "fall2026", options) })),
      JSON.stringify(options));
  }
});

// ═══════════════════════════════════════════════════════════════════
// UNIT: the verification ratchet, and the edition it could not see
//
// `compareToBaseline` keys everything on a program id, and an id carries the
// catalog edition — `undergraduate/2026/engineering/computer_engineering_bs`.
// So on the first scrape of a new edition every id was unknown, `!base` skipped
// the level check and all seven counters, and the ratchet was inert for the one
// run in which the parser meets markup nobody has seen. NEU rolled to the 2027
// edition on 2026-09-01, which makes that run the next majors run.
//
// These pin both halves: the ratchet still ratchets within an edition, and it
// no longer goes quiet across one.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareToBaseline } from "../../scripts/verify-majors.js";

const program = (id, level, counters = {}) => ({ id, level, counters });

const BASE = {
  programs: {
    "undergraduate/2026/engineering/computer_engineering_bs": {
      level: "verified", counters: { unknownCourses: 0, tablesUnaccounted: 1 },
    },
    "undergraduate/2025/engineering/computer_engineering_bs": {
      level: "review", counters: { unknownCourses: 9 },
    },
    "graduate/2026/science/biology_ms": { level: "partial", counters: {} },
  },
};

test("within an edition: a level that got worse is a regression", () => {
  const out = compareToBaseline(
    [program("undergraduate/2026/engineering/computer_engineering_bs", "partial")], BASE);
  assert.equal(out.length, 1);
  assert.match(out[0], /level verified → partial/);
});

test("within an edition: a counter that grew is a regression, one per counter", () => {
  const out = compareToBaseline([
    program("undergraduate/2026/engineering/computer_engineering_bs", "verified",
      { unknownCourses: 3, tablesUnaccounted: 4 }),
  ], BASE);
  assert.equal(out.length, 2);
  assert.ok(out.some(r => /unknownCourses 0 → 3/.test(r)));
  assert.ok(out.some(r => /tablesUnaccounted 1 → 4/.test(r)));
});

test("within an edition: improving is never a regression", () => {
  const out = compareToBaseline([
    program("undergraduate/2026/engineering/computer_engineering_bs", "verified",
      { unknownCourses: 0, tablesUnaccounted: 0 }),
    program("graduate/2026/science/biology_ms", "verified"),
  ], BASE);
  assert.deepEqual(out, []);
});

// ── The edition roll ────────────────────────────────────────────────
test("across an edition: a program that got worse is still caught", () => {
  const out = compareToBaseline(
    [program("undergraduate/2027/engineering/computer_engineering_bs", "review",
      { unknownCourses: 12 })], BASE);
  assert.equal(out.length, 2, `expected level + counter, got: ${out.join(" | ")}`);
  assert.ok(out.every(r => r.includes("(vs undergraduate/2026/engineering/computer_engineering_bs)")),
    "the reader must be told which edition it was compared against");
});

test("across an edition: an unchanged program raises nothing", () => {
  const out = compareToBaseline(
    [program("undergraduate/2027/engineering/computer_engineering_bs", "verified",
      { unknownCourses: 0, tablesUnaccounted: 1 })], BASE);
  assert.deepEqual(out, []);
});

test("across an edition: the NEWEST earlier edition is the one compared against", () => {
  // 2025 has this program at `review` with 9 unknown courses and 2026 has it
  // clean. Comparing against the older, worse entry would let a real
  // regression through as an improvement.
  const out = compareToBaseline(
    [program("undergraduate/2027/engineering/computer_engineering_bs", "partial",
      { unknownCourses: 5 })], BASE);
  assert.ok(out.length >= 1, "2026 is the baseline to beat, not 2025");
  assert.ok(out.every(r => r.includes("(vs undergraduate/2026/")));
});

test("a genuinely new program is only flagged when it lands at review", () => {
  assert.deepEqual(
    compareToBaseline([program("undergraduate/2027/engineering/brand_new_bs", "verified")], BASE),
    []);
  assert.equal(
    compareToBaseline([program("undergraduate/2027/engineering/brand_new_bs", "review")], BASE).length,
    1);
});

test("the same folder in a different tree is a different program", () => {
  // `graduate/2027/science/biology_ms` must not be compared against
  // `undergraduate/…/biology_ms`, and a college move is treated as new rather
  // than guessed at.
  const out = compareToBaseline(
    [program("undergraduate/2027/science/biology_ms", "review")], BASE);
  assert.equal(out.length, 1);
  assert.match(out[0], /NEW program at 'review'/,
    "a program that changed tree is new, not a cross-edition match");
});

test("an id without an edition segment does not crash the ratchet", () => {
  assert.doesNotThrow(() => compareToBaseline([program("weird-id-with-no-year", "verified")], BASE));
  assert.doesNotThrow(() => compareToBaseline([program("undergraduate/2027/x/y", "verified")], {}));
  assert.doesNotThrow(() => compareToBaseline([program("undergraduate/2027/x/y", "verified")], { programs: null }));
});

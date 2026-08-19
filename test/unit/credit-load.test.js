// ═══════════════════════════════════════════════════════════════════
// One credit-load verdict, shared by every surface that draws it.
//
// Four surfaces drew this fact and each had its own rule: the planner's fall/spring row
// compared to the cap, its SUMMER row hard-coded green and never compared at all, the preview
// and the walkthrough drew flat grey, and MCP gated on `weight === 1` so a summer half could
// never report an overload. The same 30 SH summer was therefore green, grey and clean at once.
//
// So these tests attack the boundary and the states that must not both fire, plus the junk a
// caller can pass — not the happy path, which was never what broke.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadState, isOverCap, LOAD_OVER, LOAD_UNDER, LOAD_OK }
  from "../../src/core/creditLoad.js";

const UG   = { cap: 19, min: 12 };
const GRAD = { cap: 16, min: 8 };

test("load › the cap boundary is not off by one", () => {
  // AT the cap is legal: 19 SH needs no petition.
  assert.equal(loadState(19, UG), LOAD_OK);
  assert.equal(loadState(16, GRAD), LOAD_OK);
  assert.equal(loadState(20, UG), LOAD_OVER);
  assert.equal(loadState(17, GRAD), LOAD_OVER);
  assert.equal(loadState(19.5, UG), LOAD_OVER);
});

test("load › the graduate cap is LOWER, not higher", () => {
  // These get transposed in conversation constantly, so the direction is pinned here: 17 SH
  // is an overload for a graduate student and ordinary for an undergraduate.
  assert.equal(loadState(17, GRAD), LOAD_OVER);
  assert.equal(loadState(17, UG), LOAD_OK);
});

test("load › the full-time minimum, where one is expected", () => {
  assert.equal(loadState(8, UG), LOAD_UNDER);
  // AT the minimum is full time.
  assert.equal(loadState(12, UG), LOAD_OK);
  // Summer passes no minimum: a 4 SH summer is a normal thing to plan, not a part-time term.
  assert.equal(loadState(4, { cap: 19 }), LOAD_OK);
  assert.equal(loadState(4, { cap: 19, min: 0 }), LOAD_OK);
});

test("load › an empty term is unplanned, not part-time", () => {
  // The grid says "empty" by being empty. Reporting it as underloaded would put a warning on
  // every term the student has not filled in yet.
  assert.equal(loadState(0, UG), LOAD_OK);
  assert.equal(loadState(0, { cap: 0, min: 12 }), LOAD_OK);
});

test("load › OVER wins when a degenerate cap makes both nominally true", () => {
  // Decided on purpose rather than falling out of whichever branch happens to be written
  // first — a cap below the minimum is nonsense, but it must resolve the same way every time.
  assert.equal(loadState(10, { cap: 5, min: 12 }), LOAD_OVER);
});

test("load › junk in never invents an overload", () => {
  // A missing cap means "no cap", which is what an institution adapter without one supplies.
  assert.equal(loadState(99, {}), LOAD_OK);
  assert.equal(loadState(99), LOAD_OK);
  // Every one of these compares false against a number, and the guard must land on OK rather
  // than mark a term or throw inside a render.
  for (const bad of [-4, NaN, undefined, null, "20", {}]) {
    assert.equal(loadState(bad, UG), LOAD_OK, `load ${String(bad)}`);
  }
  // A NaN cap arrives when a port returns nothing and the caller does arithmetic on it.
  assert.equal(loadState(20, { cap: NaN }), LOAD_OK);
});

test("load › isOverCap agrees with loadState exactly", () => {
  for (const [sh, cap] of [[19, 19], [20, 19], [0, 19], [16, 16], [17, 16], [4, 19]]) {
    assert.equal(isOverCap(sh, cap), loadState(sh, { cap }) === LOAD_OVER,
      `${sh} against ${cap}`);
  }
});

test("load › summer fails COMBINED where each half passes", () => {
  // The case that slipped through every surface at once. Summer is capped as a whole, so the
  // caller sums both halves and passes the ordinary cap; judging each half alone passed both.
  const halfA = 12, halfB = 12;
  assert.equal(isOverCap(halfA, 19), false);
  assert.equal(isOverCap(halfB, 19), false);
  assert.equal(isOverCap(halfA + halfB, 19), true);
  // And a summer that is genuinely light stays quiet.
  assert.equal(isOverCap(4 + 4, 19), false);
});

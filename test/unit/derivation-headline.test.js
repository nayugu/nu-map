// ═══════════════════════════════════════════════════════════════════
// Which reason the walkthrough LEADS with.
//
// The blue panel used to headline whichever key separated the front card from the runner-up.
// That is the correct answer to "why is it first in the queue" and often a terrible answer to
// "why does it deserve this slot", because three of the six keys state an ABSENCE:
//
//     filler   it is not an open elective
//     claim.2  it names a course, rather than being a choice still to make
//     tie      nothing tells it apart from the others
//
// So `headlineWhy` picks the strongest thing the course CLAIMS, and returns null when it claims
// nothing — at which point the caller falls back to the mechanical key rather than inventing a
// reason. These tests pin that, and pin that the ranking is NOT the comparator's order.
// ═══════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import { headlineWhy, ORDER_KEYS } from "../../src/core/derivation/steps.js";

const w = (key, value, beat = 1) => ({ key, value, beat });

test("headline › a claim about the degree outranks everything else", () => {
  // Comparator order is filler, claim, terms, options, depth. `depth` runs LAST there and still
  // must not beat a claim here, because these rank by what a fact explains.
  const whys = [w("filler"), w("claim", 0), w("terms", 3), w("options", 2), w("depth", 12)];
  assert.equal(headlineWhy(whys).key, "claim");
  assert.equal(headlineWhy(whys).value, 0);
});

test("headline › scarcity of semesters beats chain length, which beats option count", () => {
  assert.equal(headlineWhy([w("depth", 12), w("terms", 2)]).key, "terms");
  assert.equal(headlineWhy([w("options", 1), w("depth", 12)]).key, "depth");
  assert.equal(headlineWhy([w("options", 1), w("terms", 2)]).key, "terms");
});

test("headline › the three absence keys are never the headline", () => {
  // Each alone, and all three together: there is nothing here a slot is deserved for.
  for (const whys of [[w("filler")], [w("tie", undefined, 4)], [w("claim", 2)],
                      [w("filler"), w("claim", 2), w("tie", undefined, 4)]]) {
    assert.equal(headlineWhy(whys), null,
      `${whys.map(x => `${x.key}.${x.value}`).join()} should not headline`);
  }
});

test("headline › claim.2 is bookkeeping, claim.0 and claim.1 are not", () => {
  // Same key, three different statements — the split is the whole point.
  assert.equal(headlineWhy([w("claim", 0)]).value, 0);
  assert.equal(headlineWhy([w("claim", 1)]).value, 1);
  assert.equal(headlineWhy([w("claim", 2)]), null);
  // A missing value must be treated as the bookkeeping case, not silently promoted.
  assert.equal(headlineWhy([w("claim", undefined)]), null);
});

test("headline › a real claim still wins when an absence key decided the queue", () => {
  // The case the redesign exists for: `filler` separated it from the runner-up, so the old panel
  // led with "it is not an open elective" while the course had twelve dependents to talk about.
  const whys = [w("filler", undefined, 9), w("depth", 12, 2)];
  assert.equal(headlineWhy(whys).key, "depth");
});

test("headline › junk in returns null rather than throwing inside a render", () => {
  for (const bad of [null, undefined, [], [null], [{}], [{ key: "nope" }], ["filler"]]) {
    assert.equal(headlineWhy(bad), null, `${JSON.stringify(bad)}`);
  }
});

test("headline › every comparator key is either a headline or an absence, none unclassified", () => {
  // Guards the pair against drift: if a sixth test is added to the comparator, this fails until
  // someone decides which side of the line it falls on, rather than it silently never leading.
  const ABSENCE = new Set(["filler", "tie"]);
  for (const key of ORDER_KEYS) {
    const led = headlineWhy([w(key, key === "claim" ? 0 : 1)]) !== null;
    assert.equal(led, !ABSENCE.has(key),
      `${key} is neither classified as a headline nor as an absence`);
  }
});

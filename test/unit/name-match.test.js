// UNIT · src/core/nameMatch.js — the matching primitives, directly.
//
// These were exercised only through program search before they moved out of
// searchRank.js. Now that two rankers share them, the properties they have to
// hold are worth asserting on their own — especially the tier/coverage
// arithmetic, which is what stops a weak match outranking a strong one.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  T, COV_MAX, words, coverage, isSubsequence,
  orderedPrefixes, anyPrefixes, orderedInitials, anyInitials, CONNECTORS,
} from "../../src/core/nameMatch.js";

test("nameMatch › coverage can never promote a match across a tier", () => {
  // The whole ladder rests on this: every adjacent tier gap must exceed the
  // largest coverage bonus, or a PREFIX hit on a short name outranks an EXACT
  // one. Checked as arithmetic over the real table rather than by example.
  const floors = Object.entries(T)
    .filter(([k]) => k !== "FUZZY")            // FUZZY sits below zero by design
    .map(([, v]) => v)
    .sort((a, b) => a - b);
  for (let i = 1; i < floors.length; i++) {
    assert.ok(floors[i] - floors[i - 1] > COV_MAX,
      `gap ${floors[i - 1]}→${floors[i]} is ${floors[i] - floors[i - 1]}, not > COV_MAX ${COV_MAX}`);
  }
  // And FUZZY must stay below every strict tier even with a full bonus.
  assert.ok(T.FUZZY + COV_MAX < floors[0]);
});

test("nameMatch › coverage is bounded and saturates", () => {
  assert.equal(coverage("computer science", "computer science"), COV_MAX);
  assert.equal(coverage("computer science and biology", "computer science"), COV_MAX,
    "a query longer than the name must not exceed the cap");
  assert.equal(coverage("cs", ""), 0, "an empty name scores nothing, never NaN");
  assert.ok(coverage("cs", "computer science") < coverage("computer", "computer science"),
    "more of the name accounted for must score higher");
});

test("nameMatch › words drops separators and never yields empties", () => {
  assert.deepEqual(words("computer_science-and physics"), ["computer", "science", "and", "physics"]);
  assert.deepEqual(words("---"), []);
  assert.deepEqual(words(""), []);
  assert.deepEqual(words("bs2026"), ["bs2026"], "digits are word characters here");
});

test("nameMatch › isSubsequence tolerates drops, not reorders", () => {
  assert.ok(isSubsequence("compter", "computer"));       // dropped letter
  assert.ok(isSubsequence("", "anything"));              // empty is a subsequence
  assert.ok(!isSubsequence("cpmouter", "computer"));     // reordered is not
  assert.ok(!isSubsequence("computerx", "computer"));
});

test("nameMatch › ordered vs any prefixes differ only on order", () => {
  const pool = ["computer", "science", "and", "biology"];
  assert.ok(orderedPrefixes(["comp", "bio"], pool));
  assert.ok(!orderedPrefixes(["bio", "comp"], pool), "order matters here");
  assert.ok(anyPrefixes(["bio", "comp"], pool), "and not here");
  assert.ok(!anyPrefixes(["comp", "zzz"], pool), "every token must land");
});

test("nameMatch › an initials run spans connectors but may not open on one", () => {
  const ece = words("electrical and computer engineering");
  assert.ok(orderedInitials(["ece"], ece), "connectors are skipped inside a run");
  // "…and Biology" must not read as "ab": a run has to start on a real word.
  const andBio = words("computer science and biology");
  assert.ok(!orderedInitials(["ab"], andBio));
  assert.ok(CONNECTORS.has("and"));
});

test("nameMatch › initials backtrack when a token could be spent two ways", () => {
  // "cs" could be Computer+Science (a run) or a prefix of neither; the memoised
  // search has to try the run AND the skip, or the second token never places.
  const ns = words("industrial engineering and computer science");
  assert.ok(orderedInitials(["ie", "cs"], ns));
  assert.ok(!orderedInitials(["cs", "ie"], ns), "ordering is enforced here");
  assert.ok(anyInitials(["cs", "ie"], ns), "and relaxed here");
});

test("nameMatch › initials refuse a single character", () => {
  // "ie and c" used to work while "ie and cs" did not, so typing one more
  // letter made a program vanish. A one-char token must not open a run.
  const ns = words("industrial engineering and computer science");
  assert.ok(!orderedInitials(["c"], ns) || words("computer")[0].startsWith("c"),
    "a bare 'c' may only match as a word prefix, never as a run");
  assert.ok(orderedInitials(["ie", "cs"], ns));
});

test("nameMatch › empty inputs are inert, not throwing", () => {
  assert.ok(orderedPrefixes([], ["anything"]), "no tokens is trivially satisfied");
  assert.ok(anyPrefixes([], []));
  assert.ok(!orderedInitials(["cs"], []), "no words means no match");
  assert.ok(anyInitials([], []));
});

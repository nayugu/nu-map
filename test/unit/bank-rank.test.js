// UNIT · the ORDER of the bank's ranking rungs.
//
// ── Why this file exists, and why the browser test was not enough ───
//
// The retired tie-break shipped with two browser tests and they were not
// worthless — they killed "drop the rung entirely" and "turn it into a filter".
// But `mutation-probe.js --only retired:` produced a SURVIVOR: moving
// retirement ABOVE relevance changed nothing any browser test could see.
//
// The reason is worth keeping, because it is a trap that will recur. The
// natural test for "score still wins" is *type a retired course's own code and
// check it comes first* — and that query matches exactly ONE course. There is
// nothing for it to outrank, so the assertion holds under every possible
// comparator. It looked like a rank test and was a presence test.
//
// Rank order between two hits of DIFFERENT score needs two hits with different
// scores AND different retirement, and hunting a real (query, live, retired)
// triple out of the catalog that produces that is far harder than stating the
// case directly. So the comparator moved to `src/core/bankRank.js` and the
// rungs are exercised against each other here.
//
// A SKIP or a vacuous pass is the dangerous outcome, not a failure — every
// assertion below is written so that the wrong comparator makes it fail, and
// `mutation-probe.js --only retired:` is what checks that claim.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { compareBankHits, retiredRank } from "../../src/core/bankRank.js";

/** The bank's real tie-break: A-Z by course code. */
const byCode = (a, b) => a.code.localeCompare(b.code);

const hit = (code, score, retired = false) => ({ c: { code, retired }, score });

/** Sort with the real comparator and return the codes in order. */
const order = (...hits) =>
  hits.slice().sort((a, b) => compareBankHits(a, b, byCode)).map(h => h.c.code);

describe("bankRank › the rungs, in order", () => {
  test("rung 1: relevance beats everything", () => {
    // THE SURVIVOR. Putting retirement above score reverses this, and no
    // browser test could see it. A retired course that matches the query
    // better must still win — typing a retired course's own code is asking
    // for that course, and burying it under every loosely-matching live
    // course is the filter behaviour by another route.
    assert.deepEqual(
      order(hit("ZZ 1000", 1, false), hit("AA 1000", 8, true)),
      ["AA 1000", "ZZ 1000"],
      "a better-scoring RETIRED course was outranked by a weaker LIVE one — " +
      "the retirement rung has been moved above relevance");

    // …and symmetrically, so the assertion is not passing on the tie-break.
    assert.deepEqual(
      order(hit("AA 1000", 1, true), hit("ZZ 1000", 8, false)),
      ["ZZ 1000", "AA 1000"]);
  });

  test("rung 2: at equal relevance, live sorts above retired", () => {
    // The measured defect: 389 retired courses share a subject and title with
    // a live one (NEU renumbers rather than retires), a title query scores
    // both identically, and the old — lower — code won the alphabetical
    // tie-break in 292 of them.
    assert.deepEqual(
      order(hit("ALY 6015", 4, true), hit("ALY 6125", 4, false)),
      ["ALY 6125", "ALY 6015"],
      "the retired twin outranked the live course it was renumbered to");

    // Order of ARGUMENTS must not decide it. A comparator that is right only
    // for one input order is not a comparator.
    assert.deepEqual(
      order(hit("ALY 6125", 4, false), hit("ALY 6015", 4, true)),
      ["ALY 6125", "ALY 6015"]);
  });

  test("rung 3: equal relevance and equal retirement fall to the caller's sort", () => {
    assert.deepEqual(
      order(hit("CS 3000", 4, false), hit("CS 1800", 4, false)),
      ["CS 1800", "CS 3000"]);
    // Two RETIRED courses still order among themselves — the rung sinks them
    // as a group, it does not collapse them into an arbitrary order.
    assert.deepEqual(
      order(hit("CS 3000", 4, true), hit("CS 1800", 4, true)),
      ["CS 1800", "CS 3000"]);
  });

  test("the retired rung never removes a result", () => {
    // A tie-break, not a filter. Three years of archive editions are courses
    // students actually TOOK; one recording CS 2500 from 2023 has to be able
    // to find it. Whatever goes in comes out.
    const hits = [hit("A 1", 4, true), hit("B 2", 9, false), hit("C 3", 4, true), hit("D 4", 1, false)];
    assert.equal(order(...hits).length, 4);
    assert.deepEqual(new Set(order(...hits)), new Set(["A 1", "B 2", "C 3", "D 4"]));
  });
});

describe("bankRank › retiredRank", () => {
  test("live is 0 and retired is 1, so ascending order sinks the retired one", () => {
    // The sign is the whole rung. Flipping it promotes every retired course.
    assert.equal(retiredRank({ retired: false }), 0);
    assert.equal(retiredRank({ retired: true }), 1);
    assert.ok(retiredRank({ retired: false }) < retiredRank({ retired: true }));
  });

  test("a course with no `retired` field is treated as live", () => {
    // Most of the catalog carries no such field at all — absent must mean
    // live, not throw and not sink. `undefined - 0` is NaN, and a NaN
    // comparator silently produces an arbitrary order rather than an error.
    assert.equal(retiredRank({}), 0);
    assert.equal(retiredRank(undefined), 0);
    assert.equal(retiredRank(null), 0);
    assert.ok(Number.isFinite(compareBankHits(
      { c: {}, score: 1 }, { c: {}, score: 1 }, () => 0)));
  });
});

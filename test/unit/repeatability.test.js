// UNIT · parseRepeatability — the "May be repeated …" sentence parser shared
// by scripts/scrape-catalog.js and courseNorm.js. Cases below are verbatim
// phrasings from the live catalog (cb_desc text), including its typos.
// Semantics under test: "repeated N times" = N repeats BEYOND the first take,
// so max = N + 1 total completions ("May be repeated once for a total of two
// completions" — the catalog's own words).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepeatability } from "../../src/adapters/northeastern/repeatability.js";

const eq = (desc, expected) =>
  assert.deepEqual(parseRepeatability(desc), expected, JSON.stringify(desc));

test("repeatability › not repeatable", () => {
  eq("", null);
  eq(undefined, null);
  eq("Covers data structures. Prerequisite(s): CS 2500.", null);
  // "taken once" is a single take, not a repeat grant
  eq("May be taken once for a maximum of 8 semester hours.", null);
});

test("repeatability › unlimited", () => {
  eq("Offers elective credit. May be repeated without limit.", { max: null, maxSH: null });
  eq("May be repeated without limit where topics are unique.", { max: null, maxSH: null });
  // catalog typo: missing space
  eq("May be repeatedwithout limit.", { max: null, maxSH: null });
  eq("May be repeated.", { max: null, maxSH: null });
  eq("May be repeated for credit for PhD students.", { max: null, maxSH: null });
  eq("may be taken more than once, as long as topics are different.", { max: null, maxSH: null });
});

test("repeatability › word counts (once/twice/thrice → 2/3/4 completions)", () => {
  eq("May be repeated once.", { max: 2, maxSH: null });
  eq("May be repeated twice.", { max: 3, maxSH: null });
  eq("May be repeated thrice.", { max: 4, maxSH: null });
  eq("May be repeated up to twice for a maximum of 12 semester hours, when topics vary.", { max: 3, maxSH: 12 });
  eq("May be repeated once for a total of two completions.", { max: 2, maxSH: null });
  eq("May be repeated once, but may not be repeated for the same course.", { max: 2, maxSH: null });
});

test("repeatability › N times (words and digits)", () => {
  eq("May be repeated up to three times.", { max: 4, maxSH: null });
  eq("May be repeated seven times.", { max: 8, maxSH: null });
  eq("May be repeated up to eleven times.", { max: 12, maxSH: null });
  eq("May be repeated up to 4 times.", { max: 5, maxSH: null });
  eq("May be repeated up to 15 times for up to 16 total credits.", { max: 16, maxSH: 16 });
});

test("repeatability › credit-hour caps", () => {
  eq("May be repeated up to three times for a maximum of 16 semester hours.", { max: 4, maxSH: 16 });
  eq("May be repeated twice for a maximum of 12 semester hours with department approval.", { max: 3, maxSH: 12 });
  eq("May be repeated once for up to 4 total credits.", { max: 2, maxSH: 4 });
  eq("May be repeated for up to 8 total credits.", { max: null, maxSH: 8 });
  eq("May be repeated up to a maximum of 12 total semester hours.", { max: null, maxSH: 12 });
  eq("May be repeated twice up to a total of 12 SH.", { max: 3, maxSH: 12 });
  eq("May be repeated up to two times for a maximum of 12 SH.", { max: 3, maxSH: 12 });
  eq("May be repeated three times for a maximum of six hours.", { max: 4, maxSH: 6 });
  eq("May be repeated up to seven times for a maximum of thirty two semester hours.", { max: 8, maxSH: 32 });
  eq("May be repeated once for a maximum of eight semester credits.", { max: 2, maxSH: 8 });
  eq("May be repeated up to three times for a maximum of 12 quarter hours.", { max: 4, maxSH: 12 });
  eq("May be repeated for up to 16 SH.", { max: null, maxSH: 16 });
});

test("repeatability › compound sentence prefers the explicit repeated-clause", () => {
  eq(
    "May be taken more than once, as long as topics are different, and may be repeated up to four times for a maximum of 9 semester hours.",
    { max: 5, maxSH: 9 }
  );
});

test("repeatability › numbers in neighbouring sentences don't leak in", () => {
  eq(
    "Requires 12 semester hours of prior coursework. May be repeated twice. Students earn 4 credits per term.",
    { max: 3, maxSH: null }
  );
});

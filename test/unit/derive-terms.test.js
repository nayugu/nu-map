// UNIT · src/adapters/northeastern/courseNorm.js › deriveTerms
// "Typically offered" is a proportion, not a count: once any term in the
// post-birth window is negative, a season counts only when the course was
// offered in ≥ 2⁄3 of that season's terms on record. Term codes: YYYY + 10
// (fall) / 30 (spring) / 40 (Summer A) / 60 (Summer B).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveTerms } from "../../src/adapters/northeastern/courseNorm.js";

test("deriveTerms › all-positive history › every observed season", () => {
  const terms = deriveTerms({ 202410: true, 202510: true, 202530: true }, 202410);
  assert.deepEqual([...terms].sort(), ["fall", "spring"]);
});

test("deriveTerms › mixed history › season kept at 2/3, dropped at 1/3", () => {
  const history = {
    202410: true, 202510: true, 202610: false,   // fall: 2 of 3 → kept
    202430: true, 202530: false, 202630: false,  // spring: 1 of 3 → dropped
  };
  assert.deepEqual([...deriveTerms(history, 202410)].sort(), ["fall"]);
});

test("deriveTerms › exactly one-half is below the two-thirds bar → dropped", () => {
  const history = {
    202410: true, 202510: false,                 // fall: 1 of 2 (50%) → dropped
    202430: true, 202530: true, 202630: false,   // spring: 2 of 3 → kept
  };
  assert.deepEqual([...deriveTerms(history, 202410)].sort(), ["spring"]);
});

test("deriveTerms › pre-birth entries are ignored", () => {
  const history = { 202310: false, 202410: true, 202510: true, 202610: false };
  // Only 202410/202510/202610 count (fall): 2 of 3 → kept.
  assert.deepEqual([...deriveTerms(history, 202410)].sort(), ["fall"]);
});

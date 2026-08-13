// UNIT · variant labels shortened to digits, and what must survive it.
//
// The picker sits in a ~190px column and these labels are long: over the
// corpus (181 distinct labels, 678 variants) the commonest is "Four Years, Two
// Co-ops in Summer Second Half/Fall" at 49 characters and the longest is 105.
// So the label is rewritten for DISPLAY.
//
// Rewriting scraped text is the kind of thing that quietly corrupts a name, so
// this checks the two properties that matter: counts become digits, and
// nothing else changes — including the department's own oddities, which the
// corpus really contains ("No Co-op1", and a "Co-0p" typed with a zero).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shortVariantLabel } from "../../src/core/planTemplate.js";

test("short label › counts become digits", () => {
  assert.equal(
    shortVariantLabel("Four Years, Two Co-ops in Summer Second Half/Fall"),
    "4 Years, 2 Co-ops in Summer Second Half/Fall");
  assert.equal(
    shortVariantLabel("Five Years, Three Co-ops in Spring/Summer First Half"),
    "5 Years, 3 Co-ops in Spring/Summer First Half");
  assert.equal(shortVariantLabel("Four Years, One Co-op"), "4 Years, 1 Co-op");
});

test("short label › every count word one through ten", () => {
  const pairs = [["One", "1"], ["Two", "2"], ["Three", "3"], ["Four", "4"], ["Five", "5"],
                 ["Six", "6"], ["Seven", "7"], ["Eight", "8"], ["Nine", "9"], ["Ten", "10"]];
  for (const [word, digit] of pairs) {
    assert.equal(shortVariantLabel(`${word} Years`), `${digit} Years`);
  }
});

test("short label › case does not matter, and case elsewhere is preserved", () => {
  assert.equal(shortVariantLabel("FOUR Years"), "4 Years");
  assert.equal(shortVariantLabel("four years"), "4 years");
  // Only the number word is touched; the rest of the string is byte-identical.
  assert.equal(shortVariantLabel("Four Years, NO CO-OP"), "4 Years, NO CO-OP");
});

test("short label › a number INSIDE a word is left alone", () => {
  // The reason the replacement is word-bounded. "PlusOne" is a real NU program
  // name, and "Money" / "Bone" / "Tone" all contain a count word as a substring.
  for (const s of ["PlusOne Pathway", "Money and Banking", "Bone Biology", "Stone Age"]) {
    assert.equal(shortVariantLabel(s), s, s);
  }
});

test("short label › the department's own oddities survive unchanged", () => {
  // Both of these are in the corpus verbatim. A footnote marker welded to the
  // word, and a co-op typed with a zero — neither is ours to silently fix.
  assert.equal(shortVariantLabel("Two Semesters, No Co-op1"), "2 Semesters, No Co-op1");
  assert.equal(shortVariantLabel("Four Years, One Co-0p"), "4 Years, 1 Co-0p");
});

test("short label › digits already present are untouched", () => {
  assert.equal(shortVariantLabel("Four Years, Two Co-ops in Summer 2/Fall"),
    "4 Years, 2 Co-ops in Summer 2/Fall");
  assert.equal(shortVariantLabel("Plan 1"), "Plan 1");
  assert.equal(
    shortVariantLabel("Four Years, Two Co-ops in Spring/Summer First-Half (Option 1 of Science Requirement)"),
    "4 Years, 2 Co-ops in Spring/Summer First-Half (Option 1 of Science Requirement)");
});

test("short label › a concentration prefix is carried through", () => {
  assert.equal(
    shortVariantLabel("Philosophy with Concentration in Law and Ethics: Four Years, Two Co-ops in Spring/Summer First Half"),
    "Philosophy with Concentration in Law and Ethics: 4 Years, 2 Co-ops in Spring/Summer First Half");
});

test("short label › junk in, no throw out", () => {
  for (const v of [null, undefined, "", 0, 42, {}, []]) {
    assert.equal(typeof shortVariantLabel(v), "string");
  }
  assert.equal(shortVariantLabel(null), "");
  assert.equal(shortVariantLabel(undefined), "");
});

test("short label › it only ever gets SHORTER, never longer", () => {
  // A digit is one or two characters and every word it replaces is at least
  // three, so this holds by construction — asserted because the day it stops
  // holding is the day the substitution table grew a wrong entry.
  const samples = [
    "Four Years, Two Co-ops in Summer Second Half/Fall",
    "Five Years, Three Co-ops in Spring/Summer First Half",
    "Two Years, One (Optional) Co-op",
    "One and a Half Years",
    "Ten Semesters",
    "Plan 1",
    "MS in Management with Concentration in Strategic Technology Leadership, Online",
  ];
  for (const s of samples) {
    assert.ok(shortVariantLabel(s).length <= s.length, s);
  }
});

test("short label › is idempotent", () => {
  // The picker renders the button AND the option list from the same helper; a
  // second pass must be a no-op.
  for (const s of ["Four Years, Two Co-ops", "Plan 1", "Two Years, One (Optional) Co-op"]) {
    const once = shortVariantLabel(s);
    assert.equal(shortVariantLabel(once), once, s);
  }
});

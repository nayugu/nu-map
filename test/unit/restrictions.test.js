// UNIT · scripts/lib/restrictions.js › the whole Banner Restrictions pane
//
// This is the pane a student opens to find out whether they may register, and
// we kept one of its eleven kinds. The failure that matters here is the same
// one class-standing.js guards against — inventing a restriction that is not
// there, because a false gate can refuse a plan — plus one new one: merging two
// kinds that share a code. NEU's major code for Journalism is `(JR)`, identical
// to the Junior class code.
//
// Fixtures are real markup from .cache/banner/restrictions and from the
// MEIE 4701 §01 / 202710 page advising raised.

import { test } from "node:test";
import assert   from "node:assert/strict";
import {
  parseRestrictions, splitHeading, codeOf, labelOf, paneKey,
  restrictionsOf, tallySection, foldKind,
} from "../../scripts/lib/restrictions.js";

// MEIE 4701 §01, term 202710 — the Fall section of the shared ME/IE capstone.
const MEIE_4701 = `
<section aria-labelledby="restrictions">
  <div class="infoicon"><span class="status-bold">Not all restrictions are applicable.</span></div>
  <span class="status-bold">Must be enrolled in one of the following Levels:</span><br/>
  <span class="detail-popup-indentation">Undergraduate (UG)</span><br/>
  <span class="status-bold">Must be enrolled in one of the following Classes:</span><br/>
  <span class="detail-popup-indentation">Junior (JR)</span><br/>
  <span class="detail-popup-indentation">Senior(SR)</span><br/>
  <span class="status-bold">Must be enrolled in one of the following Majors:</span><br/>
  <span class="detail-popup-indentation">Industrial Engr/Business Admin (IEBA)</span><br/>
  <span class="detail-popup-indentation">Industrial Engr/Computer Sci (IECS)</span><br/>
  <span class="detail-popup-indentation">Industrial Engineering (INDE)</span><br/>
</section>`;

// ── The case advising raised ────────────────────────────────────────

test("MEIE 4701's Fall section reads exactly as Banner shows it", () => {
  const { blocks, labels } = restrictionsOf(parseRestrictions(MEIE_4701));
  assert.deepEqual(blocks["must:Levels"],  ["UG"]);
  assert.deepEqual(blocks["must:Classes"], ["JR", "SR"]);
  assert.deepEqual(blocks["must:Majors"],  ["IEBA", "IECS", "INDE"]);
  assert.equal(Object.keys(blocks).length, 3, "Banner's own notice is not a kind");
  assert.equal(labels["must:Majors|INDE"], "Industrial Engineering");
  assert.equal(labels["must:Classes|JR"],  "Junior");
});

test("Journalism (JR) and Junior (JR) cannot merge", () => {
  const page = `
    <span class="status-bold">Must be enrolled in one of the following Classes:</span>
    <span class="detail-popup-indentation">Junior (JR)</span>
    <span class="status-bold">Must be enrolled in one of the following Majors:</span>
    <span class="detail-popup-indentation">Journalism (JR)</span>`;
  const { blocks, labels } = restrictionsOf(parseRestrictions(page));
  assert.deepEqual(blocks["must:Classes"], ["JR"]);
  assert.deepEqual(blocks["must:Majors"],  ["JR"]);
  // The label map is keyed by kind AND code, which is what keeps them apart.
  assert.equal(labels["must:Classes|JR"], "Junior");
  assert.equal(labels["must:Majors|JR"],  "Journalism");
});

// ── Heading grammar ─────────────────────────────────────────────────

test("polarity and multi-word kinds survive", () => {
  assert.deepEqual(splitHeading("Must be enrolled in one of the following Majors:"),
    { kind: "Majors", polarity: "must" });
  assert.deepEqual(splitHeading("Cannot be enrolled in one of the following Campuses:"),
    { kind: "Campuses", polarity: "not" });
  // A real heading whose KIND contains commas and parentheses.
  assert.deepEqual(
    splitHeading("Cannot be enrolled in one of the following Fields of Study (Major, Minor or Concentration):"),
    { kind: "Fields of Study (Major, Minor or Concentration)", polarity: "not" });
});

test("Special Approvals is `info`, and its codeless value is kept", () => {
  // 6.2% of sections. Not a gate on WHO may enrol — a statement that a human
  // must sign — and its values carry no parenthesised code at all, so a
  // code-keyed tally that dropped them would lose the kind entirely.
  const page = `<span class="status-bold">Special Approvals:</span><br/>
    <span class="detail-popup-indentation">Advisor&#39;s Signature</span><br/>`;
  const { blocks } = restrictionsOf(parseRestrictions(page));
  assert.deepEqual(blocks["info:Special Approvals"], ["«Advisor's Signature»"]);
});

test("nothing that is not a heading becomes a kind", () => {
  for (const h of ["Not all restrictions are applicable.", "", "123:", "  :"]) {
    assert.equal(splitHeading(h), null);
  }
  assert.deepEqual(restrictionsOf(null), { blocks: {}, labels: {} });
  assert.deepEqual(restrictionsOf({}),   { blocks: {}, labels: {} });
});

test("codes and labels split at the trailing parenthesis only", () => {
  assert.equal(codeOf("Engineering (Boston) (EN)"), "EN");
  assert.equal(labelOf("Engineering (Boston) (EN)"), "Engineering (Boston)");
  assert.equal(codeOf("Business Admin and Law (BALW)"), "BALW");
  assert.equal(codeOf("Advisor's Signature"), null);
  assert.equal(paneKey("Majors", "not"), "not:Majors");
});

// ── Per-section tally ───────────────────────────────────────────────

test("sections are tallied per value SET, like `std`", () => {
  const t = {};
  const a = restrictionsOf(parseRestrictions(MEIE_4701)).blocks;
  tallySection(a, t);
  tallySection(a, t);
  assert.deepEqual(t["must:Majors"], { "IEBA|IECS|INDE": 2 });
  // A second section with a DIFFERENT set is its own bucket, not a merge —
  // that distinction is what makes coverage recoverable later.
  tallySection({ "must:Majors": ["INDE"] }, t);
  assert.deepEqual(t["must:Majors"], { "IEBA|IECS|INDE": 2, "INDE": 1 });
});

// ── The fold ────────────────────────────────────────────────────────

test("a positive restriction UNIONS across sections, with per-code coverage", () => {
  // Four sections admit IEBA/IECS/INDE, three admit only INDE. An IEBA student
  // can register for four of the seven, so IEBA must survive the fold — the
  // lenient reading, generalised from class-standing's ladder rule 3.
  const { codes, sections } = foldKind({ "IEBA|IECS|INDE": 4, "INDE": 3 }, "must");
  assert.equal(sections, 7);
  assert.deepEqual(codes, [
    { code: "INDE", sections: 7 },
    { code: "IEBA", sections: 4 },
    { code: "IECS", sections: 4 },
  ]);
});

test("a NEGATIVE restriction intersects — it binds only on every section", () => {
  // "Cannot be a freshman" on 2 of 5 sections does not bar a freshman from the
  // course: three sections are open. Unioning would have invented a bar.
  assert.deepEqual(foldKind({ "FR": 2 }, "not", 5).codes, [],
    "a negative on some sections must not bind");
  assert.deepEqual(foldKind({ "FR": 5 }, "not", 5).codes, [{ code: "FR", sections: 5 }]);
});

test("a negative with NO section count refuses rather than guesses", () => {
  // The tally alone cannot tell 2-of-2 from 2-of-5, and those are opposite
  // facts. Refusing is the conservative direction: a bar we cannot confirm must
  // not be asserted. Caught by this test — the first version compared against
  // the tally's own sum and read every negative as binding.
  const r = foldKind({ "FR": 2 }, "not");
  assert.deepEqual(r.codes, []);
  assert.equal(r.unresolved, true, "the caller must be able to tell refusal from absence");
  assert.equal(r.total, null);
});

test("a positive needs no section count to be correct", () => {
  // Union is safe without it: a code on any section is reachable on that
  // section, whatever the course total.
  const r = foldKind({ "IEBA|INDE": 4 }, "must");
  assert.deepEqual(r.codes.map(c => c.code), ["IEBA", "INDE"]);
  assert.equal(r.unresolved, false);
});

test("coverage is reported, never thresholded away", () => {
  // `3 of 21` (an open section exists) and `21 of 21` (no way in) are opposite
  // advice, and one boolean cannot carry both.
  const few  = foldKind({ "INDE": 3, "": 18 }, "must");
  assert.equal(few.codes.find(c => c.code === "INDE").sections, 3);
  assert.equal(few.sections, 21);
});

test("foldKind survives junk without inventing a code", () => {
  for (const bad of [null, undefined, {}, { "X": 0 }, { "X": -1 }, { "": 3 }]) {
    const r = foldKind(bad, "must");
    assert.ok(Array.isArray(r.codes));
    assert.ok(!r.codes.some(c => !c.code));
  }
});

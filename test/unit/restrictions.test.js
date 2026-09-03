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
  parseRestrictions, splitHeading, codeOf, labelOf,
  restrictionsOf, tallySection, foldKind,
  RESTR_AY_WINDOW, currentAYEnd, oldestAYEnd, withinRestrictionWindow,
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
});

test("the storage key is `polarity:Kind`", () => {
  // Asserted through the public surface rather than the internal helper: the
  // key format IS the stored shape, so what matters is what restrictionsOf
  // emits, not how it builds it.
  const page = `<span class="status-bold">Cannot be enrolled in one of the following Majors:</span>
    <span class="detail-popup-indentation">Computer Science (CSCI)</span>`;
  assert.deepEqual(Object.keys(restrictionsOf(parseRestrictions(page)).blocks), ["not:Majors"]);
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

// ── The recency window ──────────────────────────────────────────────
//
// Restrictions are the one field here where age is a defect rather than
// evidence, so this window is tighter than the availability one. It is also
// the only place in the repo with TWO notions of "recent" in one scraper, so
// the arithmetic is worth pinning down rather than trusting.

test("the academic year rolls over in September, as Banner numbers it", () => {
  // Banner's YYYY is the year the AY ENDS, so Fall 2026 is 202710.
  assert.equal(currentAYEnd(new Date("2026-09-01T12:00:00Z")), 2027, "September starts the new AY");
  assert.equal(currentAYEnd(new Date("2026-08-31T12:00:00Z")), 2026, "August is still the old one");
  assert.equal(currentAYEnd(new Date("2027-01-15T12:00:00Z")), 2027, "January belongs to the AY it ends");
  assert.equal(currentAYEnd(new Date("2026-12-31T12:00:00Z")), 2027);
});

test("the window is a COUNT of academic years, inclusive of the one in progress", () => {
  // The off-by-one this replaced: `recentTermCodes(3)` looped
  // `currentAYEnd - 3 … currentAYEnd` inclusive, so it returned FOUR academic
  // years while its comment claimed three — which is how the backfill came to
  // be fetching Fall 2023. A count is unambiguous where "years back" was not.
  const now = new Date("2026-09-03T12:00:00Z");   // AY2027
  assert.equal(oldestAYEnd(1, now), 2027, "one year is the current AY alone");
  assert.equal(oldestAYEnd(3, now), 2025);
  assert.equal(oldestAYEnd(4, now), 2024);
});

test("the shipped window admits AY2025-27 and rejects AY2024", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  const inWindow  = ["202510", "202530", "202540", "202560", "202610", "202630", "202710"];
  const tooOld    = ["202410", "202430", "202440", "202460", "202360", "201910"];
  for (const tc of inWindow) {
    assert.equal(withinRestrictionWindow(tc, RESTR_AY_WINDOW, now), true, `${tc} should be kept`);
  }
  for (const tc of tooOld) {
    assert.equal(withinRestrictionWindow(tc, RESTR_AY_WINDOW, now), false, `${tc} should be dropped`);
  }
});

test("the boundary is exact — one AY either side of the cut", () => {
  const now = new Date("2026-09-03T12:00:00Z");   // AY2027, oldest kept = 2025
  assert.equal(withinRestrictionWindow("202560", 3, now), true,  "the oldest kept AY's last term");
  assert.equal(withinRestrictionWindow("202510", 3, now), true,  "the oldest kept AY's first term");
  assert.equal(withinRestrictionWindow("202460", 3, now), false, "one term older must fall out");
  // And the window MOVES: the same term ages out a year later.
  assert.equal(withinRestrictionWindow("202510", 3, new Date("2027-09-03T12:00:00Z")), false,
    "Fall 2024 must age out once AY2028 begins");
});

test("the synthetic summer codes are dated by their merged term's AY", () => {
  // AY2026+ merges the summer sessions into one …50 code, which the scraper
  // splits back into 202640/202660. Those are OUR codes, not Banner's, and a
  // window that only understood real ones would silently drop a whole summer.
  const now = new Date("2026-09-03T12:00:00Z");
  for (const tc of ["202640", "202650", "202660"]) {
    assert.equal(withinRestrictionWindow(tc, 3, now), true, `${tc} should be kept`);
  }
  assert.equal(withinRestrictionWindow("202450", 3, now), false, "and an old merged code still ages out");
});

test("a term code we cannot date is REJECTED, never admitted", () => {
  // The failure direction matters. Admitting an undateable code would let an
  // arbitrarily old term through the one guard that exists to keep it out;
  // rejecting one costs a restriction we can re-derive from cache for free the
  // moment the code is understood. Same asymmetry as `knownTermCodes`.
  const now = new Date("2026-09-03T12:00:00Z");
  for (const bad of [null, undefined, "", "20261", "2026100", "abcdef", "20-610",
                     {}, [], NaN, "202610 ", " 202610"]) {
    assert.equal(withinRestrictionWindow(bad, 3, now), false,
      `${JSON.stringify(bad)} must not be treated as recent`);
  }
});

test("a nonsense window count falls back to the shipped one rather than admitting everything", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  for (const bad of [0, -5, NaN, null, undefined, "three", Infinity]) {
    const oldest = oldestAYEnd(bad, now);
    assert.ok(Number.isFinite(oldest), `window ${bad} produced ${oldest}`);
    // Must not silently become an unbounded window.
    assert.equal(withinRestrictionWindow("202410", bad, now), false,
      `window ${bad} let an AY2024 term through`);
  }
});

test("a FUTURE term is not 'recent' — the window has an upper edge too", () => {
  // Banner publishes about a term ahead, and a code beyond the current AY is
  // either a typo or a term nobody has attended. Either way it is not evidence
  // about registration, and `completedTerms` already excludes it upstream —
  // this pins the belt.
  const now = new Date("2026-09-03T12:00:00Z");   // AY2027
  assert.equal(withinRestrictionWindow("202810", 3, now), false);
  assert.equal(withinRestrictionWindow("209910", 3, now), false);
});

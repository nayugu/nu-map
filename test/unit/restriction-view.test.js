// UNIT · src/core/restrictionView.js › grouping Banner restrictions for reading
//
// The fold this replaces was wrong twice, in both directions, so these tests
// aim at exactly those two failures:
//
//   1. keeping only the newest term, which hid MEIE 4701's Fall restriction
//      behind its Summer B one;
//   2. unioning the section groups, which turned ARCH 5115's three distinct
//      program groups into one list that implies any of them may take any
//      section.
//
// Fixtures are the real stored shapes, taken from term-details.json.

import test   from "node:test";
import assert from "node:assert/strict";

import { groupRestrictions, seasonCoverage, displayValues, KIND_ORDER,
         splitByCoverage, isGate }
  from "../../src/core/restrictionView.js";

// ── Coverage: per season, pooled across that season's years ─────────

test("a restriction on EVERY section needs no fraction", () => {
  const [fall] = seasonCoverage([{ term: "202510", season: "fall", sections: 5, of: 5 }]);
  assert.equal(fall.everySection, true);
  assert.equal(fall.terms, 1);
});

test("a restriction on SOME sections keeps its fraction — the reserved case", () => {
  // 24.6% of observations. ACCT 1201 restricts majors on 1 of 2 sections and
  // leaves the other open, and departments hold sections for first-years. This
  // is the difference between "you cannot take this" and "one section is closed".
  const [fall] = seasonCoverage([{ term: "202510", season: "fall", sections: 1, of: 2 }]);
  assert.equal(fall.everySection, false);
  assert.equal(fall.sections, 1);
  assert.equal(fall.of, 2);
});

test("years of the SAME season pool into one denominator", () => {
  // The reason the season is the unit: one term is a denominator of 2 or 21
  // depending on the course, and a rate read off a single observation is how
  // "1 of 2" becomes "50% of sections" in someone's head.
  const [fall] = seasonCoverage([
    { term: "202610", season: "fall", sections: 2, of: 8 },
    { term: "202510", season: "fall", sections: 2, of: 10 },
  ]);
  assert.equal(fall.terms, 2);
  assert.equal(fall.sections, 4);
  assert.equal(fall.of, 18, "denominators add across the years of a season");
  assert.equal(fall.latestTerm, "202610", "the newest term of the season is kept for labelling");
});

test("DIFFERENT seasons never pool — that is the whole point", () => {
  // MEIE 4701 is Industrial-only in Fall and Mechanical-only in Summer B.
  // Averaging the two would produce one number describing neither.
  const cov = seasonCoverage([
    { term: "202460", season: "sumB", sections: 1, of: 1 },
    { term: "202510", season: "fall", sections: 1, of: 3 },
  ]);
  assert.equal(cov.length, 2);
  assert.deepEqual(cov.map(c => c.season), ["fall", "sumB"], "declared season order");
  assert.equal(cov.find(c => c.season === "fall").of, 3);
  assert.equal(cov.find(c => c.season === "sumB").everySection, true);
});

test("an unknown section total cannot produce a fraction", () => {
  // Claiming "1 of null" or silently treating it as complete would both be
  // worse than saying nothing about coverage.
  const [c] = seasonCoverage([{ term: "202510", season: "fall", sections: 3, of: null }]);
  assert.equal(c.of, null);
  assert.equal(c.everySection, false, "unknown total must not read as a gate");
});

test("seasonCoverage names every year of a season, newest first", () => {
  // The panel prints these instead of "(N years)". Aggregating over years was
  // always right; counting them threw away which years, so a reader could not
  // tell last year's gate from one three years old.
  const [fall] = seasonCoverage([
    { term: "202510", season: "fall", sections: 2, of: 2 },
    { term: "202710", season: "fall", sections: 3, of: 3 },
    { term: "202610", season: "fall", sections: 1, of: 1 },
  ]);
  assert.equal(fall.terms, 3, "the count is still there — callers test it");
  assert.deepEqual(fall.termCodes, ["202710", "202610", "202510"], "newest first");
});

test("seasonCoverage DEDUPES term codes within a season", () => {
  // SUFFIX_TYPE maps BOTH "40" and "50" to sumA — the merged summer code and a
  // real Summer 1 code land in the same season. Without the dedupe a single
  // year would be named twice ("2025, 2025").
  const [sumA] = seasonCoverage([
    { term: "202540", season: "sumA", sections: 1, of: 1 },
    { term: "202540", season: "sumA", sections: 1, of: 1 },
  ]);
  assert.deepEqual(sumA.termCodes, ["202540"]);
});

test("seasonCoverage always reports a term code, even for one observation", () => {
  // A season heading with no year would read as a standing rule, which is the
  // one thing a single observation cannot claim.
  const [fall] = seasonCoverage([{ term: "202510", season: "fall", sections: 1, of: 1 }]);
  assert.deepEqual(fall.termCodes, ["202510"]);
  assert.equal(fall.latestTerm, "202510", "latestTerm stays, as the render's fallback");
});

test("seasonCoverage survives junk", () => {
  assert.deepEqual(seasonCoverage(null), []);
  assert.deepEqual(seasonCoverage([]), []);
  assert.doesNotThrow(() => seasonCoverage([{ term: "x", season: null, sections: 1, of: 1 }]));
});

// ── Labels are not unique across codes ──────────────────────────────

test("two codes the registrar names alike are disambiguated, not shown twice", () => {
  // Real: ARCH 3170 lists BS-ARCH, BS-ARCS and MARCH-ARCH3, and Banner labels
  // the first and third both "Architecture". Printed raw that reads as a bug.
  const labels = {
    "must:Majors|BS-ARCH":     "Architecture",
    "must:Majors|BS-ARCS":     "Architectural Studies",
    "must:Majors|MARCH-ARCH3": "Architecture",
  };
  assert.deepEqual(
    displayValues(["BS-ARCH", "BS-ARCS", "MARCH-ARCH3"], labels, "must:Majors"),
    ["Architecture (BS-ARCH)", "Architectural Studies", "Architecture (MARCH-ARCH3)"],
    "only the colliding labels get a code; the unique one stays clean");
});

test("a label used by only one code is never cluttered with the code", () => {
  const labels = { "must:Majors|INDE": "Industrial Engineering" };
  assert.deepEqual(displayValues(["INDE"], labels, "must:Majors"),
    ["Industrial Engineering"]);
});

test("the same code twice collapses to one entry", () => {
  const labels = { "must:Majors|INDE": "Industrial Engineering" };
  assert.deepEqual(displayValues(["INDE", "INDE"], labels, "must:Majors"),
    ["Industrial Engineering"]);
});

test("a code with no label shows the code, and a codeless value loses its marks", () => {
  // `«Advisor's Signature»` is how a value with no parenthesised code is stored.
  assert.deepEqual(displayValues(["«Advisor's Signature»"], {}, "info:Special Approvals"),
    ["Advisor's Signature"]);
  assert.deepEqual(displayValues(["XYZ"], {}, "must:Majors"), ["XYZ"]);
});

test("displayValues survives junk", () => {
  assert.deepEqual(displayValues(null), []);
  assert.deepEqual(displayValues([null, "", undefined]), []);
  assert.doesNotThrow(() => displayValues(["A"], null, null));
});

// ── The case advising raised ────────────────────────────────────────

test("a restriction that MOVES between seasons keeps both readings", () => {
  // MEIE 4701: Industrial-only in Fall, Mechanical-only in Summer B. A fold
  // that kept the newest term would show one and silently drop the other.
  const view = groupRestrictions([
    { term: "202510", season: "fall", sections: 1,
      kinds: { "must:Majors": [[["IEBA", "IECS", "INDE"], 1]] } },
    { term: "202460", season: "sumB", sections: 1,
      kinds: { "must:Majors": [[["MEBE", "MECE", "MEDS"], 1]] } },
  ]);

  assert.equal(view.termCount, 2);
  const majors = view.kinds.find(k => k.key === "must:Majors");
  assert.equal(majors.groups.length, 2, "both major sets must survive");
  const seasons = majors.groups.map(g => g.where[0].season).sort();
  assert.deepEqual(seasons, ["fall", "sumB"]);
  for (const g of majors.groups) {
    assert.equal(g.everyTerm, false, "a restriction present in one of two terms is not universal");
  }
});

test("sections that DISAGREE within one term stay separate groups", () => {
  // ARCH 5115, 202510, five sections, three program groups. Unioned this reads
  // "any of these programs on some section" and never tells a BS-ARCH student
  // that exactly one section is open to them.
  const view = groupRestrictions([
    { term: "202510", season: "fall", sections: 5,
      kinds: { "must:Programs": [
        [["MARCH-ARCH3", "MARCH-ARCH3A"], 2],
        [["MARCH-ARCH2"], 1],
        [["BS-ARCH", "BS-ARCS"], 1],
      ] } },
  ]);
  const progs = view.kinds.find(k => k.key === "must:Programs");
  assert.equal(progs.groups.length, 3, "the three groups must not merge");
  assert.equal(progs.variesBySection, true, "the caller must know to show counts");
  // The 2-section group leads; the reader sees the widest option first.
  assert.deepEqual(progs.groups[0].codes, ["MARCH-ARCH3", "MARCH-ARCH3A"]);
  // And every group carries its own coverage, so "1 of 5" is printable.
  for (const g of progs.groups) {
    assert.equal(g.where[0].of, 5);
  }
});

// ── Collapsing the boring case ──────────────────────────────────────

test("an unchanging restriction collapses to ONE group marked everyTerm", () => {
  // The reason this fold exists: eleven identical observations should read as
  // one line, not eleven.
  const terms = ["202630", "202610", "202530", "202510"].map(term => ({
    term, season: "fall", sections: 3,
    kinds: { "must:Classes": [[["JR", "SR"], 3]] },
  }));
  const view = groupRestrictions(terms);
  const cls = view.kinds.find(k => k.key === "must:Classes");
  assert.equal(cls.groups.length, 1);
  assert.equal(cls.groups[0].everyTerm, true);
  assert.equal(cls.groups[0].where.length, 4, "the terms are still all listed underneath");
  assert.equal(cls.variesBySection, false);
});

test("everyTerm counts the terms the KIND appeared in, not the course's terms", () => {
  // A term where the kind is ABSENT is a different fact from one where it
  // differs, so it must not make an otherwise-constant restriction look partial.
  const view = groupRestrictions([
    { term: "202530", season: "spring", sections: 2, kinds: { "must:Majors": [[["INDE"], 2]] } },
    { term: "202510", season: "fall",   sections: 2, kinds: { "must:Majors": [[["INDE"], 2]] } },
    { term: "202460", season: "sumB",   sections: 2, kinds: { "must:Classes": [[["JR"], 2]] } },
  ]);
  const majors = view.kinds.find(k => k.key === "must:Majors");
  assert.equal(majors.groups[0].everyTerm, true,
    "seen in both terms it appears in, so it is constant for that kind");
  const cls = view.kinds.find(k => k.key === "must:Classes");
  assert.equal(cls.groups[0].everyTerm, false,
    "a kind seen in only one term cannot be called universal");
});

test("a single observation is never called everyTerm", () => {
  const view = groupRestrictions([
    { term: "202460", season: "sumB", sections: 1, kinds: { "must:Majors": [[["MECE"], 1]] } },
  ]);
  assert.equal(view.kinds[0].groups[0].everyTerm, false,
    "one term is not evidence of a pattern");
});

// ── Ordering ────────────────────────────────────────────────────────

test("kinds come out in the declared order, and an unknown kind is kept last", () => {
  const view = groupRestrictions([{
    term: "202510", season: "fall", sections: 1,
    kinds: {
      "info:Special Approvals": [[["«Advisor's Signature»"], 1]],
      "must:Cohorts":           [[["HON"], 1]],   // not in KIND_ORDER
      "must:Classes":           [[["SR"], 1]],
      "must:Majors":            [[["INDE"], 1]],
    },
  }]);
  const keys = view.kinds.map(k => k.key);
  assert.deepEqual(keys.slice(0, 3), ["must:Classes", "must:Majors", "info:Special Approvals"]);
  assert.equal(keys.at(-1), "must:Cohorts", "an unrecognised kind sorts last");
  assert.ok(keys.includes("must:Cohorts"), "…but is never DROPPED");
});

test("polarity and kind are split out for the renderer", () => {
  const view = groupRestrictions([{
    term: "202510", season: "fall", sections: 4,
    kinds: { "not:Classes": [[["FR"], 4]] },
  }]);
  assert.equal(view.kinds[0].polarity, "not");
  assert.equal(view.kinds[0].kind, "Classes");
});

test("a kind whose name contains a colon still splits at the FIRST one", () => {
  // Real heading: "Fields of Study (Major, Minor or Concentration)". No colon
  // today, but the split must be on the first delimiter regardless.
  const view = groupRestrictions([{
    term: "202510", season: "fall", sections: 1,
    kinds: { "not:Fields of Study (Major, Minor or Concentration)": [[["CMPE"], 1]] },
  }]);
  assert.equal(view.kinds[0].polarity, "not");
  assert.equal(view.kinds[0].kind, "Fields of Study (Major, Minor or Concentration)");
});



// ── Degenerate input ────────────────────────────────────────────────

test("junk degrades to an empty view rather than throwing", () => {
  for (const bad of [null, undefined, [], {}, [null], [{}], [{ kinds: null }]]) {
    assert.doesNotThrow(() => groupRestrictions(bad));
    const v = groupRestrictions(bad);
    assert.equal(v.kinds.length, 0);
  }
});

test("a malformed group is skipped, never rendered as an empty restriction", () => {
  // An empty code list or a zero count would print a kind with no values —
  // worse than absent, because it implies a restriction exists and is unnamed.
  const view = groupRestrictions([{
    term: "202510", season: "fall", sections: 2,
    kinds: {
      "must:Majors":  [[[], 2], [["INDE"], 2]],
      "must:Colleges": [[["EN"], 0]],
    },
  }]);
  const majors = view.kinds.find(k => k.key === "must:Majors");
  assert.deepEqual(majors.groups.map(g => g.codes), [["INDE"]]);
  assert.equal(view.kinds.find(k => k.key === "must:Colleges"), undefined,
    "a kind whose only group has a zero count must not appear");
});

test("KIND_ORDER is frozen so a caller cannot reorder it globally", () => {
  assert.throws(() => { KIND_ORDER.push("must:Nonsense"); });
});

// ── The tier split ──────────────────────────────────────────────────
//
// The panel reads as a conjunction — "Freshman AND ND Global Scholars AND
// College of Engineering AND Oakland AND Honors" — for a course whose rules sit
// on five DIFFERENT sets of sections. These tests attack the split that fixes
// it: the danger is not that the headings are wrong, it is that a group falls
// between the two tiers and stops being printed at all.

const gateView = (terms) => splitByCoverage(groupRestrictions(terms).kinds);

test("splitByCoverage is a PARTITION — every group lands in exactly one tier", () => {
  // The whole risk of the change. A group printed twice is noise; a group
  // printed nowhere is a restriction the student never sees.
  const view = groupRestrictions([
    { term: "202510", season: "fall", sections: 4, kinds: {
      "must:Colleges": [[["EN"], 4]],
      "must:Classes":  [[["FR"], 3]],
      "must:Campuses": [[["OAK"], 1], [["BOS"], 3]],
    } },
    { term: "202530", season: "spring", sections: 2, kinds: {
      "must:Colleges": [[["EN"], 2]],
      "must:Classes":  [[["FR"], 2]],
    } },
  ]);
  const all = view.kinds.flatMap(k => k.groups.map(g => `${k.key}|${g.codes.join(",")}`));
  const { gates, partial } = splitByCoverage(view.kinds);
  const out = [...gates, ...partial]
    .flatMap(k => k.groups.map(g => `${k.key}|${g.codes.join(",")}`));
  assert.deepEqual(out.slice().sort(), all.slice().sort(), "no group gained or lost");
  assert.equal(new Set(out).size, out.length, "no group in both tiers");
});

test("a gate is every section in EVERY season, not just the newest one", () => {
  // The reserved case must never be promoted into "applies to every section":
  // that heading tells the student there is no way round the rule, and here
  // there is one — three of the four Fall sections.
  const { gates, partial } = gateView([
    { term: "202510", season: "fall",   sections: 4, kinds: { "must:Classes": [[["FR"], 3]] } },
    { term: "202530", season: "spring", sections: 2, kinds: { "must:Classes": [[["FR"], 2]] } },
  ]);
  assert.deepEqual(gates, []);
  assert.equal(partial.length, 1);
  assert.deepEqual(partial[0].groups[0].seasons.map(s => s.everySection), [false, true]);
});

test("a kind whose groups DISAGREE is stated in both tiers, with only its own groups", () => {
  // 84 of 5,382 kinds. Filing the whole kind by majority would print
  // "cannot be enrolled in" under "applies to every section" for the rest.
  const { gates, partial } = gateView([
    { term: "202510", season: "fall", sections: 4, kinds: {
      "must:Campuses": [[["BOS"], 4], [["OAK"], 1]],
    } },
  ]);
  assert.deepEqual(gates.map(k => k.key),   ["must:Campuses"]);
  assert.deepEqual(partial.map(k => k.key), ["must:Campuses"]);
  assert.deepEqual(gates[0].groups.map(g => g.codes),   [["BOS"]]);
  assert.deepEqual(partial[0].groups.map(g => g.codes), [["OAK"]]);
  assert.equal(gates[0].polarity, "must", "polarity travels with each copy");
});

test("an UNDATED group is never called a gate", () => {
  // `seasons` is empty only when nothing could be dated, and an undated
  // observation cannot claim to cover every section. `[].every(...)` is true,
  // so this is exactly the case a naive predicate gets backwards.
  assert.equal(isGate({ seasons: [] }), false);
  assert.equal(isGate({}), false);
  assert.equal(isGate(null), false);
});

test("splitByCoverage does not mutate the view it was handed", () => {
  // The panel renders the same `view` object; a filter that edited it in place
  // would empty the second tier of whatever the first one took.
  const kinds = groupRestrictions([
    { term: "202510", season: "fall", sections: 4, kinds: {
      "must:Campuses": [[["BOS"], 4], [["OAK"], 1]],
    } },
  ]).kinds;
  const before = JSON.stringify(kinds);
  splitByCoverage(kinds);
  splitByCoverage(kinds);
  assert.equal(JSON.stringify(kinds), before);
});

test("splitByCoverage survives junk", () => {
  for (const junk of [undefined, null, [], [null], [{}], [{ groups: null }]]) {
    const out = splitByCoverage(junk);
    assert.deepEqual(out.gates, []);
    assert.deepEqual(out.partial, []);
  }
});

test("an empty tier is empty, not a heading with nothing under it", () => {
  // The renderer returns null on an empty tier, so this is what keeps a
  // gate-only course — 2,075 of 2,949 — from printing "applies to some
  // sections only" over a blank.
  const { gates, partial } = gateView([
    { term: "202510", season: "fall", sections: 3, kinds: { "must:Colleges": [[["EN"], 3]] } },
  ]);
  assert.equal(gates.length, 1);
  assert.deepEqual(partial, []);
});

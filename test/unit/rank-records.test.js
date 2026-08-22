// UNIT · src/core/rankRecords.js — the one scorer, on its own record shape.
//
// Hostile on purpose: the record shape has six optional fields, and a caller
// that passes only `name` (which is what every kind on the data surface does
// for professors) must not hit an undefined read. The tier ORDER is the design,
// so it is asserted as ordering rather than by pinning magic numbers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeQuery, scoreRecord } from "../../src/core/rankRecords.js";
import { T } from "../../src/core/nameMatch.js";

const score = (rec, query) => {
  const { q, qTokens } = normalizeQuery(query);
  return scoreRecord(rec, q, qTokens);
};
/** Which tier a score landed in, so tests never depend on the coverage bonus. */
const tierOf = (s) => {
  if (s === -Infinity) return "NONE";
  const hit = Object.entries(T)
    .filter(([, floor]) => s >= floor)
    .sort((a, b) => b[1] - a[1])[0];
  return hit ? hit[0] : "NONE";
};

test("rankRecords › normalizeQuery survives junk input", () => {
  for (const junk of [null, undefined, "", "   ", "\t\n"]) {
    const { q, qTokens } = normalizeQuery(junk);
    assert.equal(q, "", `expected empty for ${JSON.stringify(junk)}`);
    assert.deepEqual(qTokens, []);
  }
  assert.deepEqual(normalizeQuery("  Computer   SCIENCE ").q, "computer science",
    "collapses whitespace and lowercases");
  assert.deepEqual(normalizeQuery("  Computer   SCIENCE ").qTokens, ["computer", "science"]);
});

test("rankRecords › a nameless record never matches", () => {
  assert.equal(score({ name: "" }, "anything"), -Infinity);
  assert.equal(score({ name: undefined }, "anything"), -Infinity);
  // Even when a secondary field would have matched: name is the anchor.
  assert.equal(score({ name: "", codes: ["cs"] }, "cs"), -Infinity);
});

test("rankRecords › a name-only record is fully usable", () => {
  // Professors and NUpath labels pass nothing else. Every optional field must
  // tolerate being absent rather than throwing on `.includes`.
  const rec = { name: "aanjhan ranganathan" };
  assert.equal(tierOf(score(rec, "aanjhan ranganathan")), "EXACT");
  assert.equal(tierOf(score(rec, "aanjhan")), "PREFIX");
  assert.equal(tierOf(score(rec, "ranganathan")), "ORDERED");
  assert.equal(tierOf(score(rec, "ranganathan aanjhan")), "ANY", "either token order");
  assert.equal(score(rec, "zzzz"), -Infinity);
});

test("rankRecords › the tier ladder is strictly ordered", () => {
  // One record that can be hit at many tiers, so the ordering is comparable.
  const rec = {
    name: "computer science",
    exact: ["computer science, bscs"],
    codes: ["bscs"],
    acronyms: ["cs"],
    poolWords: ["boston"],
    loose: [{ text: "computer_science_bscs_(boston)", penalty: 100, slug: true }],
  };
  const ranked = [
    ["computer science",       "EXACT"],
    ["computer science, bscs", "EXACT"],
    ["bscs",                   "ACRONYM_CODE"],
    ["cs",                     "ACRONYM"],
    ["computer sci",           "PREFIX"],
    ["comp sci",               "ORDERED"],
    ["science computer",       "ANY"],
  ];
  for (const [q, expected] of ranked) assert.equal(tierOf(score(rec, q)), expected, `"${q}"`);

  // And the scores themselves descend in that order.
  const scores = ranked.map(([q]) => score(rec, q));
  const codeIdx = 2;
  for (let i = codeIdx; i < scores.length - 1; i++) {
    assert.ok(scores[i] > scores[i + 1],
      `"${ranked[i][0]}" (${scores[i]}) must outrank "${ranked[i + 1][0]}" (${scores[i + 1]})`);
  }
});

test("rankRecords › an official code outranks derived initials", () => {
  // "cs" is Computer Science's degree code and Cinema Studies' initials. The
  // code has to win, or the strongest evidence available loses to the weakest.
  const compSci = { name: "computer science", codes: ["bscs"], acronyms: ["cs"] };
  const cinema  = { name: "cinema studies",   codes: ["ba"],   acronyms: ["cs"] };
  const byCode  = { name: "computer science", codes: ["cs"],   acronyms: [] };
  assert.ok(score(byCode, "cs") > score(cinema, "cs"));
  assert.equal(tierOf(score(byCode, "cs")), "ACRONYM_CODE");
  assert.equal(tierOf(score(compSci, "cs")), "ACRONYM");
});

test("rankRecords › coverage orders within a tier, never across", () => {
  const plain    = { name: "computer science" };
  const combined = { name: "computer science and biology" };
  const long     = { name: "computer science and speech-language pathology and audiology" };
  const q = "computer science";
  assert.ok(score(plain, q) > score(combined, q));
  assert.ok(score(combined, q) > score(long, q));
  // All three are the same tier — the ordering above is coverage alone.
  for (const r of [plain, combined, long]) {
    const t = tierOf(score(r, q));
    assert.ok(t === "EXACT" || t === "PREFIX", `unexpected tier ${t}`);
  }
  // A weaker structural match on a SHORTER name must still lose.
  assert.ok(score(plain, q) > score({ name: "cs" }, q) || score({ name: "cs" }, q) === -Infinity);
});

test("rankRecords › poolWords reach the ANY tier, and reach it alone", () => {
  const rec = { name: "computer science", poolWords: ["boston"] };
  assert.equal(tierOf(score(rec, "computer science boston")), "ANY");
  // A bare pool word DOES match, at ANY. Asserted because it is surprising:
  // searching "boston" returns every Boston program rather than nothing. That
  // is pre-split behaviour, unchanged here, and it is why the data surface
  // must not pour a campus or college into poolWords for 13,000 records —
  // one query would match a third of the corpus at a mid tier.
  assert.equal(tierOf(score(rec, "boston")), "ANY");
});

test("rankRecords › loose fields are last resort and carry their penalty", () => {
  // The name deliberately does NOT contain the query, so scoring has to fall
  // all the way through to the loose fields.
  const rec = {
    name: "cs",
    loose: [
      { text: "computer_science_bscs_(boston)", penalty: 100, slug: true },
      { text: "2026 · computer information science", penalty: 200 },
    ],
  };
  // A slug field matches a spaced query by underscoring it — this is the only
  // way "computer science" reaches a folder named computer_science_….
  const slugHit = score(rec, "computer science");
  assert.ok(slugHit > -Infinity, "the slug variant must match");
  // NOT `slugHit < T.LOOSE`: the penalties (100, 200) are smaller than COV_MAX
  // (400), so the loose sub-tiers overlap LOOSE itself and a well-covered slug
  // hit can outscore a barely-covered mid-word one. That is pre-split
  // arithmetic, unchanged here, and it is only sound because every loose tier
  // sits far below ANY — which is what the bound below actually checks.
  assert.ok(slugHit < T.ANY, "the whole loose band stays under ANY");
  assert.equal(score({ name: "cs", loose: [{ text: "computer_science_bscs_(boston)", penalty: 100 }] },
    "computer science"), -Infinity, "without slug:true the underscore form is not tried");

  // The heavier penalty sorts below the lighter one, for a query that only the
  // second field carries.
  const grpHit = score(rec, "information");
  assert.ok(grpHit > -Infinity);
  assert.ok(grpHit < slugHit, `grp ${grpHit} must sort below slug ${slugHit}`);

  // An empty loose field is skipped rather than matching everything.
  assert.equal(score({ name: "x", loose: [{ text: "", penalty: 100 }] }, "zzz"), -Infinity);
});

test("rankRecords › a mid-word hit is LOOSE, not a prefix", () => {
  const rec = { name: "introduction to philosophy" };
  assert.equal(tierOf(score(rec, "philosophy")), "ORDERED", "a whole word still lands ORDERED");
  assert.equal(tierOf(score(rec, "hilos")), "LOOSE", "mid-word is the floor");
});

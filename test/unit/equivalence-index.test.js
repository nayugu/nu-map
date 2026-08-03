// Equivalence index — program scoping, bundle grouping, atomic application.
//
// The load-bearing behaviours: a stored tier must never over-claim for a
// student whose program does not publish the choice, a bundle must present and
// apply as ONE decision, and a missing index must be indistinguishable from the
// feature not existing.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEquivalenceIndex, programIndexSet, resolvePairTier,
  alternativesFor, hasAlternatives, tierNeedsApproval, tierIsOfferable,
  programAllowedSwaps, readyToApply,
} from "../../src/core/equivalenceIndex.js";
import { applySubstitutions } from "../../src/core/planModel.js";

// Mirrors the real wire shape: PHYS 1151/1161 with a lab and a discussion
// component, one directed business statement, one cross-listing.
const WIRE = {
  generatedAt: "2026-08-03",
  programs: ["bioengineering_bsbioe", "science_writing_minor", "chemical_engineering_bsche"],
  pairs: [
    { a: "PHYS 1151", b: "PHYS 1161", t: "C", s: 61.8, e: { q: 12, p: [1] } },
    { a: "PHYS 1152", b: "PHYS 1162", t: "C", s: 61.7, e: { f: "PHYS 1151|PHYS 1161", r: "lab" } },
    { a: "PHYS 1153", b: "PHYS 1163", t: "C", s: 61.7, e: { f: "PHYS 1151|PHYS 1161", r: "discussion" } },
    { a: "ACCT 1201", b: "ACCT 1209", t: "A", s: 40, e: { s: "counts-as", d: "ACCT 1209", sc: "business minors", ex: "business majors" } },
    { a: "INTL 5100", b: "PPUA 5100", t: "B", s: 33, e: { x: 2 } },
    { a: "LS 6101",   b: "LS 6102",   t: "D", s: 55, e: { q: 22 } },
  ],
};
const IX = buildEquivalenceIndex(WIRE);

// ── graceful absence ────────────────────────────────────────────────

test("index › absent or malformed input yields null, never a throw", () => {
  assert.equal(buildEquivalenceIndex(null), null);
  assert.equal(buildEquivalenceIndex({}), null);
  assert.equal(buildEquivalenceIndex({ pairs: "nope" }), null);
});

test("index › every lookup is safe against a null index", () => {
  assert.deepEqual(alternativesFor(null, "PHYS 1161", new Set()), []);
  assert.equal(hasAlternatives(null, "PHYS 1161", new Set()), false);
  assert.deepEqual([...programIndexSet(null, ["x"])], []);
});

// ── program scoping ─────────────────────────────────────────────────

test("scoping › membership upgrades to tier A", () => {
  const mine = programIndexSet(IX, ["science_writing_minor"]);
  const pair = WIRE.pairs[0];
  assert.deepEqual(resolvePairTier(pair, mine), { tier: "A", scoped: true });
});

test("scoping › a non-member keeps the stored, weaker tier", () => {
  const mine = programIndexSet(IX, ["chemical_engineering_bsche"]);
  assert.deepEqual(resolvePairTier(WIRE.pairs[0], mine), { tier: "C", scoped: false });
});

test("scoping › the SAME pair reads differently for two students", () => {
  // This is the whole point: PHYS 1155/1165 is program-backed by exactly one
  // program in the real data. A global tier A would lie to everybody else.
  const writer = programIndexSet(IX, ["science_writing_minor"]);
  const cheme  = programIndexSet(IX, ["chemical_engineering_bsche"]);
  const forWriter = alternativesFor(IX, "PHYS 1161", writer)[0];
  const forCheme  = alternativesFor(IX, "PHYS 1161", cheme)[0];
  assert.equal(forWriter.tier, "A");
  assert.equal(forWriter.approval, false);
  assert.equal(forCheme.tier, "C");
  assert.equal(forCheme.approval, true);
});

test("scoping › unknown program slugs are ignored, not fatal", () => {
  const mine = programIndexSet(IX, ["not_a_real_program"]);
  assert.equal(mine.size, 0);
  assert.equal(alternativesFor(IX, "PHYS 1161", mine)[0].tier, "C");
});

// ── set rules: the only thing still grouped ──────────────────────────





// ── directed statements ─────────────────────────────────────────────

test("direction › a directed statement only licenses its own direction", () => {
  // "ACCT 1209 counts as ACCT 1201" — 1209 may stand in for 1201, not reverse.
  const from1209 = alternativesFor(IX, "ACCT 1209", new Set());
  assert.equal(from1209.length, 1);
  assert.equal(from1209[0].to, "ACCT 1201");
  assert.equal(from1209[0].tier, "A");
  assert.equal(from1209[0].evidence.scope, "business minors");
  assert.equal(from1209[0].evidence.excludes, "business majors");

  assert.deepEqual(alternativesFor(IX, "ACCT 1201", new Set()), []);
});

// ── tiers ───────────────────────────────────────────────────────────

test("tier › D is excluded unless explicitly requested", () => {
  assert.deepEqual(alternativesFor(IX, "LS 6101", new Set()), []);
  assert.equal(alternativesFor(IX, "LS 6101", new Set(), { includeUnofferable: true }).length, 1);
});

test("tier › cross-listing is B and needs no approval", () => {
  const a = alternativesFor(IX, "INTL 5100", new Set())[0];
  assert.equal(a.tier, "B");
  assert.equal(a.approval, false);
  assert.equal(a.evidence.crossList, 2);
});

test("tier › contract helpers agree with the tier table", () => {
  assert.equal(tierNeedsApproval("C"), true);
  for (const t of ["A", "B", "D"]) assert.equal(tierNeedsApproval(t), false);
  for (const t of ["A", "B", "C"]) assert.equal(tierIsOfferable(t), true);
  assert.equal(tierIsOfferable("D"), false);
});

test("ranking › stronger tier first, then score", () => {
  const wire = {
    programs: [], pairs: [
      { a: "X 1000", b: "X 3000", t: "C", s: 90, e: { q: 9 } },
      { a: "X 1000", b: "X 2000", t: "B", s: 10, e: { x: 2 } },
    ],
  };
  const ix = buildEquivalenceIndex(wire);
  assert.deepEqual(alternativesFor(ix, "X 1000", new Set()).map(a => a.to),
                   ["X 2000", "X 3000"]);
});

// ── atomic application ──────────────────────────────────────────────

test("apply › an ungrouped pair behaves exactly as before", () => {
  const placements = { "PHYS 1161": "fall1" };
  const ep = applySubstitutions(placements, [{ from: "PHYS 1161", to: "PHYS 1151" }]);
  assert.equal(ep["PHYS 1151"], "fall1");
});

test("apply › a group applies only when EVERY from is placed", () => {
  // Cornerstone: GE 1110 + GE 1111 → GE 1501 + GE 1502. Placing one half
  // earns nothing, because the catalog grants the swap for the whole set.
  const sub = [
    { from: "GE 1110", to: "GE 1501", group: "cornerstone" },
    { from: "GE 1111", to: "GE 1502", group: "cornerstone" },
  ];
  const half = applySubstitutions({ "GE 1110": "fall1" }, sub);
  assert.equal(half["GE 1501"], undefined);
  assert.equal(half["GE 1502"], undefined);

  const full = applySubstitutions({ "GE 1110": "fall1", "GE 1111": "spring1" }, sub);
  assert.equal(full["GE 1501"], "fall1");
  assert.equal(full["GE 1502"], "spring1");
});

test("apply › distinct groups are independent", () => {
  const ep = applySubstitutions(
    { "A 1000": "fall1", "B 1000": "fall1" },
    [
      { from: "A 1000", to: "A 2000", group: "g1" },
      { from: "B 1000", to: "B 2000", group: "g2" },
      { from: "C 1000", to: "C 2000", group: "g2" },   // C not placed → g2 blocked
    ]);
  assert.equal(ep["A 2000"], "fall1");
  assert.equal(ep["B 2000"], undefined);
});

test("apply › identical ungrouped pairs never merge into one group", () => {
  // Two unrelated single substitutions must not gate each other.
  const ep = applySubstitutions({ "A 1000": "fall1" },
    [{ from: "A 1000", to: "A 2000" }, { from: "Z 1000", to: "Z 2000" }]);
  assert.equal(ep["A 2000"], "fall1");
  assert.equal(ep["Z 2000"], undefined);
});

test("apply › no substitutions returns the SAME reference", () => {
  const p = { "A 1000": "fall1" };
  assert.equal(applySubstitutions(p, []), p);
});

// ── what my program allows, and when it is actionable ───────────────

test("allowed › lists only swaps the student's own programs publish", () => {
  const mine = programIndexSet(IX, ["science_writing_minor"]);
  const got = programAllowedSwaps(IX, mine);
  assert.equal(got.length, 1);
  assert.equal(got[0].from, "PHYS 1151");
  assert.equal(got[0].to, "PHYS 1161");
  assert.equal(got[0].tier, "A");
  assert.equal(got[0].approval, false);
});

test("allowed › a student in no publishing program sees nothing", () => {
  assert.deepEqual(programAllowedSwaps(IX, programIndexSet(IX, ["chemical_engineering_bsche"])), []);
  assert.deepEqual(programAllowedSwaps(IX, new Set()), []);
  assert.deepEqual(programAllowedSwaps(null, new Set([1])), []);
});


test("ready › true only when every replaced course is placed", () => {
  const alt = { from: "GE 1110", to: "GE 1501",
                components: [{ from: "GE 1111", to: "GE 1502" }] };
  assert.equal(readyToApply(alt, id => id === "GE 1110"), false);
  assert.equal(readyToApply(alt, id => ["GE 1110", "GE 1111"].includes(id)), true);
  assert.equal(readyToApply(alt, undefined), false);
});

test("set rule › footnote siblings are ONE decision, applied atomically", () => {
  // "substitute GE 1110 AND GE 1111 for GE 1501 AND GE 1502". Emitted as two
  // independent pairs, applying one would grant GE 1501 from GE 1110 alone.
  const wire = {
    programs: ["bioe"],
    pairs: [
      { a: "GE 1110", b: "GE 1501", t: "A", s: 30, e: { p: [0], s: "footnote" } },
      { a: "GE 1111", b: "GE 1502", t: "A", s: 29,
        e: { p: [0], s: "footnote", f: "GE 1110|GE 1501", r: "set" } },
    ],
  };
  const ix = buildEquivalenceIndex(wire);
  const mine = programIndexSet(ix, ["bioe"]);
  const got = programAllowedSwaps(ix, mine);
  assert.equal(got.length, 1, "one decision, not two rows");
  assert.deepEqual(got[0].components.map(c => `${c.from}>${c.to}`), ["GE 1111>GE 1502"]);

  const group = "g";
  const subs = [{ from: got[0].from, to: got[0].to, group },
                ...got[0].components.map(c => ({ from: c.from, to: c.to, group }))];
  assert.equal(applySubstitutions({ "GE 1110": "f1" }, subs)["GE 1501"], undefined,
               "half the set earns nothing");
  const full = applySubstitutions({ "GE 1110": "f1", "GE 1111": "s1" }, subs);
  assert.equal(full["GE 1501"], "f1");
  assert.equal(full["GE 1502"], "s1");
});

test("applied › a swap already in the plan is not offered again", () => {
  // Applying a set rule also adds its siblings. Offering one of those again
  // produced a row whose click was a correct no-op, which reads as broken.
  const applied = new Set(["GE 1111>GE 1502"]);
  const notApplied = alt => !applied.has(`${alt.from}>${alt.to}`);
  const alts = [{ from: "GE 1111", to: "GE 1502" }, { from: "GE 1110", to: "GE 1501" }];
  assert.deepEqual(alts.filter(notApplied).map(a => a.from), ["GE 1110"]);
});

test("standalone › a lab swap is its own decision, not a component", () => {
  // 30 of 31 bundle links were lab/recitation propagation. A lab and its lecture
  // are separate registrations, so the swap stands alone — which removes head
  // resolution, side orientation and the component-lookup special case.
  const wire = { programs: [], pairs: [
    { a: "PHYS 1151", b: "PHYS 1161", t: "C", s: 62, e: { q: 12 } },
    { a: "PHYS 1152", b: "PHYS 1162", t: "C", s: 61, e: { q: 0 } },
  ]};
  const ix = buildEquivalenceIndex(wire);
  const lab = alternativesFor(ix, "PHYS 1162", new Set());
  assert.equal(lab.length, 1);
  assert.equal(lab[0].to, "PHYS 1152");
  assert.equal(lab[0].components.length, 0, "no grouping");
  // and the lecture no longer drags it along
  assert.equal(alternativesFor(ix, "PHYS 1161", new Set())[0].components.length, 0);
});

test("set rule › a sibling still resolves to the head, applied atomically", () => {
  const wire = { programs: ["bioe"], pairs: [
    { a: "GE 1110", b: "GE 1501", t: "A", s: 30, e: { p: [0], s: "footnote" } },
    { a: "GE 1111", b: "GE 1502", t: "A", s: 29,
      e: { p: [0], s: "footnote", f: "GE 1110|GE 1501", r: "set" } },
  ]};
  const ix = buildEquivalenceIndex(wire);
  const viaSibling = alternativesFor(ix, "GE 1111", new Set());
  assert.equal(viaSibling.length, 1);
  assert.equal(viaSibling[0].from, "GE 1110");
  assert.deepEqual(viaSibling[0].components.map(c => `${c.from}>${c.to}`), ["GE 1111>GE 1502"]);
});

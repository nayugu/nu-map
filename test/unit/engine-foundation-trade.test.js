// UNIT · src/engine/objective.js `tradeFoundations` — a foundation and a terminal course swap.
//
// This operator exists because no other one could reach the exchange it makes: `tradeDepth` is
// pool↔flat, `reclaimFromFiller` is bounded↔filler, and the one-cell climber cannot move a
// course into a term that is already at its credit target. The swap that fixes a business degree
// with calculus in Year 4 is between two ORDINARY NAMED CELLS, and nothing was looking for it.
//
// It has also produced two regressions in one session, which is why these tests are hostile
// rather than confirming. Both are pinned below:
//
//   1. it sent `INTB 1203`, the gateway course of the degree, to Year 4 so calculus could come
//      forward — major depth spent on foundationality;
//   2. it sent `CS 1800 and CS 1802` from Year 2 to YEAR 4 in a computer-engineering degree,
//      where CS is not a "major subject", because nothing bounded how far the DISPLACED cell
//      could be pushed. 82 catalog courses are built on CS 1800.
//
// The second one is the sharper lesson: the guard's own comment claimed both ends were checked
// and the code checked one. So these tests assert the guards from the outside, where a comment
// cannot be the thing under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeFoundations } from "../../src/engine/objective.js";

const course = (id, sh = 4, extra = {}) => ({
  id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh, ...extra,
});
const mapOf = (...cs) => Object.fromEntries(cs.map(c => [c.id, c]));

/** A cell that names one course, placeable anywhere by default. */
const named = (id, ids, domain) => ({
  cell: { id, kind: "named", groups: [ids], sh: 4, title: id },
  candidates: [...ids],
  domain,
});
const TERMS = Array.from({ length: 8 }, (_, i) => ({ label: `T${i}`, weight: 1, targetSH: 16 }));
const ALL = TERMS.map((_, i) => i);
const CAP = TERMS.map(() => 99);
const yes = () => true;

// ── The fixture has to PIN the major, or the tests test nothing ─────
//
// `majorSubjectsOf` needs three cells in a subject to call it a major and otherwise falls back
// to the MODAL subject — so in a two-cell fixture one of the two cells is always "the major",
// and the major guard blocks every trade before any other guard is reached.
//
// That is not a hypothetical. The first version of this file was written that way, passed all
// nine tests, and passed all nine again with BOTH guards deleted: each test was being stopped by
// whichever guard was left, so neither could ever be shown to matter. Mutation testing caught it;
// nothing else would have.
//
// So every fixture carries three MAJ cells, which makes MAJ the major and leaves the courses
// under test non-major. They are pinned to term 7 with a domain of exactly [7], so they can
// never take part in a trade themselves: as `early` they are major and skipped, and as `late`
// their domain excludes every earlier term.
const PAD = () => [
  named("pad1", ["MAJ2001"], [7]), named("pad2", ["MAJ2002"], [7]), named("pad3", ["MAJ2003"], [7]),
];
const PAD_AT = { pad1: 7, pad2: 7, pad3: 7 };
const PAD_COURSES = [course("MAJ2001"), course("MAJ2002"), course("MAJ2003")];

/** unlock map: how much of the catalog rests on each course. */
const unlocks = (o) => new Map(Object.entries(o));

test("foundation trade › a foundation and a terminal course change places", () => {
  // The case the operator exists for: FOUND1000 is needed by 100 courses and sits late; JUNK4000
  // is needed by none and sits early. Nothing else in the engine can make this exchange.
  const courseMap = mapOf(...PAD_COURSES, course("FOUND1000"), course("JUNK4000"));
  const plans = [...PAD(), named("a", ["JUNK4000"], ALL), named("b", ["FOUND1000"], ALL)];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 6]]);
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    catalogUnlock: unlocks({ FOUND1000: 100, JUNK4000: 0 }),
  });
  assert.equal(out.moves, 1);
  assert.equal(out.termOf.get("b"), 1, "the foundation should take the early term");
  assert.equal(out.termOf.get("a"), 6, "the terminal course takes the late one");
});

test("foundation trade › a 1000-level course is NEVER pushed past its convention", () => {
  // The `CS 1800` regression, in miniature. Both cells are 1000-level, so both belong early —
  // and trading them moves the displaced one to a term its own level forbids. The swap must be
  // refused outright rather than made because one number is bigger than the other.
  const courseMap = mapOf(...PAD_COURSES, course("AAA1000"), course("BBB1000"));
  const plans = [...PAD(), named("a", ["AAA1000"], ALL), named("b", ["BBB1000"], ALL)];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 7]]);
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    // BBB is more foundational, so the ONLY thing that can stop the trade is the guard.
    catalogUnlock: unlocks({ AAA1000: 82, BBB1000: 300 }),
  });
  assert.equal(out.moves, 0,
    "a 1000-level course was pushed to the last term to make room for another one");
  assert.equal(out.termOf.get("a"), 1);
});

test("foundation trade › MAJOR depth is never spent on foundationality", () => {
  // The `INTB 1203` regression. `majorSubjectsOf` picks the modal subject when nothing reaches
  // three cells, so MAJ is the major here; its course must not be displaced however much the
  // incoming one unlocks.
  // 4000-level, deliberately: a 1000-level major course would be blocked by the DISPLACED-CELL
  // convention guard before the major guard was ever consulted, and the test would then pass
  // with the major guard deleted — which is exactly how the first version of this file fooled
  // itself. At 4000-level the convention permits the move, so the ONLY thing that can refuse it
  // is the rule under test.
  const courseMap = mapOf(...PAD_COURSES, course("MAJ4000"), course("OTH1000"));
  const plans = [...PAD(), named("a", ["MAJ4000"], ALL), named("b", ["OTH1000"], ALL)];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 0], ["b", 6]]);
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    catalogUnlock: unlocks({ MAJ4000: 1, OTH1000: 900 }),
  });
  assert.equal(out.moves, 0, "the major's own course was displaced");
});

test("foundation trade › never trades DOWN", () => {
  // The direction is the whole rule. A less-foundational course must not be pulled ahead of a
  // more-foundational one, whatever else is true.
  const courseMap = mapOf(...PAD_COURSES, course("HIGH1000"), course("LOW1000"));
  const plans = [...PAD(), named("a", ["HIGH1000"], ALL), named("b", ["LOW1000"], ALL)];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 5]]);
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    catalogUnlock: unlocks({ HIGH1000: 500, LOW1000: 3 }),
  });
  assert.equal(out.moves, 0);
});

test("foundation trade › an ILLEGAL swap is skipped, never forced", () => {
  // Every mutation in phase 2 is verified by `fullLegal`, which carries the witness, precedence,
  // availability and the thin-term budget. A pass that could override it would turn a verified
  // plan into an unfollowable one.
  const courseMap = mapOf(...PAD_COURSES, course("FOUND1000"), course("JUNK4000"));
  const plans = [...PAD(), named("a", ["JUNK4000"], ALL), named("b", ["FOUND1000"], ALL)];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 6]]);
  // ── The verdict AND the fact that it was ASKED ────────────────────
  //
  // Asserting `moves === 0` alone does not test this guard, and mutation testing proved it:
  // delete the `fullLegal` check and all nine tests still passed, because `fitsCapacity` runs
  // first and refuses this arrangement anyway. A test that cannot tell which of two guards
  // stopped it is not testing either.
  //
  // So the spy is the assertion. If the check is ever removed, `fullLegal` is never consulted
  // and this fails on `asked` regardless of what else happens to refuse the swap.
  let asked = 0;
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: () => { asked += 1; return false; }, courseMap,
    catalogUnlock: unlocks({ FOUND1000: 100, JUNK4000: 0 }),
  });
  assert.ok(asked > 0, "the swap was decided without ever consulting `fullLegal`");
  assert.equal(out.moves, 0);
  assert.deepEqual([...out.termOf], [...termOf], "the original assignment must come back intact");
});

test("foundation trade › a term outside a cell's DOMAIN is never used", () => {
  // The domain is where availability, prerequisites and the co-op shape have already spoken.
  // Phase 2 may reorder within it and may not step outside it.
  const courseMap = mapOf(...PAD_COURSES, course("FOUND1000"), course("JUNK4000"));
  const plans = [...PAD(),
    named("a", ["JUNK4000"], ALL),
    named("b", ["FOUND1000"], [5, 6, 7]),      // cannot go early at all
  ];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 6]]);
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    catalogUnlock: unlocks({ FOUND1000: 100, JUNK4000: 0 }),
  });
  assert.equal(out.moves, 0, "the foundation is not offered in term 1 and must stay put");
});

test("foundation trade › no catalog index means no opinion", () => {
  // The index is injected, and a caller without one must get its plan back untouched rather
  // than a pass that silently scores everything zero and trades on ties.
  const courseMap = mapOf(...PAD_COURSES, course("FOUND1000"), course("JUNK4000"));
  const plans = [...PAD(), named("a", ["JUNK4000"], ALL), named("b", ["FOUND1000"], ALL)];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 6]]);
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap, catalogUnlock: null,
  });
  assert.equal(out.moves, 0);
});

test("foundation trade › it TERMINATES and is idempotent", () => {
  // Φ = Σ unlock·index strictly decreases on every accepted swap, so the pass cannot cycle.
  // Running it twice must therefore change nothing the second time — which is the property a
  // reader can actually check, unlike the algebra.
  const courseMap = mapOf(...PAD_COURSES,
    course("F1000"), course("G1000"), course("H4000"), course("J4000"));
  const plans = [...PAD(),
    named("a", ["H4000"], ALL), named("b", ["F1000"], ALL),
    named("c", ["J4000"], ALL), named("d", ["G1000"], ALL),
  ];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 0], ["b", 5], ["c", 1], ["d", 6]]);
  const ctx = {
    plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
    catalogUnlock: unlocks({ F1000: 300, G1000: 200, H4000: 1, J4000: 2 }),
  };
  const once = tradeFoundations(termOf, ctx);
  const twice = tradeFoundations(once.termOf, ctx);
  assert.equal(twice.moves, 0, "a second pass found more to do — the first did not reach a fixpoint");
  assert.deepEqual([...once.termOf].sort(), [...twice.termOf].sort());
  // And every cell still holds exactly one term: a swap must not lose or duplicate a placement.
  // Seven cells: the four under test plus the three pinned MAJ padders, which share term 7 by
  // construction. So the invariant is that every cell still HOLDS a term and the four cells
  // under test still occupy four distinct ones — not that all seven are distinct.
  assert.equal(once.termOf.size, 7, "a swap lost or invented a placement");
  const under = ["a", "b", "c", "d"].map(k => once.termOf.get(k));
  assert.ok(under.every(v => v != null), "a cell under test lost its term");
  assert.equal(new Set(under).size, 4, "two cells under test ended up in one term");
});

test("foundation trade › malformed input does not throw", () => {
  // This runs inside `improve`, where a throw is a refused plan for a reason no student can act
  // on. Pools carry no groups; a cell may be missing from `termOf` entirely.
  const courseMap = mapOf(...PAD_COURSES, course("F1000"));
  for (const plans of [
    [],
    [{ cell: { id: "x", kind: "open" }, candidates: null, domain: ALL }],
    [named("a", ["F1000"], ALL), { cell: { id: "y", kind: "open" }, candidates: null, domain: ALL }],
    [named("a", ["GONE9999"], ALL), named("b", ["F1000"], ALL)],
  ]) {
    assert.doesNotThrow(() => tradeFoundations(new Map([["a", 1]]), {
      plans, terms: TERMS, cap: CAP, fullLegal: yes, courseMap,
      catalogUnlock: unlocks({ F1000: 10 }),
    }), JSON.stringify(plans.map(p => p.cell.id)));
  }
});

test("foundation trade › an UNEQUAL swap may not overflow the receiving term", () => {
  // Mutation testing found `fitsCapacity` untested here, and the reason is worth recording: every
  // other fixture swaps two 4 SH cells, so the exchange is credit-neutral and capacity can never
  // discriminate. Real swaps are not neutral — `CS 1800 and CS 1802` is one 5 SH cell, because a
  // corequisite group is scheduled as a unit — so the case that actually occurs was the one case
  // not covered.
  //
  // Term 1 is at 15 of 16; the foundation is 5 SH against the terminal course's 4, so the trade
  // would put it at 16... which fits. Term 1 is therefore capped at 15 here to make the overflow
  // exact rather than approximate.
  const courseMap = mapOf(...PAD_COURSES, course("FOUND1000", 5), course("JUNK4000", 4));
  const plans = [...PAD(),
    { cell: { id: "a", kind: "named", groups: [["JUNK4000"]], sh: 4, title: "a" },
      candidates: ["JUNK4000"], domain: ALL },
    { cell: { id: "b", kind: "named", groups: [["FOUND1000"]], sh: 5, title: "b" },
      candidates: ["FOUND1000"], domain: ALL }];
  const termOf = new Map([...Object.entries(PAD_AT), ["a", 1], ["b", 6]]);
  const tight = TERMS.map((_, i) => (i === 1 ? 4 : 99));
  const out = tradeFoundations(termOf, {
    plans, terms: TERMS, cap: tight, fullLegal: yes, courseMap,
    catalogUnlock: unlocks({ FOUND1000: 100, JUNK4000: 0 }),
  });
  assert.equal(out.moves, 0, "a 5 SH cell was moved into a term that holds 4");
  assert.equal(out.termOf.get("b"), 6);
});

// UNIT · coreqPartnersOf — who must move when a card moves.
//
// This exists because the rule had six hand-written copies and one of them was
// missing: the cross-semester SWAP carried the dragged card's corequisites and
// left the displaced card's behind. A shared function can be attacked once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { coreqPartnersOf, extractEdges } from "../../src/core/courseModel.js";

const coreq = (from, to) => ({ from, to, type: "corequisite" });
const prereq = (from, to) => ({ from, to, type: "prerequisite" });

test("coreq partners › finds the partner from either side of the edge", () => {
  const edges = [coreq("CS3001", "CS3000")];
  // Declared one-way in the catalog (19 real pairs are), so both directions
  // must resolve or the pull works in one drag direction only.
  assert.deepEqual(coreqPartnersOf(edges, "CS3000"), ["CS3001"]);
  assert.deepEqual(coreqPartnersOf(edges, "CS3001"), ["CS3000"]);
});

test("coreq partners › ignores prerequisite edges entirely", () => {
  const edges = [prereq("CS2500", "CS3000"), coreq("CS3001", "CS3000")];
  assert.deepEqual(coreqPartnersOf(edges, "CS3000"), ["CS3001"]);
  // A prereq is a constraint on ORDER, not on togetherness. Carrying one would
  // drag half a degree across the board.
  assert.deepEqual(coreqPartnersOf(edges, "CS2500"), []);
});

test("coreq partners › never returns the card itself", () => {
  // A self-edge is malformed data, not a reason to move a card onto itself.
  assert.deepEqual(coreqPartnersOf([coreq("CS3000", "CS3000")], "CS3000"), []);
});

test("coreq partners › de-duplicates a pair declared on both sides", () => {
  const edges = [coreq("CS3001", "CS3000"), coreq("CS3000", "CS3001")];
  assert.deepEqual(coreqPartnersOf(edges, "CS3000"), ["CS3001"]);
});

test("coreq partners › excludes ids already claimed by another group", () => {
  // The swap case: the dragged card's group is spoken for, so the displaced
  // card must not try to drag one of its members back the other way.
  const edges = [coreq("LAB1", "A"), coreq("LAB1", "B")];
  assert.deepEqual(coreqPartnersOf(edges, "B", ["A", "LAB1"]), []);
});

test("coreq partners › a chain IS followed to the end of the group", () => {
  // This test previously asserted the opposite — that a chain is not followed
  // — on the reasoning that nothing in the catalog needs it. That was wrong,
  // and the drop fuzzer found it. The live catalog holds three chains where
  // the two ends do not name each other (GSND 5110–5111–5112, NRSG
  // 2220–2221–2222, NRSG 4889–4996–4995); carrying only the neighbours moved
  // the middle and left the far end behind, splitting a group that has to be
  // taken in one term. Groups are 3 courses at the largest, so the walk is
  // bounded by the data.
  const edges = [coreq("B", "A"), coreq("C", "B")];
  assert.deepEqual(coreqPartnersOf(edges, "A").sort(), ["B", "C"]);
  assert.deepEqual(coreqPartnersOf(edges, "C").sort(), ["A", "B"]);
  assert.deepEqual(coreqPartnersOf(edges, "B").sort(), ["A", "C"]);
});

test("coreq partners › the walk does not pass THROUGH an excluded id", () => {
  // Exclusion means "already moving with the other card". Walking through one
  // would reach into that group and drag its members the wrong way.
  const edges = [coreq("B", "A"), coreq("C", "B")];
  assert.deepEqual(coreqPartnersOf(edges, "A", ["B"]), []);
});

test("coreq partners › a cycle terminates", () => {
  // A triangle is the ordinary CHEM shape (lecture, lab, recitation each
  // naming the other two): 20 of them in the corpus.
  const edges = [coreq("A", "B"), coreq("B", "C"), coreq("C", "A")];
  assert.deepEqual(coreqPartnersOf(edges, "A").sort(), ["B", "C"]);
});

test("coreq partners › survives junk input", () => {
  assert.deepEqual(coreqPartnersOf(null, "A"), []);
  assert.deepEqual(coreqPartnersOf([], "A"), []);
  assert.deepEqual(coreqPartnersOf([coreq("A", "B")], null), []);
  assert.deepEqual(coreqPartnersOf([{ type: "corequisite" }], "A"), []);
});

test("coreq partners › agrees with the edges extractEdges actually builds", () => {
  // End to end on the real shape: a catalog coreq record → edge → partner.
  const edges = extractEdges("CS3000", null, [{ subject: "cs", number: "3001" }]);
  assert.deepEqual(coreqPartnersOf(edges, "CS3000"), ["CS3001"]);
  assert.deepEqual(coreqPartnersOf(edges, "CS3001"), ["CS3000"]);
});

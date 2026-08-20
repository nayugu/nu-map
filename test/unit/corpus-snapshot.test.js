// UNIT · scripts/lib/corpus-snapshot.js — the saved plans every ad-hoc question now reads.
//
// The point of the snapshot is that a question costs a second instead of a sweep. The risk is
// that it answers CONFIDENTLY about plans that are not what it claims: a dropped cell, a
// flattened course list, or a staleness check that fails to fire. All three produce a
// plausible number rather than an error, and a plausible wrong number is the failure this
// project is organised against — so these tests go after exactly those.
import { test } from "node:test";
import assert from "node:assert/strict";
import { structurePlan, planList, plansWith, positionsOf, termsWhere, cellsWhere,
         diffSnapshots } from "../../scripts/lib/corpus-snapshot.js";

/** A two-year plan with a co-op, a nested child and a multi-option cell. */
const plan = {
  years: [
    { label: "Year 1", terms: [
      { term: "Fall", type: "fall", entries: [
        { text: "CS 2500", sh: 4, options: [["CS2500"]] },
        { text: "Writing", sh: 4, options: [["ENGW1111"], ["ENGW1102"]] },
      ] },
      { term: "Spring", type: "spring", entries: [
        { text: "Group", sh: 5, options: [["BIOL1107", "BIOL1108"]],
          children: [{ text: "Lab", sh: 1, options: [["BIOL1109"]] }] },
      ] },
    ] },
    { label: "Year 2", terms: [
      { term: "Fall", type: "fall", entries: [{ text: "Co-op", sh: 0, coop: true }] },
      { term: "Spring", type: "spring", entries: [
        { text: "CS 4530", sh: 4, options: [["CS4530"]] },
      ] },
    ] },
  ],
};

test("every cell survives structuring, including nested children", () => {
  // A dropped child cell makes every plan look tidier than it is, and nothing would flag it.
  const s = structurePlan(plan);
  assert.equal(s.termCount, 4);
  assert.equal(s.cells.length, 6, "5 top-level entries (incl. the co-op) plus 1 nested child");
  assert.ok(s.cells.some(c => c.text === "Lab" && c.depth === 1), "the nested Lab must be kept");
  assert.equal(s.terms.reduce((n, t) => n + t.cells.length, 0), s.cells.length,
    "the flat cell list and the per-term lists must agree");
});

test("a co-op is kept and labelled, not silently dropped as a course-less cell", () => {
  const s = structurePlan(plan);
  const coop = s.cells.find(c => c.kind === "COOP");
  assert.ok(coop, "a co-op term is part of the shape and must appear");
  assert.deepEqual(coop.courses, [], "and it names no course");
});

test("courses flatten across OR and AND groups without losing either", () => {
  const s = structurePlan(plan);
  const writing = s.cells.find(c => c.text === "Writing");
  assert.deepEqual(writing.courses.sort(), ["ENGW1102", "ENGW1111"], "an OR yields both");
  const group = s.cells.find(c => c.text === "Group");
  assert.deepEqual(group.courses.sort(), ["BIOL1107", "BIOL1108"], "an AND yields both");
  // The structure is kept alongside the flat list, so a question that needs "these two
  // together" can still ask it.
  assert.deepEqual(group.options, [["BIOL1107", "BIOL1108"]]);
});

test("every cell carries the term it sits in, so position is one filter", () => {
  const s = structurePlan(plan);
  const late = s.cells.find(c => c.text === "CS 4530");
  assert.equal(late.termIndex, 3);
  assert.equal(late.termType, "spring");
  assert.equal(late.year, "Year 2");
});

const snap = (plans) => ({ meta: {}, plans });
const wrap = (label, p) => ({ [label]: { hash: "h" + label, plan: structurePlan(p) } });

test("positionsOf is a FRACTION of plan length, so plans of different lengths compare", () => {
  // Absolute term index cannot compare a 2-year master's with a 5-year co-op degree, and
  // comparing them anyway is how a position claim gets quoted wrongly.
  const short = { years: [{ label: "Y1", terms: [
    { term: "Fall", type: "fall", entries: [{ text: "x", options: [["CS4530"]] }] },
    { term: "Spring", type: "spring", entries: [] }] }] };
  const plans = planList(snap({ ...wrap("long", plan), ...wrap("short", short) }));
  const pos = positionsOf(plans, "CS4530");
  const byLabel = Object.fromEntries(pos.map(p => [p.label, p.at]));
  assert.equal(byLabel.long, 1, "last of 4 terms is the end of the plan");
  assert.equal(byLabel.short, 0, "first of 2 terms is the start");
});

test("a single-term plan does not divide by zero", () => {
  const one = { years: [{ label: "Y1", terms: [
    { term: "Fall", type: "fall", entries: [{ text: "x", options: [["CS2500"]] }] }] }] };
  const pos = positionsOf(planList(snap(wrap("one", one))), "CS2500");
  assert.equal(pos[0].at, 0, "must be 0, not NaN or Infinity");
});

test("plansWith, termsWhere and cellsWhere all carry the label back", () => {
  // A result you cannot attribute to a program is the thing that made three hypotheses
  // untestable — "3 got worse" without naming them.
  const plans = planList(snap(wrap("ug/a", plan)));
  assert.deepEqual(plansWith(plans, "CS2500").map(p => p.label), ["ug/a"]);
  assert.deepEqual(plansWith(plans, "NOPE0000"), []);
  assert.ok(termsWhere(plans, t => t.cells.length > 1).every(t => t.label === "ug/a"));
  assert.ok(cellsWhere(plans, c => c.sh >= 4).every(c => c.label === "ug/a"));
  assert.equal(cellsWhere(plans, c => c.kind === "COOP").length, 1);
});

test("diffSnapshots separates a course CHANGE from a pure rearrangement", () => {
  // These need different reactions: a different course set is a coverage change, the same set
  // in a different order is a sequencing change. One number cannot tell them apart, and that
  // ambiguity is what a second full sweep used to be spent resolving.
  const moved = JSON.parse(JSON.stringify(plan));
  moved.years[0].terms[0].entries[0].text = "CS 2500 moved";   // same course, new arrangement
  const swapped = JSON.parse(JSON.stringify(plan));
  swapped.years[0].terms[0].entries[0].options = [["CS3000"]]; // different course

  const before = snap({ ...wrap("a", plan), ...wrap("b", plan), ...wrap("gone", plan) });
  const after = { meta: {}, plans: {
    a: { hash: "different", plan: structurePlan(moved) },
    b: { hash: "different2", plan: structurePlan(swapped) },
    fresh: { hash: "h", plan: structurePlan(plan) },
  } };

  const d = diffSnapshots(before, after);
  assert.deepEqual(d.gained, ["fresh"]);
  assert.deepEqual(d.lost, ["gone"]);
  const byLabel = Object.fromEntries(d.moved.map(m => [m.label, m]));
  assert.deepEqual(byLabel.a.appeared, [], "a rearrangement adds no course");
  assert.deepEqual(byLabel.a.vanished, [], "and loses none");
  assert.deepEqual(byLabel.b.appeared, ["CS3000"]);
  assert.deepEqual(byLabel.b.vanished, ["CS2500"]);
});

test("an unchanged plan counts as same, not as moved", () => {
  const s = snap(wrap("a", plan));
  const d = diffSnapshots(s, s);
  assert.equal(d.same, 1);
  assert.equal(d.moved.length, 0);
});

test("an empty or malformed plan structures to nothing rather than throwing", () => {
  // These come from a scrape. A program whose plan failed to build must not take down the
  // snapshot and with it every saved question.
  for (const bad of [null, undefined, {}, { years: null }, { years: [{}] },
                     { years: [{ terms: [{}] }] }]) {
    const s = structurePlan(bad);
    assert.ok(Array.isArray(s.cells), `structurePlan(${JSON.stringify(bad)}) must return cells`);
  }
});

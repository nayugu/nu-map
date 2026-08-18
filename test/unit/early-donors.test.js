/**
 * early-donors.test.js — what a borrowed plan must refuse to borrow.
 *
 * The single property everything else rests on is that a donor is asked WHEN and
 * never WHAT: it cannot introduce a course the target does not require. Everything
 * dangerous about learning from another program lives in that one line.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  requiredBySubject, similarity, clustersOf, pickDonors, borrowEarlyPlan,
  MIN_CLUSTER,
} from "../../scripts/lib/early-donors.js";

const course = (subject, classId) => ({ type: "COURSE", subject, classId });
/** A program whose requirements are a flat list of the courses given. */
const program = (...keys) => ({
  requirementSections: [{ type: "SECTION", requirements: keys.map(k => {
    const m = /^([A-Z]+)(\d+)$/.exec(k);
    return course(m[1], Number(m[2]));
  }) }],
});
/** A donor: required courses plus the first terms of its published plan. */
const donor = (name, keys, terms) => ({
  name, base: name,
  bySubject: requiredBySubject(program(...keys)),
  early: terms.map(t => new Set(t)),
});

test("donors › requirements are found at any nesting depth", () => {
  const nested = { requirementSections: [{ type: "SECTION", requirements: [
    { type: "AND", courses: [course("CS", 1800), course("CS", 1802)] },
    { type: "OR", courses: [course("MATH", 1341)] },
    { type: "SECTION", sections: [{ requirements: [course("BIOL", 2301)] }] },
  ] }] };
  const by = requiredBySubject(nested);
  assert.deepEqual([...(by.get("CS") ?? [])].sort(), ["CS1800", "CS1802"]);
  assert.deepEqual([...(by.get("MATH") ?? [])], ["MATH1341"]);
  assert.deepEqual([...(by.get("BIOL") ?? [])], ["BIOL2301"], "found under a nested section");
});

test("donors › similarity penalises a donor's EXTRA requirements", () => {
  // The governing example: against a 6-course cluster, a 10-course program
  // covering all 6 must lose to a 5-course one matching 5. Overlap alone would
  // rank them the other way round.
  const ours = new Set(["B1", "B2", "B3", "B4", "B5", "B6"]);
  const sprawling = new Set(["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10"]);
  const tight = new Set(["B1", "B2", "B3", "B4", "B5"]);
  assert.equal(similarity(ours, sprawling).toFixed(2), "0.60");
  assert.equal(similarity(ours, tight).toFixed(2), "0.83");
  assert.ok(similarity(ours, tight) > similarity(ours, sprawling));
});

test("donors › a subject too thin to be a cluster is not matched on", () => {
  const by = requiredBySubject(program("CS1800", "CS1802", "CS2000", "PHIL1101"));
  assert.deepEqual(clustersOf(by), ["CS"], `PHIL has fewer than ${MIN_CLUSTER} courses`);
});

test("donors › borrows the donor's TIMING, never its courses", () => {
  // The donor requires XX3000 and places it in term 1. The target does not
  // require it, so it must not appear — a borrowed plan that adds coursework is
  // the one outcome that cannot be allowed.
  const target = { name: "T", base: "T",
                   bySubject: requiredBySubject(program("XX1000", "XX1100", "XX1200")) };
  const pool = [donor("D", ["XX1000", "XX1100", "XX1200", "XX3000"],
                      [["XX1000", "XX3000"], ["XX1100"]])];
  const plan = borrowEarlyPlan(target, pickDonors(target, pool));
  const placed = plan.years.flatMap(y => y.terms.flatMap(t => t.entries.map(e => e.options[0][0])));
  assert.deepEqual(placed.sort(), ["XX1000", "XX1100"]);
  assert.equal(placed.includes("XX3000"), false, "the donor cannot add a course");
});

test("donors › a course the donor never places is left to the search", () => {
  const target = { name: "T", base: "T",
                   bySubject: requiredBySubject(program("XX1000", "XX1100", "XX1200")) };
  // XX1200 appears nowhere in the donor's early terms.
  const pool = [donor("D", ["XX1000", "XX1100", "XX1200"], [["XX1000"], ["XX1100"]])];
  const plan = borrowEarlyPlan(target, pickDonors(target, pool));
  const placed = plan.years.flatMap(y => y.terms.flatMap(t => t.entries.map(e => e.options[0][0])));
  assert.equal(placed.includes("XX1200"), false, "absent, not guessed at");
});

test("donors › a weak match is declined, leaving today's behaviour", () => {
  const target = { name: "T", base: "T",
                   bySubject: requiredBySubject(program("XX1000", "XX1100", "XX1200")) };
  // One course in common out of nine: Jaccard 0.11, well under the floor.
  const pool = [donor("D", ["XX1000", "YY1", "YY2", "YY3", "YY4", "YY5", "YY6", "YY7"],
                      [["XX1000"], []])];
  assert.deepEqual(pickDonors(target, pool), []);
  assert.equal(borrowEarlyPlan(target, []), null, "no plan, rather than an empty one");
});

test("donors › a single shared course is never a structure to learn from", () => {
  const target = { name: "T", base: "T",
                   bySubject: requiredBySubject(program("XX1000", "XX1100", "XX1200")) };
  // The donor has exactly ONE course in the subject, so similarity could be high
  // by accident. `pickDonors` requires at least two before believing it.
  const pool = [donor("D", ["XX1000"], [["XX1000"]])];
  assert.deepEqual(pickDonors(target, pool), []);
});

test("donors › each cluster is matched independently", () => {
  // The point of the design: the CS half and the BIO half learn from different
  // programs, and neither is a compromise between them.
  const target = { name: "T", base: "T", bySubject: requiredBySubject(
    program("CS1000", "CS1100", "CS1200", "BIO1000", "BIO1100", "BIO1200")) };
  const pool = [
    donor("CS-ish", ["CS1000", "CS1100", "CS1200", "ZZ1"], [["CS1000"], ["CS1100"]]),
    donor("BIO-ish", ["BIO1000", "BIO1100", "BIO1200", "ZZ2"], [["BIO1000"], ["BIO1100"]]),
  ];
  const picked = pickDonors(target, pool);
  assert.deepEqual(
    picked.map(p => [p.subject, p.donor.name]).sort(),
    [["BIO", "BIO-ish"], ["CS", "CS-ish"]]);
  const plan = borrowEarlyPlan(target, picked);
  const t1 = plan.years[0].terms[0].entries.map(e => e.options[0][0]).sort();
  assert.deepEqual(t1, ["BIO1000", "CS1000"], "both halves contribute to term 1");
});

test("donors › a program never learns from its own other campus when validating", () => {
  const target = { name: "T (Boston)", base: "T",
                   bySubject: requiredBySubject(program("XX1000", "XX1100", "XX1200")) };
  const twin = donor("T (Oakland)", ["XX1000", "XX1100", "XX1200"], [["XX1000"], []]);
  twin.base = "T";
  assert.deepEqual(pickDonors(target, [twin], { excludeSameBase: true }), []);
  // ...but in production the twin is the ideal teacher, so it is allowed.
  assert.equal(pickDonors(target, [twin]).length, 1);
});

test("donors › a course borrowed twice keeps its earliest term", () => {
  // Two clusters can name one cross-listed course. Placing it in both terms would
  // schedule one registration twice.
  const target = { name: "T", base: "T",
                   bySubject: requiredBySubject(program("AA1", "AA2", "AA3", "BB1", "BB2", "BB3")) };
  const pool = [
    donor("D1", ["AA1", "AA2", "AA3"], [["AA1"], ["AA1", "AA2"]]),
    donor("D2", ["BB1", "BB2", "BB3"], [["BB1"], ["BB2"]]),
  ];
  const plan = borrowEarlyPlan(target, pickDonors(target, pool));
  const all = plan.years.flatMap(y => y.terms.flatMap(t => t.entries.map(e => e.options[0][0])));
  assert.equal(all.filter(k => k === "AA1").length, 1);
  assert.equal(plan.years[0].terms[0].entries.some(e => e.options[0][0] === "AA1"), true);
});

test("donors › an empty pool or program is not a throw", () => {
  const target = { name: "T", base: "T", bySubject: requiredBySubject(program("XX1000")) };
  assert.deepEqual(pickDonors(target, []), []);
  assert.deepEqual(requiredBySubject(null).size, 0);
  assert.deepEqual(requiredBySubject({}).size, 0);
  assert.equal(similarity(new Set(), new Set(["a"])), 0);
});

// UNIT · src/core/prereqEval.js — pure recursive-descent prereq evaluator.
// Fast, deterministic, no I/O. Naming: "subject › condition › expected".
import { test } from "node:test";
import assert from "node:assert/strict";
import { evalPrereqTree } from "../../src/core/prereqEval.js";

// A three-semester plan: fall < spring < summer (indices 0,1,2).
const semIndex = { fall: 0, spring: 1, summer: 2 };
const ref = (subject, number, extra = {}) => ({ subject, number, ...extra });

test("evalPrereqTree › empty or missing tree › satisfied", () => {
  assert.equal(evalPrereqTree([], {}, semIndex, 2), "satisfied");
  assert.equal(evalPrereqTree(null, {}, semIndex, 2), "satisfied");
});

test("evalPrereqTree › single prereq placed in an earlier semester › satisfied", () => {
  const tree = [ref("CS", "1000")];
  assert.equal(evalPrereqTree(tree, { CS1000: "fall" }, semIndex, 1), "satisfied");
});

test("evalPrereqTree › prereq placed in the same semester › order", () => {
  const tree = [ref("CS", "1000")];
  assert.equal(evalPrereqTree(tree, { CS1000: "spring" }, semIndex, 1), "order");
});

test("evalPrereqTree › concurrent prereq in the same semester › satisfied", () => {
  const tree = [ref("CS", "1000", { concurrent: true })];
  assert.equal(evalPrereqTree(tree, { CS1000: "spring" }, semIndex, 1), "satisfied");
});

test("evalPrereqTree › prereq not in the plan › missing", () => {
  assert.equal(evalPrereqTree([ref("CS", "1000")], {}, semIndex, 1), "missing");
});

test("evalPrereqTree › placedOut prereq › satisfied regardless of placement", () => {
  const tree = [ref("CS", "1000")];
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(["CS1000"])), "satisfied");
});

test("evalPrereqTree › And with one missing operand › missing", () => {
  const tree = [ref("CS", "1000"), "And", ref("CS", "2000")];
  const p = { CS1000: "fall" }; // CS2000 absent
  assert.equal(evalPrereqTree(tree, p, semIndex, 2), "missing");
});

test("evalPrereqTree › Or with one satisfied operand › satisfied", () => {
  const tree = [ref("CS", "1000"), "Or", ref("CS", "2000")];
  const p = { CS1000: "fall" }; // CS2000 absent, but Or
  assert.equal(evalPrereqTree(tree, p, semIndex, 2), "satisfied");
});

test("evalPrereqTree › And precedence binds tighter than Or › A Or (B And C)", () => {
  // A missing, B satisfied, C missing → (B And C) = missing, A missing → Or → missing
  const tree = [ref("A", "1"), "Or", ref("B", "1"), "And", ref("C", "1")];
  const p = { B1: "fall" };
  assert.equal(evalPrereqTree(tree, p, semIndex, 2), "missing");
});

test("evalPrereqTree › parentheses override precedence › (A Or B) And C", () => {
  // A satisfied, B missing, C satisfied → (sat) And sat → satisfied
  const tree = ["(", ref("A", "1"), "Or", ref("B", "1"), ")", "And", ref("C", "1")];
  const p = { A1: "fall", C1: "fall" };
  assert.equal(evalPrereqTree(tree, p, semIndex, 2), "satisfied");
});

test("evalPrereqTree › nested sub-expression array › evaluated as a group", () => {
  const tree = [[ref("A", "1"), "Or", ref("B", "1")], "And", ref("C", "1")];
  const p = { B1: "fall", C1: "fall" };
  assert.equal(evalPrereqTree(tree, p, semIndex, 2), "satisfied");
});

// ── Regression guard: dangling operators must NOT swallow real violations.
// A phantom operand is neutral, so "MISSING Or <nothing>" stays missing rather
// than passing. (See prereqEval.js mergeOr/mergeAnd and commit c6db3bd9.)
test("evalPrereqTree › trailing 'Or' after a missing operand › stays missing", () => {
  assert.equal(evalPrereqTree([ref("CS", "1000"), "Or"], {}, semIndex, 1), "missing");
});

test("evalPrereqTree › trailing 'And' after a satisfied operand › stays satisfied", () => {
  const p = { CS1000: "fall" };
  assert.equal(evalPrereqTree([ref("CS", "1000"), "And"], p, semIndex, 1), "satisfied");
});

test("evalPrereqTree › case-insensitive subject match › satisfied", () => {
  const tree = [ref("cs", "1000")];
  assert.equal(evalPrereqTree(tree, { CS1000: "fall" }, semIndex, 1), "satisfied");
});

// "order" is same-OR-later: a prereq placed strictly after the course is just as
// out-of-order as one placed alongside it. The same-semester case is covered
// above; this pins the later-semester half of the rule.
test("evalPrereqTree › prereq placed in a strictly later semester › order", () => {
  const tree = [ref("CS", "1000")];
  // course at fall (ti=0), prereq at summer (index 2) → placed, but too late.
  assert.equal(evalPrereqTree(tree, { CS1000: "summer" }, semIndex, 0), "order");
});

// ── Adversarial: malformed scraped trees must never throw, and stray tokens
// must never rescue a genuinely missing prerequisite. (A parser that swallowed
// violations here would silently tell a student a course is takeable.)
test("evalPrereqTree › unbalanced open paren around a missing operand › missing, no throw", () => {
  // "(" opens but never closes; CS2000 absent → the And still resolves to missing.
  const tree = ["(", ref("CS", "1000"), "And", ref("CS", "2000")];
  assert.equal(evalPrereqTree(tree, { CS1000: "fall" }, semIndex, 2), "missing");
});

test("evalPrereqTree › trailing dangling operator after a mid-tree missing › stays missing", () => {
  // CS1000 satisfied, CS2000 missing, then a dangling "Or" with no operand.
  // (satisfied And missing) = missing; the phantom "Or <nothing>" must not rescue it.
  const tree = [ref("CS", "1000"), "And", ref("CS", "2000"), "Or"];
  assert.equal(evalPrereqTree(tree, { CS1000: "fall" }, semIndex, 2), "missing");
});

test("evalPrereqTree › nested empty sub-expression › neutral (satisfied)", () => {
  // An empty group is a phantom operand — neutral, so a lone empty array is a no-op.
  assert.equal(evalPrereqTree([[]], {}, semIndex, 2), "satisfied");
});

test("evalPrereqTree › only stray tokens (no real refs) › does not throw", () => {
  assert.doesNotThrow(() => evalPrereqTree([")", "And", "Or", "("], {}, semIndex, 1));
});

// The prereq grammar, once. These tests pin the three properties the callers
// depend on and that a second hand-written parser would silently lose:
// operator precedence, phantom-operand neutrality, and nesting.
import test from "node:test";
import assert from "node:assert/strict";
import { foldPrereqTree, prereqRefIds, refId, prereqParseComplete } from "../../src/core/prereqFold.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";

const C = (subject, number, extra = {}) => ({ subject, number, ...extra });

// A tiny algebra where a course leaf is its own id, so the fold's output is a
// readable parenthesisation of what it parsed.
const shape = {
  course: (t) => refId(t),
  note: (t) => `note(${t.note})`,
  or: (a, b) => `(${a} | ${b})`,
  and: (a, b) => `(${a} & ${b})`,
};

test("fold › And binds tighter than Or", () => {
  const t = [C("A", "1"), "Or", C("B", "1"), "And", C("C", "1")];
  assert.equal(foldPrereqTree(t, shape), "(A1 | (B1 & C1))");
});

test("fold › parentheses override precedence", () => {
  const t = ["(", C("A", "1"), "Or", C("B", "1"), ")", "And", C("C", "1")];
  assert.equal(foldPrereqTree(t, shape), "((A1 | B1) & C1)");
});

test("fold › Or and And are left-associative", () => {
  assert.equal(
    foldPrereqTree([C("A", "1"), "Or", C("B", "1"), "Or", C("C", "1")], shape),
    "((A1 | B1) | C1)",
  );
  assert.equal(
    foldPrereqTree([C("A", "1"), "And", C("B", "1"), "And", C("C", "1")], shape),
    "((A1 & B1) & C1)",
  );
});

test("fold › a nested array is a sub-expression, not a flattening", () => {
  const t = [[C("A", "1"), "Or", C("B", "1")], "And", C("C", "1")];
  assert.equal(foldPrereqTree(t, shape), "((A1 | B1) & C1)");
});

test("fold › deeply nested arrays terminate and keep their shape", () => {
  const t = [[[[C("A", "1")]]], "Or", C("B", "1")];
  assert.equal(foldPrereqTree(t, shape), "(A1 | B1)");
});

// ── Phantom operands ──────────────────────────────────────────────
//
// The rule that matters most: a dangling operator must NOT invent an operand.
// If it did, "MATH2331 Or <nothing>" would combine with whatever the caller's
// identity element happens to be, and for the satisfaction algebra that reads
// as "satisfied" — silently swallowing a real violation.

test("fold › a TRAILING dangling operator contributes no operand", () => {
  assert.equal(foldPrereqTree([C("A", "1"), "Or"], shape), "A1");
  assert.equal(foldPrereqTree([C("A", "1"), "And"], shape), "A1");
  assert.equal(prereqParseComplete([C("A", "1"), "Or"]), true);
});

test("fold › two operators in a row is truncation, not a dangling operator", () => {
  // "A1 And Or B1": the "Or" lands where an operand belongs, so it is skipped
  // as junk — and then B1 sits where an operator belongs, ending the parse.
  const t = [C("A", "1"), "And", "Or", C("B", "1")];
  assert.equal(foldPrereqTree(t, shape), "A1");
  assert.equal(prereqParseComplete(t), false);
});

test("fold › a tree with no operand at all folds to null", () => {
  for (const t of [null, undefined, [], [""], ["And"], ["Or"], ["("], [")"],
                   ["(", ")"], [[]], [[[]]], [null], [0], [false], [{}],
                   [{ subject: "CS" }], [{ number: "2500" }]]) {
    assert.equal(foldPrereqTree(t, shape), null, JSON.stringify(t));
  }
});

// ── A token in the wrong position TRUNCATES, and that is reported ──
//
// This is not the behaviour anyone would choose; it is the behaviour that has
// always shipped, and no recovery is provably right (skipping the junk invents
// `A1 And B1`; truncating drops B1). What the parser owes is not a guess but a
// SIGNAL, so `prereqParseComplete` reports it and a corpus test below shows the
// real catalog never triggers it.

test("fold › a misplaced token truncates the parse", () => {
  const t = [C("A", "1"), 42, "And", C("B", "1")];
  assert.equal(foldPrereqTree(t, shape), "A1");
  assert.equal(prereqParseComplete(t), false);
});

test("fold › a LEADING operator makes the whole tree read as empty", () => {
  assert.equal(foldPrereqTree(["Or", C("A", "1")], shape), null);
  assert.equal(prereqParseComplete(["Or", C("A", "1")]), false);
  // ...which for the satisfaction algebra means "no prerequisite", so the
  // tripwire is the only thing standing between this and a silent miss.
  assert.equal(evalPrereqTree(["Or", C("A", "1")], {}, { s0: 0 }, 0), "satisfied");
});

test("prereqParseComplete › true for every well-formed shape", () => {
  const ok = [
    null, undefined, [], [C("A", "1")],
    [C("A", "1"), "Or", C("B", "1")],
    [C("A", "1"), "And", C("B", "1")],
    ["(", C("A", "1"), "Or", C("B", "1"), ")", "And", C("C", "1")],
    [[C("A", "1"), "Or", C("B", "1")], "And", C("C", "1")],
    [{ note: "graduate program admission" }],
    // A trailing dangling operator consumes its own token, so this is complete.
    [C("A", "1"), "Or"],
  ];
  for (const t of ok) assert.equal(prereqParseComplete(t), true, JSON.stringify(t));
});

test("prereqParseComplete › false when a tail is discarded, at any depth", () => {
  const bad = [
    [C("A", "1"), 42],
    [C("A", "1"), ")", "And", C("B", "1")],
    ["Or", C("A", "1")],
    [{}, C("A", "1")],
    // nested: the OUTER list finishes, but the sub-expression does not
    [[C("A", "1"), 42, "And", C("B", "1")], "Or", C("C", "1")],
  ];
  for (const t of bad) assert.equal(prereqParseComplete(t), false, JSON.stringify(t));
});

test("fold › an unclosed paren does not hang or drop the operand", () => {
  assert.equal(foldPrereqTree(["(", C("A", "1")], shape), "A1");
  assert.equal(foldPrereqTree(["(", C("A", "1"), "And"], shape), "A1");
});

test("fold › omitted algebra members degrade to null rather than throwing", () => {
  const t = [C("A", "1"), "Or", { note: "x" }];
  assert.equal(foldPrereqTree(t, { or: (a, b) => `${a}|${b}`, and: (a, b) => `${a}&${b}` }), null);
});

test("fold › a note leaf is an operand", () => {
  assert.equal(
    foldPrereqTree([{ note: "graduate program admission" }, "And", C("A", "1")], shape),
    "(note(graduate program admission) & A1)",
  );
});

// ── refId / prereqRefIds ──────────────────────────────────────────

test("refId › upper-cases the subject and keeps the number verbatim", () => {
  assert.equal(refId({ subject: "cs", number: "2500" }), "CS2500");
  assert.equal(refId({ subject: "Cs", number: "2500" }), "CS2500");
});

test("prereqRefIds › collects every ref regardless of boolean structure", () => {
  const t = ["(", C("A", "1"), "Or", C("B", "1"), ")", "And", [C("C", "1")], "Or", { note: "x" }];
  assert.deepEqual([...prereqRefIds(t)].sort(), ["A1", "B1", "C1"]);
});

test("prereqRefIds › empty and junk trees collect nothing", () => {
  for (const t of [null, [], ["And"], [{}], [{ note: "x" }]]) {
    assert.equal(prereqRefIds(t).size, 0, JSON.stringify(t));
  }
});

// ── The satisfaction algebra still reads the grammar the same way ──

test("eval › precedence is boolean algebra, not left-to-right", () => {
  const semIndex = { s0: 0, s1: 1, s2: 2 };
  // A1 Or (B1 And C1) — A1 placed early satisfies it even with B1/C1 absent.
  const t = [C("A", "1"), "Or", C("B", "1"), "And", C("C", "1")];
  assert.equal(evalPrereqTree(t, { A1: "s0" }, semIndex, 2), "satisfied");
  // ...and without A1, BOTH of B1/C1 are needed.
  assert.equal(evalPrereqTree(t, { B1: "s0" }, semIndex, 2), "missing");
  assert.equal(evalPrereqTree(t, { B1: "s0", C1: "s1" }, semIndex, 2), "satisfied");
});

test("eval › a dangling Or does not swallow a real violation", () => {
  const semIndex = { s0: 0, s1: 1 };
  assert.equal(evalPrereqTree([C("A", "1"), "Or"], {}, semIndex, 1), "missing");
  assert.equal(evalPrereqTree([C("A", "1"), "Or"], { A1: "s0" }, semIndex, 1), "satisfied");
});

test("eval › an empty or all-junk tree is not an unmet prerequisite", () => {
  for (const t of [null, [], ["And"], ["("], [{}]]) {
    assert.equal(evalPrereqTree(t, {}, {}, 0), "satisfied", JSON.stringify(t));
  }
});

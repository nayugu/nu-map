// Grade system — the two axes, gates, feasibility, replacement.
// The invariant under everything: with no grades entered, every function
// reports "fine" — the default path must be indistinguishable from today.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_POINTS, GRADE_SYMBOLS, yieldsCredit, countsInGPA, satisfiesGate,
  setConstraintStatus, enteredGPA, effectiveGradeOfTakes,
  dropVoidTakes, dropUnearnedTakes, takeConsumesSlot,
} from "../../src/core/gradeSystem.js";
import { buildTakesResolver } from "../../src/core/repeatInstances.js";
import { evalPrereqTree } from "../../src/core/prereqEval.js";

// ── the two axes ────────────────────────────────────────────────────

test("axes › F is the double agent: no credit, yet counts in GPA at 0.000", () => {
  assert.equal(yieldsCredit("F"), false);
  assert.equal(countsInGPA("F"), true);
  assert.equal(GRADE_POINTS["F"], 0);
});

test("axes › S is the mirror: credit, but no quality points", () => {
  assert.equal(yieldsCredit("S"), true);
  assert.equal(countsInGPA("S"), false);
});

test("axes › U, W, X: neither credit nor points; I pending", () => {
  for (const g of ["U", "W", "X", "I"]) {
    assert.equal(yieldsCredit(g), false, g);
    assert.equal(countsInGPA(g), false, g);
  }
});

// T is the marker that makes the overloaded "Incoming Credit" bucket
// workable: it holds transfer/AP/IB/waiver AND programs like NU Accelerate
// (summer coursework before a fall start), which IS Northeastern
// coursework and does count toward the GPA. The placement can't tell them
// apart — only the grade can. So incoming credit is included in the GPA
// like any other placement, and T is how a student marks the hours that
// transferred: full credit, satisfies downstream requirements, zero
// quality points.

test("axes › T earns credit and requirements but contributes NO quality points", () => {
  assert.equal(yieldsCredit("T"), true);
  assert.equal(countsInGPA("T"), false);
  assert.equal(satisfiesGate("T", "C-"), true, "transferred hours satisfy a prereq gate");
  assert.equal(satisfiesGate("T", null), true);
});

test("axes › T occupies its slot — transferred credit is not a failed attempt", () => {
  // If T handed the slot back it would offer a phantom "retake" of a course
  // the student already has credit for.
  assert.equal(takeConsumesSlot("T"), true);
});

test("enteredGPA › T is excluded from both sides of the average", () => {
  // 4 SH of T alongside 4 SH of C must read 2.000, not 1.000: the
  // transferred hours leave the denominator too, they don't count as zero.
  assert.equal(enteredGPA([{ grade: "T", credits: 4 }, { grade: "C", credits: 4 }]), 2.0);
  assert.equal(enteredGPA([{ grade: "T", credits: 4 }]), null, "T alone yields no GPA at all");
});

test("constraint › a T-graded course neither helps nor hurts a set average", () => {
  const withT = setConstraintStatus([e("T"), e("B"), e("B")], 3.0);
  const withoutT = setConstraintStatus([e("B"), e("B")], 3.0);
  assert.equal(withT.status, withoutT.status);
});

test("axes › unentered is assumed to yield credit and stays out of averages", () => {
  assert.equal(yieldsCredit(null), true);
  assert.equal(yieldsCredit(undefined), true);
  assert.equal(countsInGPA(null), false);
});

// ── gates ───────────────────────────────────────────────────────────

test("gate › unentered clears every gate — the no-false-alarms rule", () => {
  assert.equal(satisfiesGate(null, "B"), true);
  assert.equal(satisfiesGate(undefined, "A"), true);
});

test("gate › registrar exclusion list: F, U, I, W, X never fulfil", () => {
  for (const g of ["F", "U", "I", "W", "X"]) {
    assert.equal(satisfiesGate(g, "D-"), false, g);
    assert.equal(satisfiesGate(g, null), false, `${g} even with no stated gate`);
  }
});

test("gate › letter comparisons: C clears C- but not C+", () => {
  assert.equal(satisfiesGate("C", "C-"), true);
  assert.equal(satisfiesGate("C", "C"), true);
  assert.equal(satisfiesGate("C", "C+"), false);
  assert.equal(satisfiesGate("D-", "C"), false);
});

test("gate › S clears letter gates (ambiguity resolves upward) and S-gates", () => {
  assert.equal(satisfiesGate("S", "C"), true);
  assert.equal(satisfiesGate("S", "S"), true);
  assert.equal(satisfiesGate("B", "S"), true);  // letter pass clears an S/U gate
  assert.equal(satisfiesGate("U", "S"), false);
});

test("gate › unknown symbols never alarm", () => {
  // "T" used to stand in here as an unknown symbol; it is a defined grade
  // now, so this needs a genuinely unrecognised one or it stops testing
  // the fallback at all.
  assert.equal(satisfiesGate("ZZ", "C"), true);
  assert.equal(satisfiesGate("B", "??"), true);
});

// ── set-constraint feasibility (the G2/G3/G4 solver) ────────────────

const e = (grade, credits = 4) => ({ grade, credits });

test("constraint › nothing entered → open, never an alarm", () => {
  const r = setConstraintStatus([e(null), e(null), e(null)], 2.0);
  assert.equal(r.status, "open");
  assert.equal(r.neededGrade, "C"); // the bar itself, stated as a grade
});

test("constraint › ECON case: C, C, B+ entered, one open → the needed grade is computable", () => {
  // threshold 2.0 over 4 courses; entered C(2.0) C(2.0) B+(3.333)
  const r = setConstraintStatus([e("C"), e("C"), e("B+"), e(null)], 2.0);
  assert.equal(r.status, "open");
  // needed = (2.0*16 − (2+2+3.333)*4) / 4 = (32 − 29.332)/4 ≈ 0.667 → D-
  assert.equal(r.neededGrade, "D-");
});

test("constraint › impossibility is a proof: even straight As can't reach", () => {
  const r = setConstraintStatus([e("F"), e("F"), e("F"), e(null)], 3.9);
  assert.equal(r.status, "impossible");
});

test("constraint › all entered and clearing → met; failing → impossible", () => {
  assert.equal(setConstraintStatus([e("B"), e("C")], 2.0).status, "met");
  assert.equal(setConstraintStatus([e("D"), e("D-")], 2.0).status, "impossible");
});

test("constraint › S is excluded from the average, not counted as 4.0", () => {
  // If S were 4.0 this would be met; excluded, the two Ds decide it.
  const r = setConstraintStatus([e("S"), e("D"), e("D")], 2.0);
  assert.equal(r.status, "impossible");
});

test("constraint › F drags the average at 0.000", () => {
  const r = setConstraintStatus([e("F"), e("A")], 2.5);
  assert.equal(r.status, "impossible"); // (0+4)/2 = 2.0 < 2.5
});

test("constraint › near-perfect remainder → atRisk, not silent", () => {
  // threshold 3.0 over 2 courses, entered C → the other must be exactly an A
  const r = setConstraintStatus([e("C"), e(null)], 3.0);
  assert.equal(r.status, "atRisk");
  assert.equal(r.neededGrade, "A");
});

test("constraint › three Cs against 3.0 with one open is already impossible", () => {
  // needed = (3.0·16 − 24)/4 = 6.0 > A — a proof, not a prediction
  const r = setConstraintStatus([e("C"), e("C"), e("C"), e(null)], 3.0);
  assert.equal(r.status, "impossible");
});

// ── enteredGPA: honest display only ─────────────────────────────────

test("enteredGPA › null when nothing entered — the ceiling must never render", () => {
  assert.equal(enteredGPA([e(null), e(null)]), null);
  assert.equal(enteredGPA([]), null);
});

test("enteredGPA › letters only, credit-weighted, F included", () => {
  assert.equal(enteredGPA([e("A", 4), e("F", 4)]), 2.0);
  assert.equal(enteredGPA([e("A", 4), e("S", 4)]), 4.0); // S out of the average
});

test("enteredGPA › the catalog's own worked example: B×4SH + A×1SH = 3.200", () => {
  // Verbatim from the official "Grade Table and GPA" page: weight = grade
  // points × semester hours; GPA = total weight ÷ total semester hours.
  // (16 ÷ 5 = 3.200 — NOT the naive unweighted (3+4)/2 = 3.5.)
  assert.equal(enteredGPA([e("B", 4), e("A", 1)]), 3.2);
});

test("enteredGPA › a real 0-credit course weighs nothing (recitations, 536 in catalog)", () => {
  // A graded recitation must not drag or lift the average.
  assert.equal(enteredGPA([e("A", 4), e("C", 0)]), 4.0);
  assert.equal(enteredGPA([e("C", 0)]), null);            // nothing weighted → no GPA
  // …but UNKNOWN credits still default to 4
  assert.equal(enteredGPA([e("A", 4), { grade: "C" }]), 3.0);
});

test("constraint › 0-credit entries don't count toward the bar either way", () => {
  const r = setConstraintStatus([e("D", 4), e("A", 0)], 2.0);
  assert.equal(r.status, "impossible"); // the A weighs nothing; D alone decides
});

// ── replacement rule ────────────────────────────────────────────────

test("replacement › the latest take's grade counts; earlier attempts excluded", () => {
  assert.equal(effectiveGradeOfTakes([{ fi: 0, grade: "F" }, { fi: 2, grade: "B" }]), "B");
  assert.equal(effectiveGradeOfTakes([{ fi: 2, grade: "B" }, { fi: 0, grade: "F" }]), "B");
});

test("replacement › unentered latest = planned retake = assumed pass (null)", () => {
  assert.equal(effectiveGradeOfTakes([{ fi: 0, grade: "F" }, { fi: 2, grade: null }]), null);
});

test("replacement › placed-out sorts earliest", () => {
  assert.equal(effectiveGradeOfTakes([{ fi: "out", grade: "S" }, { fi: 1, grade: "C" }]), "C");
});

// ── grade-aware prereq evaluation ───────────────────────────────────

const semIndex = { fall: 0, spring: 1, summer: 2 };
const ref = (s, n, minGrade) => ({ subject: s, number: n, ...(minGrade ? { minGrade } : {}) });

function takesFrom(map) {
  return id => map[id] ?? [];
}

test("evalPrereqTree › takesOf absent → legacy path identical", () => {
  const tree = [ref("CS", "2500", "C-")];
  assert.equal(evalPrereqTree(tree, { CS2500: "fall" }, semIndex, 1), "satisfied");
});

test("evalPrereqTree › unentered grade satisfies a gated ref", () => {
  const tree = [ref("CS", "2500", "C-")];
  const takes = takesFrom({ CS2500: [{ fi: 0, grade: null }] });
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "satisfied");
});

test("evalPrereqTree › entered grade below the gate → missing (needs retake)", () => {
  const tree = [ref("CS", "2500", "C-")];
  const takes = takesFrom({ CS2500: [{ fi: 0, grade: "D" }] });
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "missing");
});

test("evalPrereqTree › F on the only take → missing even with no stated gate", () => {
  const tree = [ref("CS", "2500")];
  const takes = takesFrom({ CS2500: [{ fi: 0, grade: "F" }] });
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "missing");
});

test("evalPrereqTree › failed take + later retake: satisfied after, order at, missing before", () => {
  const takes = takesFrom({ CS2500: [{ fi: 0, grade: "F" }, { fi: 1, grade: null }] });
  const tree = [ref("CS", "2500")];
  assert.equal(evalPrereqTree(tree, {}, semIndex, 2, new Set(), takes), "satisfied");
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "order");
});

test("evalPrereqTree › OR: one branch grade-failed, the other clean → satisfied", () => {
  const tree = [ref("CS", "2100"), "Or", ref("CS", "2510")];
  const takes = takesFrom({
    CS2100: [{ fi: 0, grade: "F" }],
    CS2510: [{ fi: 0, grade: null }],
  });
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "satisfied");
});

test("evalPrereqTree › placed-out take with a vetoing grade does not satisfy", () => {
  const tree = [ref("CS", "2500")];
  const takes = takesFrom({ CS2500: [{ fi: "out", grade: "U" }] });
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "missing");
});

test("evalPrereqTree › concurrent ref allows same-semester take through takesOf", () => {
  const tree = [{ ...ref("CS", "2500"), concurrent: true }];
  const takes = takesFrom({ CS2500: [{ fi: 1, grade: null }] });
  assert.equal(evalPrereqTree(tree, {}, semIndex, 1, new Set(), takes), "satisfied");
});

// ── buildTakesResolver: the resolver must mirror the legacy lookup ──
// Regression for a shipped bug: the resolver skipped "incoming" (transfer
// credit) placements, so entering ONE grade anywhere sprayed phantom
// "! grade" violations across every transfer-satisfied course on the plan.

const fullIndex = { incoming: 0, fall: 1, spring: 2, summer: 3 };

test("resolver › no grades entered → null (the legacy path, bit-for-bit)", () => {
  assert.equal(buildTakesResolver({ CS2500: "fall" }, new Set(), {}, fullIndex), null);
  assert.equal(buildTakesResolver({ CS2500: "fall" }, new Set(), null, fullIndex), null);
});

test("resolver › incoming/transfer placements satisfy prereqs (the sprayed-badges bug)", () => {
  // ENGW1111 is transfer credit; the entered grade is on an UNRELATED course.
  const takesOf = buildTakesResolver(
    { ENGW1111: "incoming", MATH2341: "fall" }, new Set(),
    { MATH2341: "A" }, fullIndex,
  );
  const tree = [ref("ENGW", "1111", "C")];
  assert.equal(evalPrereqTree(tree, {}, fullIndex, 2, new Set(), takesOf), "satisfied");
});

test("resolver › entering a grade on X changes nothing for courses not depending on X", () => {
  const placements = { CS2500: "fall", MATH2331: "fall", ENGW1111: "incoming" };
  const trees = [
    [ref("MATH", "2331", "D-")],
    [ref("ENGW", "1111")],
    [ref("MATH", "2331"), "Or", ref("CS", "9999")],
  ];
  for (const tree of trees) {
    const legacy = evalPrereqTree(tree, placements, fullIndex, 2, new Set());
    const takesOf = buildTakesResolver(placements, new Set(), { CS2500: "F" }, fullIndex);
    const graded = evalPrereqTree(tree, placements, fullIndex, 2, new Set(), takesOf);
    assert.equal(graded, legacy, JSON.stringify(tree));
  }
});

test("resolver › placed-out takes resolve as 'out' and carry their grade", () => {
  const takesOf = buildTakesResolver({}, new Set(["CS2500"]), { CS2500: "U" }, fullIndex);
  assert.deepEqual(takesOf("CS2500"), [{ fi: "out", grade: "U" }]);
});

// ── credit views: the registrar's "earned" vs the plan's projection ─

const PLACEMENTS = { A1: "fall", B2: "fall", C3: "spring", D4: "spring", E5: "summer" };

test("credit views › no grades entered → identity, byte-for-byte", () => {
  assert.equal(dropVoidTakes(PLACEMENTS, {}), PLACEMENTS);
  assert.equal(dropUnearnedTakes(PLACEMENTS, null), PLACEMENTS);
});

test("credit views › projection drops F/U/W but keeps I (resolves in place)", () => {
  const g = { A1: "F", B2: "U", C3: "W", D4: "I", E5: "B" };
  assert.deepEqual(Object.keys(dropVoidTakes(PLACEMENTS, g)), ["D4", "E5"]);
});

test("credit views › earned drops I too — an incomplete has earned nothing yet", () => {
  const g = { A1: "F", D4: "I", E5: "S" };
  // S earns credit; unentered assumed; F and I do not
  assert.deepEqual(Object.keys(dropUnearnedTakes(PLACEMENTS, g)), ["B2", "C3", "E5"]);
});

test("resolver › off-timeline placements stay invisible, like the legacy lookup", () => {
  const takesOf = buildTakesResolver({ CS2500: "__overflow:1" }, new Set(), { CS2500: "A" }, fullIndex);
  assert.deepEqual(takesOf("CS2500"), []);
});

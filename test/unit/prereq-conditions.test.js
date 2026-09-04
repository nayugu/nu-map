// UNIT · src/core/prereqConditions.js — non-course prereq phrases.
// Pure, no I/O. Naming: "subject › condition › expected".
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCondition, planConditions, conditionStatus, collectConditions,
  AUTO_SATISFIABLE,
} from "../../src/core/prereqConditions.js";

// ── classifyCondition ────────────────────────────────────────────────
test("classifyCondition › the catalog's grad-admission phrasing › grad-admission", () => {
  // The exact string in all 209 shipped occurrences, plus plausible rewordings
  // the next monthly scrape could bring.
  for (const s of [
    "graduate program admission",
    "Graduate program admission",
    "GRADUATE PROGRAM ADMISSION",
    "graduate  program\tadmission",
    "admission to a graduate program",
    "admission to the graduate program",
    "admitted to a graduate program",
    "graduate standing",
    "graduate student standing",
    "admission to graduate study",
    "must be a graduate student",
    "graduate status",
  ]) {
    assert.equal(classifyCondition(s), "grad-admission", s);
  }
});

// Invariant 2: phrases that MENTION graduate study but do not follow from
// being in a graduate plan. Each is a separate decision or a further gate.
test("classifyCondition › permission wins over any graduate wording › permission", () => {
  for (const s of [
    "permission of the graduate program director",
    "consent of graduate program director",
    "approval of the graduate coordinator",
    "permission of instructor",
  ]) {
    assert.equal(classifyCondition(s), "permission", s);
  }
});

test("classifyCondition › a fused 'standing or permission' phrase takes the safe side", () => {
  // The parser keeps a phrase-only prereq whole ("graduate standing or
  // permission of instructor" — it must not split on the internal "or"), and
  // permission is tested first, so this reads as permission → neutral. Safe by
  // construction: a phrase-only tree is a single note, and a lone neutral
  // operand already evaluates satisfied. When such a phrase sits beside courses
  // the parser DOES split it, so each half classifies on its own.
  assert.equal(classifyCondition("graduate standing or permission of instructor"), "permission");
});

test("classifyCondition › candidacy and dissertation gates › candidacy", () => {
  // "Dissertation Check with a score of REQ" is a score gate by shape but a
  // PhD continuation gate by meaning, and must never auto-satisfy.
  assert.equal(classifyCondition("Dissertation Check with a score of REQ"), "candidacy");
  assert.equal(classifyCondition("PhD candidacy"), "candidacy");
  assert.equal(classifyCondition("admission to candidacy in the graduate program"), "candidacy");
});

test("classifyCondition › degree-specific admission is NOT generic grad admission", () => {
  // A graduate plan does not say WHICH level, so it cannot assert these.
  assert.notEqual(classifyCondition("doctoral program admission"), "grad-admission");
  assert.notEqual(classifyCondition("admission to the PhD program"), "grad-admission");
});

test("classifyCondition › undergraduate class standing › standing, not grad-admission", () => {
  assert.equal(classifyCondition("junior or senior standing"), "standing");
  assert.equal(classifyCondition("senior standing"), "standing");
});

test("classifyCondition › named placement tests › score-gate", () => {
  assert.equal(classifyCondition("French Placement Test with a score of 411"), "score-gate");
  assert.equal(classifyCondition("Biotechnology Lab Skills with a score of 80"), "score-gate");
});

test("classifyCondition › empty input › null", () => {
  assert.equal(classifyCondition(""), null);
  assert.equal(classifyCondition(null), null);
  assert.equal(classifyCondition("   "), null);
});

test("classifyCondition › unrecognized phrase › other (neutral, not an error)", () => {
  assert.equal(classifyCondition("see the department website"), "other");
});

// ── planConditions / conditionStatus ─────────────────────────────────
test("planConditions › graduate plan › asserts grad-admission only", () => {
  assert.deepEqual([...planConditions({ studentType: "graduate" })], ["grad-admission"]);
});

test("planConditions › undergrad, missing or malformed plan › asserts nothing", () => {
  for (const p of [{ studentType: "undergrad" }, {}, null, undefined, { studentType: "Graduate" }]) {
    assert.equal(planConditions(p).size, 0);
  }
});

// ── Graduate gates that are NOT generic admission ───────────────────────
//
// Three arrived with the 2026-2027 catalog roll, and all three had fallen
// through to "other", which is neutral — the failure the invariant test guards
// is that a gate reads as nothing at all and nobody notices.
//
// The point of these tests is the SECOND assertion in each: recognizing a
// phrase must not quietly make it satisfiable. A plan records
// `studentType: "graduate"` and nothing else, so it cannot assert which degree
// a student was admitted to, nor what they studied before the plan began.
test("classify › admission to a NAMED degree is recognized but never auto-satisfies", () => {
  const note = "Requires admission to MS program or completion of all transition courses";
  assert.equal(classifyCondition(note), "degree-admission");
  assert.equal(AUTO_SATISFIABLE.has("degree-admission"), false,
    "a graduate plan does not say WHICH degree — a PhD student is not admitted to an MS program");
  assert.equal(conditionStatus(note, planConditions({ studentType: "graduate" })), null);
});

test("classify › prior coursework is recognized but never auto-satisfies", () => {
  for (const note of [
    "Requires prior completion of at least three semesters of graduate study in health informatics",
    "Requires prior completion of graduate coursework in microeconomics and mathematics",
  ]) {
    assert.equal(classifyCondition(note), "prior-coursework", note);
    assert.equal(conditionStatus(note, planConditions({ studentType: "graduate" })), null,
      "a transcript we cannot see must stay neutral, not become a pass");
  }
  assert.equal(AUTO_SATISFIABLE.has("prior-coursework"), false);
});

test("classify › the new kinds did not steal generic graduate admission", () => {
  // Ordering guard. Both new patterns mention admission, and if either ran
  // before GRAD_ADMISSION the 209 courses that offer generic admission as an
  // OR branch would stop auto-satisfying — reintroducing the exact bug this
  // module was written for, silently and corpus-wide.
  for (const note of ["graduate program admission",
                      "admission to the graduate program in Nursing",
                      "admitted to graduate study"]) {
    assert.equal(classifyCondition(note), "grad-admission", note);
    assert.equal(conditionStatus(note, planConditions({ studentType: "graduate" })), "satisfied", note);
  }
});

test("planConditions › only grad-admission is ever auto-satisfiable", () => {
  // Guard against a future kind being wired in without a deliberate decision:
  // every kind a plan can assert must be in AUTO_SATISFIABLE.
  for (const kind of planConditions({ studentType: "graduate" })) {
    assert.ok(AUTO_SATISFIABLE.has(kind), kind);
  }
});

test("conditionStatus › met condition › satisfied; anything else › null", () => {
  const grad = planConditions({ studentType: "graduate" });
  assert.equal(conditionStatus("graduate program admission", grad), "satisfied");
  // Invariant 1: unmet and unrecognized are neutral (null), NEVER "missing".
  assert.equal(conditionStatus("permission of instructor", grad), null);
  assert.equal(conditionStatus("see the department website", grad), null);
  assert.equal(conditionStatus("graduate program admission", planConditions({ studentType: "undergrad" })), null);
  assert.equal(conditionStatus("graduate program admission", null), null);
});

// ── collectConditions ────────────────────────────────────────────────
test("collectConditions › walks nested trees, dedupes, marks satisfaction", () => {
  const tree = [
    "(", { subject: "BIOE", number: "3210" }, "And", { subject: "BIOE", number: "2350" }, ")",
    "Or", { note: "graduate program admission" },
    "Or", [{ note: "permission of instructor" }, "Or", { note: "graduate program admission" }],
  ];
  const got = collectConditions(tree, planConditions({ studentType: "graduate" }));
  assert.deepEqual(got, [
    { note: "graduate program admission", kind: "grad-admission", satisfied: true },
    { note: "permission of instructor",   kind: "permission",     satisfied: false },
  ]);
});

test("collectConditions › no notes or no tree › empty array", () => {
  assert.deepEqual(collectConditions([{ subject: "CS", number: "2500" }], null), []);
  assert.deepEqual(collectConditions(null, null), []);
});

// Prereq text parsing — scripts/lib/prereq-parse.js.
// Every input string below is verbatim catalog text (post entity-decode),
// not invented: CS/MATH/CHEM/PHYS/BIOL course-description pages, 2026-08.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractConcurrentCourses, parsePrereqText, parseCoreqText, hasPrereqSignal }
  from "../../scripts/lib/prereq-parse.js";
import { parseDescriptionGpaGate } from "../../src/adapters/northeastern/gpaGate.js";

const parse = (text) => parsePrereqText(extractConcurrentCourses(text).cleaned);

test("minGrade › plain OR chain, all D- (CS 3500's real prereq)", () => {
  const t = parse("CS 2100 with a minimum grade of D- or CS 2510 with a minimum grade of D- or DS 2500 with a minimum grade of D-");
  assert.deepEqual(t, [
    { subject: "CS", number: "2100", minGrade: "D-" }, "Or",
    { subject: "CS", number: "2510", minGrade: "D-" }, "Or",
    { subject: "DS", number: "2500", minGrade: "D-" },
  ]);
});

test("minGrade › mixed gates survive per-ref (CS 5800's shape)", () => {
  const t = parse("CS 4400 with a minimum grade of D- or CS 5400 with a minimum grade of C-");
  assert.equal(t[0].minGrade, "D-");
  assert.equal(t[2].minGrade, "C-");
});

test("minGrade › concurrent + grade in the catalog's invariant order", () => {
  // "MATH 5102 (may be taken concurrently) with a minimum grade of C-"
  const t = parse("MATH 5102 (may be taken concurrently) with a minimum grade of C-");
  assert.deepEqual(t, [{ subject: "MATH", number: "5102", concurrent: true, minGrade: "C-" }]);
});

test("minGrade › S gates (co-op) are real grades, not noise", () => {
  const t = parse("EESC 2000 with a minimum grade of S");
  assert.deepEqual(t, [{ subject: "EESC", number: "2000", minGrade: "S" }]);
});

test("minGrade › parens + semicolons keep structure (MATH 3175's shape)", () => {
  const t = parse("( MATH 2331 with a minimum grade of C+ ; MATH 1365 with a minimum grade of C+ ) or MATH 3175 with a minimum grade of D-");
  assert.deepEqual(t, [
    "(", { subject: "MATH", number: "2331", minGrade: "C+" }, "And",
    { subject: "MATH", number: "1365", minGrade: "C+" }, ")", "Or",
    { subject: "MATH", number: "3175", minGrade: "D-" },
  ]);
});

test("minGrade › no stated grade → no minGrade key at all", () => {
  const t = parse("CS 2500 or CS 2510");
  assert.deepEqual(t, [
    { subject: "CS", number: "2500" }, "Or", { subject: "CS", number: "2510" },
  ]);
});

test("minGrade › case-insensitive phrase, grade normalized to upper case", () => {
  const t = parse("BIOL 1111 With A Minimum Grade Of c+");
  assert.equal(t[0].minGrade, "C+");
});

test("legacy › letter-suffixed course numbers still match with markers", () => {
  const t = parse("CHEM 2311L with a minimum grade of C-");
  assert.deepEqual(t, [{ subject: "CHEM", number: "2311L", minGrade: "C-" }]);
});

test("legacy › implicit And between adjacent groups is preserved", () => {
  const t = parse("( CS 2100 with a minimum grade of D- ) ( ENGW 1111 with a minimum grade of C )");
  assert.deepEqual(t, [
    "(", { subject: "CS", number: "2100", minGrade: "D-" }, ")", "And",
    "(", { subject: "ENGW", number: "1111", minGrade: "C" }, ")",
  ]);
});

// ── description GPA gates (exactly 3 courses corpus-wide) ────────────────────
// Verbatim catalog text. Note 3.333 is real (B+ on NEU's scale), not a
// misparse — verified against the live descriptions.

test("description GPA › the three real catalog sentences", () => {
  assert.equal(parseDescriptionGpaGate(
    "…related to the student’s major field. Requires a 3.500 GPA. May be repeated without limit."), 3.5);
  assert.equal(parseDescriptionGpaGate(
    "…leading class discussions. Requires minimum overall GPA of 3.333 and grade of A– or better in…"), 3.333);
  assert.equal(parseDescriptionGpaGate(
    "…(only under faculty supervision). Requires minimum overall GPA of 3.333, and grade of A–or higher in…"), 3.333);
});

test("description GPA › prose without a GPA never yields one", () => {
  for (const s of [
    "Offers 3 credits of study in the field.",
    "Requires permission of the instructor.",
    "Requires various assignments closely directed by the course instructor.",
    "Covers GPA calculation methods in applied statistics.",
    "",
    null,
  ]) assert.equal(parseDescriptionGpaGate(s), null, JSON.stringify(s));
});

test("description GPA › out-of-range numbers are rejected as misparses", () => {
  assert.equal(parseDescriptionGpaGate("Requires 8.000 GPA"), null);
  assert.equal(parseDescriptionGpaGate("Requires a 0.5 GPA"), null);
});

test("note › a parenthesized approval phrase becomes a { note } leaf, not an empty group", () => {
  // The ACCT 6231 bug: the dropped phrase used to collapse "( … )" to "( )".
  const t = parse("ACCT 6230 with a minimum grade of C- and (permission of the graduate program director)");
  assert.deepEqual(t, [
    { subject: "ACCT", number: "6230", minGrade: "C-" }, "And",
    "(", { note: "permission of the graduate program director" }, ")",
  ]);
});

test("note › trailing 'or permission of instructor' is kept", () => {
  const t = parse("CHEM 1211 or CHEM 1214 or permission of instructor");
  assert.deepEqual(t, [
    { subject: "CHEM", number: "1211" }, "Or",
    { subject: "CHEM", number: "1214" }, "Or",
    { note: "permission of instructor" },
  ]);
});

test("note › 'graduate program admission' is captured", () => {
  const t = parse("BIOL 2301 and graduate program admission");
  assert.deepEqual(t[2], { note: "graduate program admission" });
});

test("note › plain course-only prereqs gain no spurious note", () => {
  const t = parse("CS 2500 and CS 2510");
  assert.deepEqual(t, [
    { subject: "CS", number: "2500" }, "And", { subject: "CS", number: "2510" },
  ]);
});

test("note › phrase-only prereq is worth parsing (the grad-admission case)", () => {
  // The scraper's gate must let a course-less phrase through, or grad courses
  // whose only prereq is "Graduate program admission" get dropped entirely.
  assert.equal(hasPrereqSignal("Graduate program admission"), true);
  assert.equal(hasPrereqSignal("CS 2500 and CS 2510"), true);          // course code
  assert.equal(hasPrereqSignal("Requires junior standing"), true);      // non-course signal
  assert.equal(hasPrereqSignal("Offers an overview of the field."), false); // plain prose
  assert.equal(hasPrereqSignal(""), false);
  assert.deepEqual(parsePrereqText("Graduate program admission"), [{ note: "Graduate program admission" }]);
});

test("note › a phrase-only prereq with internal and/or stays one note", () => {
  // "junior or senior standing" must NOT split on the phrase-internal "or".
  assert.deepEqual(parsePrereqText("junior or senior standing"), [{ note: "junior or senior standing" }]);
  assert.deepEqual(parsePrereqText("sophomore standing or higher"), [{ note: "sophomore standing or higher" }]);
  assert.deepEqual(parsePrereqText("graduate standing or permission of instructor"),
    [{ note: "graduate standing or permission of instructor" }]);
});

test("note › candidacy and other exception terms are recognized", () => {
  assert.deepEqual(parsePrereqText("PhD candidacy"), [{ note: "PhD candidacy" }]);
  assert.deepEqual(parsePrereqText("Consent of the department"), [{ note: "Consent of the department" }]);
});

test("note › a leading field label is stripped", () => {
  assert.deepEqual(parsePrereqText("Prerequisite: Graduate program admission"),
    [{ note: "Graduate program admission" }]);
});

test("note › ordinary prose in the prereq field is NOT captured (no over-capture)", () => {
  // Bare "department"/"faculty" are not signals, so these produce nothing.
  assert.equal(hasPrereqSignal("See department for details"), false);
  assert.equal(hasPrereqSignal("Offers an overview of departmental policy"), false);
  assert.deepEqual(parsePrereqText("See department for details"), []);
});

test("coreqs › unchanged: bare refs, no grades", () => {
  assert.deepEqual(parseCoreqText("PHYS 1151 and PHYS 1152"), [
    { subject: "PHYS", number: "1151" }, { subject: "PHYS", number: "1152" },
  ]);
});

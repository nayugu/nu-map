// Prereq text parsing — scripts/lib/prereq-parse.js.
// Every input string below is verbatim catalog text (post entity-decode),
// not invented: CS/MATH/CHEM/PHYS/BIOL course-description pages, 2026-08.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractConcurrentCourses, parsePrereqText, parseCoreqText, hasPrereqSignal }
  from "../../scripts/lib/prereq-parse.js";
import { parseDescriptionGpaGate } from "../../src/adapters/northeastern/gpaGate.js";
import { conditionStatus } from "../../src/core/prereqConditions.js";
import { prereqParseComplete } from "../../src/core/prereqFold.js";

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

// A reworded admission gate must survive the scrape. Dropping it deletes an
// OR branch 208 courses rely on, and a dropped phrase leaves nothing to test
// against later — so the signal list carries these ahead of need.
test("note › a bare graduate-status phrasing is captured too", () => {
  assert.equal(hasPrereqSignal("Must be a graduate student"), true);
  assert.deepEqual(parse("BIOL 2301 or graduate student status")[2], { note: "graduate student status" });
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

// ── named-score gates & the (Graduate) qualifier ───────────────────────────
// Verbatim catalog text, 2026-08. These are the two malformed-tree classes an
// all-subjects audit surfaced: a score gate dropped from the last OR-branch
// left a dangling operator, and the "(Graduate)" grade-scope qualifier became
// an empty "( )" group. Both now parse clean.

test("note › a named-score gate on the last OR-branch is a note, not a dangling Or", () => {
  // 30 PhD dissertation-continuation courses have exactly this shape.
  const t = parse("BIOE 9991 with a minimum grade of S  or  Dissertation Check with a score of REQ");
  assert.deepEqual(t, [
    { subject: "BIOE", number: "9991", minGrade: "S" }, "Or",
    { note: "Dissertation Check with a score of REQ" },
  ]);
});

test("note › a placement-test score gate is captured", () => {
  const t = parse("FRNH 2102 with a minimum grade of C-  or  FRNH 2302 with a minimum grade of C-  or  French Placement Test with a score of 411");
  assert.deepEqual(t[4], { note: "French Placement Test with a score of 411" });
});

test("note › 'Placement in SUBJ NNNN' stays an alternative course ref, not a note", () => {
  // The embedded course code must survive as a real (OR) alternative; the
  // "with a score of NNNN" fragment beside it must NOT become a stray note.
  const t = parse("SPNS 2102 with a minimum grade of C-  or  Placement in SPNS 3101 with a score of 3101 or  SPNS 3101 with a minimum grade of C-");
  assert.deepEqual(t, [
    { subject: "SPNS", number: "2102", minGrade: "C-" }, "Or",
    { subject: "SPNS", number: "3101" }, "Or",
    { subject: "SPNS", number: "3101", minGrade: "C-" },
  ]);
  assert.ok(!t.some(x => x && typeof x === "object" && x.note), "no stray note");
});

test("note › the '(Graduate)' grade-scope qualifier leaves no empty group", () => {
  const t = parse("IE 5374 with a minimum grade of D  or  IE 5374 with a minimum grade of C  (Graduate) or  IE 6200 with a minimum grade of C");
  assert.deepEqual(t, [
    { subject: "IE", number: "5374", minGrade: "D" }, "Or",
    { subject: "IE", number: "5374", minGrade: "C" }, "Or",
    { subject: "IE", number: "6200", minGrade: "C" },
  ]);
});

test("note › a phrase-only score gate is parse-worthy and captured", () => {
  assert.equal(hasPrereqSignal("Biotechnology Lab Skills with a score of 80"), true);
  assert.deepEqual(parsePrereqText("Biotechnology Lab Skills with a score of 80"),
    [{ note: "Biotechnology Lab Skills with a score of 80" }]);
});

test("coreqs › unchanged: bare refs, no grades", () => {
  assert.deepEqual(parseCoreqText("PHYS 1151 and PHYS 1152"), [
    { subject: "PHYS", number: "1151" }, { subject: "PHYS", number: "1152" },
  ]);
});

// ── Legacy (Mills College) course numbers ────────────────────────────────
//
// These broke main. NEU absorbed Mills in 2022 and its prereq lines cite the
// Mills equivalents with 2–3 digit numbers plus a letter. The course pattern
// wants four digits, so the branch parsed to nothing and the `or` on EACH side
// survived — 81 distinct codes, 751 citations, 513 corrupted trees, surfacing
// as "415 of 2839 prereq trees truncate" after the 2026-2027 roll.
//
// The property that matters is not "a note appears" but that the tree stays
// WELL-FORMED, so these assert the operator sequence rather than just the leaf.
const isOp = (x) => x === "And" || x === "Or";
const wellFormed = (tree) => {
  for (let i = 1; i < tree.length; i++) if (isOp(tree[i]) && isOp(tree[i - 1])) return false;
  return !(tree.length && (isOp(tree[0]) || isOp(tree[tree.length - 1])));
};

test("legacy › a Mills code between two 'or's leaves no dangling operator", () => {
  const tree = parsePrereqText(
    "ACCT 1201 with a minimum grade of D- or ACCT 215M with a minimum grade of D- "
    + "or ACCT 1202 with a minimum grade of D-");
  assert.ok(wellFormed(tree), `dangling operator: ${JSON.stringify(tree)}`);
  assert.deepEqual(tree, [
    { subject: "ACCT", number: "1201", minGrade: "D-" }, "Or",
    { note: "ACCT 215M" }, "Or",
    { subject: "ACCT", number: "1202", minGrade: "D-" },
  ]);
});

test("legacy › a NOTE, never a course ref — it can never resolve", () => {
  // All 81 are absent from the catalog and always will be: it publishes zero
  // 3-digit courses. A ref would be a permanently unresolved reference showing
  // the student a branch they cannot satisfy; a note is neutral, so `mergeOr`
  // collapses it onto the real alternative.
  const tree = parsePrereqText("ACCT 215M with a minimum grade of D-");
  for (const leaf of tree) {
    assert.equal(leaf.subject, undefined,
      `${JSON.stringify(leaf)} is a course ref — a legacy code must stay a note`);
  }
});

test("legacy › a two-letter subject is still kept (the cleanNote guard)", () => {
  // "SW 105M" has no run of three letters, so cleanNote's "needs real words"
  // guard discarded it one step before isCondition could keep it. This was the
  // half of the fix that looked done and was not: 38 of 513 still dangled.
  for (const code of ["SW 105M", "PS 106M"]) {
    const tree = parsePrereqText(`POLS 2345 with a minimum grade of D- or ${code} with a minimum grade of D-`);
    assert.ok(wellFormed(tree), `${code} left a dangling operator: ${JSON.stringify(tree)}`);
    assert.deepEqual(tree[2], { note: code });
  }
});

test("legacy › two Mills codes with no operator between them are one note", () => {
  const tree = parsePrereqText(
    "PSYC 1101 with a minimum grade of D- or PSYC 101M with a minimum grade of D- "
    + "PSYC 102M with a minimum grade of D-");
  assert.ok(wellFormed(tree), `dangling operator: ${JSON.stringify(tree)}`);
  assert.deepEqual(tree[2], { note: "PSYC 101M PSYC 102M" });
});

test("legacy › a real four-digit course is NEVER downgraded to a note", () => {
  // The anchoring is what keeps LEGACY_COURSE off real codes: \d{2,3} cannot
  // consume four digits and still reach the end of the string. If this ever
  // fails, every prereq in the catalog is at risk of becoming inert prose.
  for (const text of ["CS 3500 with a minimum grade of C- or CS 2510",
                      "MATH 1341 and PHYS 1151",
                      "BIOL 2301 or BIOL 2309 or BIOL 1111"]) {
    for (const leaf of parsePrereqText(text)) {
      if (typeof leaf === "string") continue;
      assert.equal(leaf.note, undefined,
        `${text} → ${JSON.stringify(leaf)} became a note; a real course was silently disarmed`);
    }
  }
});

test("legacy › '(may be taken concurrently)' on a legacy code leaves no empty group", () => {
  // The second half of the same bug, and it survived the first fix:
  // extractConcurrentCourses matched only four-digit codes, so the
  // parenthetical stayed beside a code nothing could read and parsed as an
  // empty group — `{note}, "(", ")"` — which truncates the tree just as a
  // doubled operator does. 66 of the original 415 truncating trees were this.
  const { cleaned } = extractConcurrentCourses(
    "ACCT 2301 (may be taken concurrently) with a minimum grade of D- or "
    + "ACCT 217M (may be taken concurrently) with a minimum grade of D- or "
    + "ACCT 2302 (may be taken concurrently) with a minimum grade of D-");
  const tree = parsePrereqText(cleaned);
  assert.ok(wellFormed(tree), `dangling operator: ${JSON.stringify(tree)}`);
  for (let i = 1; i < tree.length; i++) {
    assert.ok(!(tree[i] === ")" && tree[i - 1] === "("),
      `empty () group survived: ${JSON.stringify(tree)}`);
  }
  assert.deepEqual(tree, [
    { subject: "ACCT", number: "2301", concurrent: true, minGrade: "D-" }, "Or",
    { note: "ACCT 217M" }, "Or",
    { subject: "ACCT", number: "2302", concurrent: true, minGrade: "D-" },
  ]);
});

test("legacy › a real course still gets its concurrent flag", () => {
  // Widening the number pattern must not cost the case it already handled.
  const { cleaned } = extractConcurrentCourses(
    "MATH 1341 (may be taken concurrently) with a minimum grade of D-");
  assert.deepEqual(parsePrereqText(cleaned), [
    { subject: "MATH", number: "1341", concurrent: true, minGrade: "D-" },
  ]);
});

test("legacy › a semicolon conjunction survives beside a note (implicit And)", () => {
  // GE 3300 states its top-level conjunction with a semicolon and no word.
  // extractOperators deletes `;`, so the conjunction survives only as
  // adjacency — and the implicit-And repair did not count a { note } as an
  // operand, so `{note} (` stopped the fold and discarded the entire second
  // group. The student loses a physics requirement, silently.
  const tree = parsePrereqText(
    "( MATH 1241 with a minimum grade of D- or MATH 1341 with a minimum grade of D- ) "
    + "or MATH 21EM with a minimum grade of D- ; "
    + "( PHYS 1151 with a minimum grade of D- or PHYS 261M with a minimum grade of D- )");
  assert.ok(prereqParseComplete(tree), `tree truncates: ${JSON.stringify(tree)}`);
  assert.deepEqual(tree.slice(5, 8), ["Or", { note: "MATH 21EM" }, "And"],
    "the implicit And between the note and the second group is missing");
  // The physics group must actually be in there — a fold that "completes"
  // because everything after the note was dropped would be the same bug.
  assert.ok(tree.some(t => t && t.subject === "PHYS" && t.number === "1151"),
    `the second group was discarded: ${JSON.stringify(tree)}`);
});

test("malformed upstream › '( or' is repaired by swapping, not by dropping", () => {
  // CHME 5649's prereq line is wrong in NEU's own catalog: they typed `)(`
  // where they meant `)` `or` `(`, so a group opened with a bare operator.
  // Dropping the stray paren would unbalance the tree (7 opens, 7 closes);
  // swapping restores the reading AND the balance.
  const src = "((( MATH 1341 with a minimum grade of D- or MATH 21EM with a minimum grade of D- ); "
    + "( MATH 1342 with a minimum grade of D- or MATH 211M with a minimum grade of D- ))"
    + "( or ( MATH 2321 with a minimum grade of D- or MATH 316M with a minimum grade of D- ); "
    + "( MATH 2341 with a minimum grade of D- or MATH 315M with a minimum grade of D- ))) "
    + "or graduate program admission";
  const tree = parsePrereqText(extractConcurrentCourses(src).cleaned);

  assert.ok(prereqParseComplete(tree), `tree truncates: ${JSON.stringify(tree)}`);
  assert.equal(tree.filter(t => t === "(").length, tree.filter(t => t === ")").length,
    "the repair unbalanced the parentheses");
  assert.ok(!tree.some((t, i) => i && (t === "And" || t === "Or")
                                 && (tree[i - 1] === "And" || tree[i - 1] === "Or")),
    `the repair introduced a doubled operator — it must run BEFORE the implicit-And pass: ${JSON.stringify(tree)}`);

  // The two calculus groups must be joined by Or, not And. Getting this
  // backwards would demand all four courses instead of either pair — the
  // expensive direction, since it refuses a plan that is actually valid.
  const closeOfFirstGroup = tree.indexOf(")", tree.findIndex(
    t => t && t.subject === "MATH" && t.number === "1342"));
  assert.equal(tree[closeOfFirstGroup + 2], "Or",
    `the two alternative course groups were ANDed together: ${JSON.stringify(tree)}`);
  // Every one of the four real courses survives the repair.
  for (const n of ["1341", "1342", "2321", "2341"]) {
    assert.ok(tree.some(t => t && t.subject === "MATH" && t.number === n),
      `MATH ${n} was lost: ${JSON.stringify(tree)}`);
  }
});

test("malformed upstream › a well-formed group is left completely alone", () => {
  // The repair must fire only on the invalid sequence. `( COURSE` and `( (`
  // are both legal openings and must be untouched.
  const before = parsePrereqText("( CS 2500 and CS 2510 ) or ( CS 1800 and CS 3500 )");
  assert.ok(prereqParseComplete(before));
  assert.deepEqual(before.filter(t => typeof t === "string"),
    ["(", "And", ")", "Or", "(", "And", ")"]);
});

test("legacy › a note leaf classifies as neutral, so it cannot satisfy a prereq", () => {
  // The whole safety of representing these as notes rests on neutrality: a
  // note that auto-satisfied would let a student skip ACCT 1201 outright,
  // which is far worse than the dangling operator this replaced.
  const [leaf] = parsePrereqText("ACCT 215M with a minimum grade of D-");
  assert.equal(conditionStatus(leaf.note, new Set()), null);
  assert.equal(conditionStatus(leaf.note, new Set(["grad-admission", "permission"])), null,
    "a legacy course note must not be satisfiable by any plan condition");
});

// UNIT · parseDescriptionPrereq — the "Requires prior completion of …" reader
// shared by scripts/scrape-catalog.js and courseNorm.js. Every case below is a
// verbatim description sentence from the live catalog, including its
// parentheticals and its curly apostrophe.
//
// The governing bias: a requirement must never come out looking STRICTER than
// the catalog states it, because the planner warns on unmet prerequisites and a
// false warning on a course a student may legitimately take is worse than
// showing nothing. Hence recommendations are ignored, "or equivalent" branches
// are preserved as notes, and prose naming no course stays informational rather
// than becoming a fabricated course dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDescriptionPrereq } from "../../src/adapters/northeastern/descriptionPrereq.js";

const eq = (desc, expected) =>
  assert.deepEqual(parseDescriptionPrereq(desc), expected, JSON.stringify(desc));

test("description prereq › nothing to find", () => {
  eq("", null);
  eq(undefined, null);
  eq("Covers further techniques and applications of integration.", null);
  // A labelled Prerequisite(s) line is the scraper's job, not this reader's.
  eq("Studies algorithms. Prerequisite(s): CS 2500 with a minimum grade of D-.", null);
});

test("description prereq › recommendations are never requirements", () => {
  // MATH 2321, verbatim — the reason ADVISORY exists. Turning this into a
  // prerequisite would warn students off Calculus 3 for no stated reason.
  eq("Offers a course in multivariable calculus. Prior completion of Calculus 2 is strongly recommended.", null);
  eq("Requires prior completion of a statistics course; MATH 2280 is recommended.", null);
  eq("Students are encouraged to have completed an introductory course.", null);
});

test("description prereq › coursework inside the course is not a prerequisite", () => {
  // EXRE 6500 and PPUA 6410, verbatim. Both read like prerequisites and are not.
  eq("Requires the completion of a project and presentation of the work.", null);
  eq("Requires students to submit a three-project portfolio developed from projects "
     + "completed within courses taken as part of fulfilling the degree requirements.", null);
});

test("description prereq › a named course becomes a real reference", () => {
  // MATH 1342 (Calculus 2) — the case this module exists for.
  eq("Covers further techniques of integration. Requires prior completion of MATH 1341 "
     + "or permission of head mathematics advisor.",
     [{ subject: "MATH", number: "1341" }, "Or", { note: "permission of head mathematics advisor" }]);

  // HINF 6335 — a bare single reference, no alternative branch.
  eq("Requires prior completion of HINF 5101.", [{ subject: "HINF", number: "5101" }]);
});

test("description prereq › every branch survives, including 'or equivalent'", () => {
  // ARMY 3301 — the branch that carries no condition keyword must not be
  // dropped, or the requirement reads stricter than the catalog states.
  eq("Requires prior completion of ARMY 1101, ARMY 1102, ARMY 2201, and ARMY 2202 "
     + "or equivalent military experience.",
     [{ subject: "ARMY", number: "1101" }, "And",
      { subject: "ARMY", number: "1102" }, "And",
      { subject: "ARMY", number: "2201" }, "And",
      { subject: "ARMY", number: "2202" }, "Or",
      { note: "equivalent military experience" }]);

  eq("Requires prior completion of EXSC 4500 or equivalent undergraduate course "
     + "or permission of instructor.",
     [{ subject: "EXSC", number: "4500" }, "Or",
      { note: "equivalent undergraduate course" }, "Or",
      { note: "permission of instructor" }]);
});

test("description prereq › a split parenthetical is not left unbalanced", () => {
  // ME 5665, verbatim (curly apostrophe included): splitting at "or" cuts
  // through "(Northeastern's BIOE 2350 or equivalent)" and used to leave
  // a stray bracket in the note.
  eq("Requires prior completion of an undergraduate course in biomechanics "
     + "(Northeastern’s BIOE 2350 or equivalent).",
     [{ subject: "BIOE", number: "2350" }, "Or", { note: "equivalent" }]);
});

test("description prereq › prose naming no course stays informational", () => {
  // No course reference may be invented from "one philosophy course".
  eq("Requires prior completion of two philosophy courses.",
     [{ note: "Requires prior completion of two philosophy courses" }]);
  eq("Requires prior completion of one laboratory science course or permission of instructor.",
     [{ note: "Requires prior completion of one laboratory science course or permission of instructor" }]);
  // CS 5600 — an admission gate with no "prior", still a genuine requirement.
  eq("Requires admission to MS program or completion of all transition courses.",
     [{ note: "Requires admission to MS program or completion of all transition courses" }]);
});

test("description prereq › grades are carried when the prose states one", () => {
  eq("Requires prior completion of CHEM 1211 with a minimum grade of C.",
     [{ subject: "CHEM", number: "1211", minGrade: "C" }]);
});

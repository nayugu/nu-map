// A catalog page that is not a PROGRAM.
//
// Every case here is a real page from the 2027 trees. The rule keeps exactly the 8
// dual-degree pages out of the 77 records that state no requirement table, and the cases
// that make it non-obvious are the ones that killed the three simpler rules I tried first:
// the `/dual-degrees/` path (6 of 8), the `" / "` title (admits a policy page), and an
// unanchored credential-word search (admits four more).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isProgramPage, titleNamesCredential, checkNonProgramRail,
} from "../../scripts/lib/non-program-pages.js";

const rec = (name, tablesPresent) => ({ name, metadata: { tablesPresent } });

test("a page with a requirement table is a program, whatever it is called", () => {
  // The primary signal, and it must not depend on the title at all: 374 of the 2,298
  // records that DO have tables carry no credential in their name (`Foundation Year`,
  // `General Education Requirements`, every `Graduate Certificate` title). A rule that
  // required both would delete all of them.
  assert.equal(isProgramPage(rec("Foundation Year", 5)), true);
  assert.equal(isProgramPage(rec("General Education Requirements", 13)), true);
  assert.equal(isProgramPage(rec("Master of Architecture—One-Year Program (Boston)", 2)), true);
  assert.equal(isProgramPage(rec("Experiential PhD (Boston)", 1)), true);
  assert.equal(isProgramPage(rec("Biology, Minor", 2)), true);
});

test("the eight dual degrees survive with no table, on their titles alone", () => {
  // NEU publishes the requirements on the two constituent degrees' pages, so there is
  // genuinely no table here. The record ships with its notes and an empty requirement set:
  // less information, which is acceptable. Deleting the program would be wrong information.
  for (const name of [
    "Law, JD / Business Administration, MBA—Full-Time (Boston)",
    "Law, JD / Criminology and Criminal Justice, MS (Boston)",
    "Law, JD / Criminology and Justice Policy, PhD (Boston)",
    "Law, JD / Public Health, MPH (Boston)",
    "Business Administration, MBA—Part-Time / Finance, MSF (Boston)",
    "Quantitative Finance, MSF / Business Administration, MBA—Full Time (Boston)",
    "Public Health, MPH / Health Informatics, MS (Boston)",
    "Public Health, MPH / Health Informatics, MS (Online)",
  ]) {
    assert.equal(isProgramPage(rec(name, 0)), true, `dropped a real dual degree: ${name}`);
  }
});

test("policy and department pages are dropped", () => {
  for (const name of [
    "Thesis Policy", "Transfer of Credit", "Grading", "Student Time Status",
    "Financial Aid", "Academic Standing Policy", "Course Registration",
    "Biology", "School of Journalism", "Mechanical and Industrial Engineering",
    "Art + Design", "Psychology", "Marine and Environmental Sciences",
  ]) {
    assert.equal(isProgramPage(rec(name, 0)), false, `kept a non-program: ${name}`);
  }
});

test("the anchor is what makes it a reading and not a keyword hit", () => {
  // Each of these is a real registrar page that an unanchored search for credential WORDS
  // admits. They are the reason the credential must sit after a comma or a slash — which is
  // where NEU actually prints one.
  for (const name of [
    "Certificate Policies and Procedures",
    "Graduate Certificate Programs",
    "Regulations and Requirements for Graduate Certificate Programs",
    "Regulations and Requirements for the Certificate of Advanced Graduate Study",
    "Regulations and Requirements for the Master's Degree",
    "The Master’s Degree Academic Requirements",
    "Master's Degrees",
    "Accelerated Bachelor/Graduate Degree Programs",
  ]) {
    assert.equal(titleNamesCredential(name), false, `matched a policy page: ${name}`);
  }
});

test("a slash in a policy title is not a dual degree", () => {
  // The case that killed the `" / "` rule outright.
  assert.equal(isProgramPage(rec("Course Retake / Course Substitution Policy", 0)), false);
});

test("titleNamesCredential reads the convention, both sides of the separator", () => {
  assert.equal(titleNamesCredential("Biology, MS (Boston)"), true);
  assert.equal(titleNamesCredential("History, Minor"), true);
  assert.equal(titleNamesCredential("Computer Science, BSCS (Boston)"), true);
  assert.equal(titleNamesCredential("Law, JD / Public Health, MPH (Boston)"), true);
  // A credential-looking word NOT in the position NEU prints one.
  assert.equal(titleNamesCredential("MS Excel Skills"), false);
  assert.equal(titleNamesCredential("Biology"), false);
  assert.equal(titleNamesCredential(""), false);
});

test("ABSENT is not zero — a record that never counted its tables is kept", () => {
  // Absent, empty and zero, again. A record from an older shape, or from a caller that does
  // not set the field, is one this filter has no evidence about; reading that as "no tables"
  // would delete it. The direction matters: keeping costs a noise row, dropping costs a
  // degree.
  assert.equal(isProgramPage({ name: "Thesis Policy", metadata: {} }), true);
  assert.equal(isProgramPage({ name: "Thesis Policy" }), true);
  assert.equal(isProgramPage({ name: "Thesis Policy", metadata: { tablesPresent: null } }), true);
  // ...but an explicit zero IS evidence.
  assert.equal(isProgramPage(rec("Thesis Policy", 0)), false);
});

test("junk in, no throw", () => {
  for (const bad of [null, undefined, {}, { metadata: null }, { name: 42, metadata: { tablesPresent: 0 } }]) {
    assert.equal(typeof isProgramPage(bad), "boolean", `threw or returned junk for ${JSON.stringify(bad)}`);
  }
});

// ── The bulk rail ──────────────────────────────────────────────────

test("the rail passes the real rate and refuses a catalog-wide collapse", () => {
  // Observed: 69 dropped of 1,304 discovered (5.3%).
  assert.equal(checkNonProgramRail(69, 1304).ok, true);
  // If NEU changed the requirement markup, `tablesPresent` reads 0 everywhere and this
  // filter would discard every degree we ship while every other rail saw a well-formed run
  // of nothing. That is the failure the ratio exists for.
  const bad = checkNonProgramRail(900, 1304);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /sc_courselist/, "the message must say how to check the premise");
});

test("the rail is a ratio, so it does not need re-tuning as the catalog grows", () => {
  // The same 5.3% share at four times the size must still pass. A COUNT-based rail would
  // have to be raised here, and a rail people raise is a rail that eventually sits above
  // the defect.
  assert.equal(checkNonProgramRail(276, 5216).ok, true);
  assert.equal(checkNonProgramRail(0, 0).ok, true, "an empty run has nothing to judge");
  assert.equal(checkNonProgramRail(0, 1304).ok, true);
});

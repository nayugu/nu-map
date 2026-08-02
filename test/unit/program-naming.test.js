// UNIT · src/adapters/northeastern/programNaming.js — folder slug → name/degree/campus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgram, fmtProgramLabel, fmtLocation } from "../../src/adapters/northeastern/programNaming.js";

test("parseProgram › splits name, degree and campus", () => {
  assert.deepEqual(parseProgram("computer_science_bscs_(boston)"), {
    name: "Computer Science", degree: "BSCS", location: "Boston",
    acronym: "cs", acronyms: ["cs"],
  });
});

test("parseProgram › uses the catalog's own degree casing, not uppercase", () => {
  const deg = f => parseProgram(f).degree;
  assert.equal(deg("chemical_engineering_bsche_(boston)"),  "BSChE");
  assert.equal(deg("computer_engineering_bscmpe_(boston)"), "BSCmpE");
  assert.equal(deg("bioengineering_bsbioe_(boston)"),       "BSBioE");
  assert.equal(deg("pharmacy_pharmd_(boston)"),             "PharmD");
  assert.equal(deg("chemistry_phd_(boston)"),               "PhD");
});

test("parseProgram › keeps delivery modality on the degree", () => {
  assert.equal(fmtProgramLabel("computer_science_mscsalign_(arlington)"), "Computer Science, MSCS—Align");
  assert.equal(fmtProgramLabel("business_administration_mbafull-time_(boston)"), "Business Administration, MBA—Full-Time");
  assert.equal(fmtProgramLabel("organizational_communication_graduate_certificateonline"),
    "Organizational Communication, Graduate Certificate—Online");
});

test("parseProgram › lowercases connectors instead of shouting them", () => {
  assert.equal(fmtProgramLabel("computer_science_and_biology_bs_(boston)"), "Computer Science and Biology, BS");
  assert.equal(fmtProgramLabel("law_and_public_policy_dlp_(boston)"), "Law and Public Policy, DLP");
});

test("parseProgram › keeps genuine acronyms uppercase", () => {
  assert.equal(fmtProgramLabel("applied_ai_mps_(boston)"), "Applied AI, MPS");
});

test("parseProgram › handles a degree that is qualified rather than final", () => {
  assert.equal(fmtProgramLabel("marine_biology_bs_with_three_seas_(boston)"), "Marine Biology, BS with Three Seas");
});

test("parseProgram › will not read a name word as a degree", () => {
  // "…_for_ba_students" — the connector guard stops "ba" being taken as a degree.
  assert.equal(parseProgram("additional_requirements_for_ba_students").degree, "");
  // "management" and "design" both start with degree stems.
  assert.equal(parseProgram("graphic_and_information_design_bfa_(boston)").name,
    "Graphic and Information Design");
});

test("parseProgram › acronym comes from the degree code, or an alias, else nothing", () => {
  assert.equal(parseProgram("computer_science_bscs_(boston)").acronym, "cs", "from BSCS");
  assert.equal(parseProgram("computer_science_minor").acronym, "cs", "no code, so from the alias list");
  assert.equal(parseProgram("cinema_studies_ba_(boston)").acronym, "", "initials only — not authoritative");
  assert.ok(parseProgram("cinema_studies_ba_(boston)").acronyms.includes("cs"), "but still matchable");
});

test("fmtLocation › multi-word and truncated campus tags", () => {
  assert.equal(fmtLocation("computer_science_mscs_(silicon_valley)"), "Silicon Valley");
  assert.equal(fmtLocation("media_and_screen_studies_and_english_ba_(boston"), "Boston",
    "one scraped folder is missing its closing paren");
  assert.equal(fmtLocation("animation_minor"), "");
});

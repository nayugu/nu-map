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

// ── Em dashes the slug welded shut ───────────────────────────────

test("parseProgram › restores an em dash between a degree and its modality", () => {
  // The slug drops the catalog's em dash, so "BSN—Transfer" arrives as one
  // token. Left unsplit, the whole code stayed stranded in the name
  // ("Nursing Bsntransfer Track").
  const cases = {
    "nursing_bsntransfer_track_(boston)":                          ["Nursing", "BSN—Transfer Track"],
    "nursing_bsnaccelerated_program_for_second-degree_students_(boston)":
      ["Nursing", "BSN—Accelerated Program for Second-Degree Students"],
    "nursing_msdirect_entry_(boston)":                             ["Nursing", "MS—Direct Entry"],
    "pharmacy_pharmddirect_entry_(boston)":                        ["Pharmacy", "PharmD—Direct Entry"],
    "physics_phdadvanced_entry_(boston)":                          ["Physics", "PhD—Advanced Entry"],
    "physical_therapy_dptpostbaccalaureate_entry_(boston)":        ["Physical Therapy", "DPT—Postbaccalaureate Entry"],
    "energy_systems_msenesacademic_link_(boston)":                 ["Energy Systems", "MSEneS—Academic Link"],
    "sustainable_urban_environments_mdesone-year_program_(boston)": ["Sustainable Urban Environments", "MDes—One-Year Program"],
  };
  for (const [slug, [name, degree]] of Object.entries(cases)) {
    const p = parseProgram(slug);
    assert.equal(p.name, name, slug);
    assert.equal(p.degree, degree, slug);
  }
});

test("parseProgram › restores an em dash inside the name", () => {
  // No degree stem anchors these, so the split comes off the modality suffix.
  assert.equal(fmtProgramLabel("applied_aiconnect_mps_(boston)"), "Applied AI—Connect, MPS");
  assert.equal(fmtProgramLabel("information_systemsonline_msis"), "Information Systems—Online, MSIS");
  assert.equal(fmtProgramLabel("master_of_architectureone-year_program_(boston)"),
    "Master of Architecture—One-Year Program");
  assert.equal(fmtProgramLabel("master_of_architecturethree-year_programadvanced_degree_entrance_(boston)"),
    "Master of Architecture—Three-Year Program—Advanced Degree Entrance",
    "two welds in one slug");
});

test("parseProgram › the welded-modality split does not loosen the connector guard", () => {
  // The guard exists for bare stems; welding must not become a way around it.
  assert.equal(parseProgram("additional_requirements_for_ba_students").degree, "");
  assert.equal(parseProgram("marine_biology_bs_with_three_seas_(boston)").degree, "BS with Three Seas");
  // Unchanged cases that already worked.
  assert.equal(fmtProgramLabel("computer_science_mscsalign_(arlington)"), "Computer Science, MSCS—Align");
  assert.equal(fmtProgramLabel("computer_science_bscs_(boston)"), "Computer Science, BSCS");
});

test("parseProgram › a name suffix only splits when a real head survives", () => {
  // "online" as the whole token is a name word, not a weld.
  assert.equal(parseProgram("online_ms_(boston)").name, "Online");
  // The suffix list deliberately omits "bridge", so a future Cambridge stays whole.
  assert.equal(parseProgram("cambridge_ba_(boston)").name, "Cambridge");
});

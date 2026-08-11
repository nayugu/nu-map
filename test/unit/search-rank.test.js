// UNIT · src/core/searchRank.js — order program search results by closeness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankOptions } from "../../src/core/searchRank.js";
import { parseProgram } from "../../src/adapters/northeastern/programNaming.js";

/** Build an option the way the loaders do, straight from a real folder slug. */
function opt(folder, grp = "2026 · Computer Information Science") {
  const p = parseProgram(folder);
  return {
    path: folder, folder, grp, ...p,
    label: p.degree ? `${p.name}, ${p.degree}` : p.name,
  };
}

const majors = [
  "computer_science_bscs_(boston)",
  "computer_science_bacs_(boston)",
  "computer_science_bscs_(oakland)",
  "computer_science_and_biology_bs_(boston)",
  "computer_science_and_biology_bs_(oakland)",
  "computer_science_and_behavioral_neuroscience_bs_(boston)",
  "computer_science_and_speech-language_pathology_and_audiology_bs_(boston)",
  "cinema_studies_ba_(boston)",
  "communication_studies_ba_(boston)",
  "physics_bs_(boston)",
  "economics_ba_(boston)",
  "biology_bs_(boston)",
  "cell_and_molecular_biology_bs_(boston)",
  "electrical_engineering_bsee_(boston)",
  "environmental_engineering_bsenve_(boston)",
  "chemical_engineering_bsche_(boston)",
  "chemical_engineering_and_physics_bsche_(boston)",
].map(f => opt(f));

const grad = [
  "computer_science_mscs_(boston)",
  "computer_science_phd_(boston)",
  "computer_science_graduate_certificate_(boston)",
].map(f => opt(f));

const rank = (options, q) => rankOptions(options, q).map(o => o.label + (o.location ? ` (${o.location})` : ""));

// ── The bug this module exists for ───────────────────────────────

test("rankOptions › the plain program outranks its combined majors", () => {
  const r = rank(majors, "computer science");
  assert.equal(r[0], "Computer Science, BSCS (Boston)");
  assert.ok(r.indexOf("Computer Science and Biology, BS (Boston)") > 2,
    "every plain CS variant comes before any combined major");
});

test("rankOptions › coverage orders combined majors by how much of the name is left over", () => {
  const r = rank(majors, "computer science");
  assert.ok(r.indexOf("Computer Science and Biology, BS (Boston)")
          < r.indexOf("Computer Science and Speech-Language Pathology and Audiology, BS (Boston)"),
    "the shorter combined name is the tighter match");
});

test("rankOptions › a query naming both halves still finds the combined major", () => {
  assert.equal(rank(majors, "computer science and biology")[0],
    "Computer Science and Biology, BS (Boston)");
});

// ── Acronyms ─────────────────────────────────────────────────────

test("rankOptions › an acronym beats a mid-word substring match", () => {
  // "cs" is inside physi(cs) and economi(cs); neither is what anyone means.
  const r = rank(majors, "cs");
  assert.equal(r[0], "Computer Science, BSCS (Boston)");
  assert.ok(r.indexOf("Physics, BS (Boston)") > r.indexOf("Cinema Studies, BA (Boston)"));
});

test("rankOptions › the degree code breaks acronym collisions", () => {
  // Cinema Studies and Communication Studies also initial to "cs"; only
  // Computer Science has NU's own BSCS code backing it.
  const r = rank(majors, "cs");
  assert.ok(r.indexOf("Computer Science, BSCS (Boston)") < r.indexOf("Cinema Studies, BA (Boston)"));
  assert.equal(rank(majors, "ee")[0], "Electrical Engineering, BSEE (Boston)",
    "BSEE outranks Environmental Engineering");
  assert.equal(rank(majors, "che")[0], "Chemical Engineering, BSChE (Boston)");
});

test("rankOptions › the degree itself is searchable", () => {
  assert.equal(rank(majors, "bscs")[0], "Computer Science, BSCS (Boston)");
});

// ── Multi-token queries ──────────────────────────────────────────

test("rankOptions › word prefixes match in order", () => {
  assert.equal(rank(majors, "comp sci")[0], "Computer Science, BSCS (Boston)");
});

test("rankOptions › an acronym combines with a campus", () => {
  const r = rank(majors, "cs oakland");
  assert.equal(r[0], "Computer Science, BSCS (Oakland)");
  assert.ok(!r.some(l => l.includes("(Boston)")), "Boston programs are filtered out");
});

test("rankOptions › a word-start match beats the same word mid-name", () => {
  const r = rank(majors, "biology");
  assert.equal(r[0], "Biology, BS (Boston)");
  assert.ok(r.indexOf("Cell and Molecular Biology, BS (Boston)") > 0);
});

// ── Tiebreaks ────────────────────────────────────────────────────

test("rankOptions › BS ranks before BA within the same campus", () => {
  const r = rank(majors, "computer science");
  assert.ok(r.indexOf("Computer Science, BSCS (Boston)") < r.indexOf("Computer Science, BACS (Boston)"));
});

test("rankOptions › Boston leads, then campuses alphabetically", () => {
  const r = rank(majors, "computer science bscs");
  assert.deepEqual(r.slice(0, 2), ["Computer Science, BSCS (Boston)", "Computer Science, BSCS (Oakland)"]);
});

test("rankOptions › a degree outranks a certificate on an otherwise exact tie", () => {
  const r = rank(grad, "computer science");
  assert.equal(r[0], "Computer Science, MSCS (Boston)");
  assert.equal(r.at(-1), "Computer Science, Graduate Certificate (Boston)");
});

// ── Fallbacks ────────────────────────────────────────────────────

test("rankOptions › typo tolerance via in-order subsequence", () => {
  // "compter" drops the 'u' from "computer" — still an in-order subsequence.
  const r = rank(majors, "compter science");
  assert.ok(r.length > 0, "a dropped letter still finds results");
  assert.ok(r[0].startsWith("Computer Science"));
});

test("rankOptions › options without parsed fields still rank off the label", () => {
  // Concentration entries are only { path, label } — no name/degree/acronyms.
  const bare = [
    { path: "a", label: "Artificial Intelligence" },
    { path: "b", label: "Software Engineering and Artificial Intelligence" },
  ];
  assert.equal(rankOptions(bare, "artificial intelligence")[0].path, "a");
});

test("rankOptions › matches on folder / group as a fallback", () => {
  assert.ok(rank(majors, "computer information").length > 0, "the group heading matches");
});

test("rankOptions › no match → empty; empty query → empty", () => {
  assert.deepEqual(rankOptions(majors, "zzzzzq"), []);
  assert.deepEqual(rankOptions(majors, "   "), []);
});

test("rankOptions › respects the result cap", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ path: `p${i}`, label: `Data Science ${i}`, location: "Boston" }));
  assert.equal(rankOptions(many, "data", 60).length, 60);
});

// ── Abbreviated components ───────────────────────────────────────

const combined = [
  "industrial_engineering_and_computer_science_bsie_(boston)",
  "industrial_engineering_and_business_administration_bsie_(boston)",
  "industrial_engineering_bsie_(boston)",
  "computer_science_and_mathematics_bs_(boston)",
  "civil_engineering_and_computer_science_bsce_(boston)",
  "mechanical_engineering_and_computer_science_bsme_(boston)",
  "electrical_and_computer_engineering_msece_(boston)",
  "american_sign_language_and_theatre_bs_(boston)",
  "global_studies_and_international_relations_ms_(boston)",
  "computer_science_bscs_(boston)",
  "biology_bs_(boston)",
].map(f => opt(f));

test("rankOptions › a component's initials find a combined major", () => {
  // The reported bug: BSIE supplies "ie", nothing supplied "cs", so the whole
  // query missed — while the strictly vaguer "ie and c" matched.
  assert.equal(rank(combined, "ie and cs")[0],
    "Industrial Engineering and Computer Science, BSIE (Boston)");
});

test("rankOptions › typing one more letter never drops the match", () => {
  // "ie and c" worked only because a bare "c" prefixes "Computer". Every
  // prefix of a query that matches must keep matching, or the result blinks out.
  const q = "ie and cs";
  const target = "Industrial Engineering and Computer Science, BSIE (Boston)";
  for (let i = 1; i <= q.length; i++) {
    assert.ok(rank(combined, q.slice(0, i)).includes(target),
      `"${q.slice(0, i)}" lost the program`);
  }
});

test("rankOptions › initials work for either component, with or without 'and'", () => {
  for (const q of ["ie cs", "ie and cs", "industrial and cs", "ie and computer science"]) {
    assert.equal(rank(combined, q)[0],
      "Industrial Engineering and Computer Science, BSIE (Boston)", `query "${q}"`);
  }
  assert.equal(rank(combined, "cs and math")[0], "Computer Science and Mathematics, BS (Boston)");
  assert.equal(rank(combined, "ce and cs")[0], "Civil Engineering and Computer Science, BSCE (Boston)");
  assert.equal(rank(combined, "asl and theatre")[0], "American Sign Language and Theatre, BS (Boston)");
});

test("rankOptions › initials skip connectors inside a run but never open on one", () => {
  assert.equal(rank(combined, "ece")[0], "Electrical and Computer Engineering, MSECE (Boston)");
  // "…and Business" must not be readable as "ab", nor "…and Mathematics" as
  // "am". Both names are free of those substrings, so a hit could only come
  // from a run opening on the connector.
  assert.ok(!rank(combined, "ab").includes("Industrial Engineering and Business Administration, BSIE (Boston)"));
  assert.ok(!rank(combined, "am").includes("Computer Science and Mathematics, BS (Boston)"));
  assert.ok(!rank(combined, "ac").includes("Electrical and Computer Engineering, MSECE (Boston)"));
});

test("rankOptions › a run is drawn from the name, not the degree or campus", () => {
  // "b" from Boston + "cs" from the acronym must not compose into a match, and
  // BSIE + Boston must not read as "bb".
  const cs = opt("computer_science_bscs_(boston)");
  assert.deepEqual(rankOptions([cs], "bc"), []);
  assert.deepEqual(rankOptions([cs], "bb"), []);
});

test("rankOptions › initials never outrank a real prefix or acronym match", () => {
  // "ie" is Industrial Engineering's own degree code; the combined majors that
  // merely contain an "ie" run must stay below the plain program.
  assert.equal(rank(combined, "ie")[0], "Industrial Engineering, BSIE (Boston)");
  assert.equal(rank(combined, "cs")[0], "Computer Science, BSCS (Boston)");
  // A whole-word prefix beats initials for the same query.
  const r = rank(combined, "international relations");
  assert.equal(r[0], "Global Studies and International Relations, MS (Boston)");
});

test("rankOptions › a run must be consecutive words", () => {
  const ie = "Industrial Engineering and Computer Science, BSIE (Boston)";
  // "is" would need Industrial…Science to be adjacent; they are not. (Token
  // order across the query is deliberately free — see the tier test below.)
  assert.ok(!rank(combined, "is").includes(ie));
  // "ic" is Industrial…Computer, separated by "Engineering" — and unlike "sc"
  // (which really does prefix "Science") it cannot match any single word.
  assert.ok(!rank(combined, "ic").includes(ie));
});

test("rankOptions › junk initials find nothing, and the matcher terminates", () => {
  assert.deepEqual(rankOptions(combined, "qq and zz"), []);
  // Pathological input: many repeated tokens against a long name must not hang.
  const long = [{ path: "x", label: Array.from({ length: 40 }, () => "aaa").join(" ") }];
  const t0 = Date.now();
  rankOptions(long, Array.from({ length: 12 }, () => "aa").join(" "));
  assert.ok(Date.now() - t0 < 500, "backtracking stays bounded");
});

test("rankOptions › component initials work in either order", () => {
  // Word prefixes were already order-free ("math and cs" = "cs and math"),
  // so initials mirror that rather than being the one ordered exception.
  const ie = "Industrial Engineering and Computer Science, BSIE (Boston)";
  assert.equal(rank(combined, "ie and cs")[0], ie);
  assert.equal(rank(combined, "cs and ie")[0], ie);
  assert.equal(rank(combined, "cs ie")[0], ie);
});

test("rankOptions › order is a tier, not a filter", () => {
  // Where two real programs are mirror images, the one that matches in the
  // typed order must still come first.
  const pair = [
    opt("chemical_engineering_and_environmental_engineering_bsche_(boston)"),
    opt("environmental_engineering_and_chemical_engineering_bsenve_(boston)"),
  ];
  // "che" then "es" reads Chemical…Environmental Sciences in order; reversing
  // the tokens must not promote it above the program that reads in order.
  assert.equal(rankOptions(pair, "ce and ee")[0].name,
    "Chemical Engineering and Environmental Engineering");
  assert.equal(rankOptions(pair, "ee and ce")[0].name,
    "Environmental Engineering and Chemical Engineering");
});

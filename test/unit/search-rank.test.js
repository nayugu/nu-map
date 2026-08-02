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

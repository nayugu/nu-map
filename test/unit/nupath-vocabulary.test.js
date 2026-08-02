// UNIT · the NUpath vocabulary and the WF inference in scripts/lib/nupath.js.
// Imports the real module (no mirror) — no network, no writes.
//
// Context: NU awards 13 NUpath codes but no single source lists all 13. The
// Tableau export has 12 indicator columns and encodes WF by listing those
// courses with every indicator N. We shipped 12 codes for a long time because
// nothing read that signal and nothing noticed a known code was unclaimed.
// These tests pin both the reading and the noticing.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  NUPATH_CODES, TABLEAU_COLUMN_CODES, WF_MAX_INFERRED, SOURCE_POLICY,
  parseNUPath, indicatorColToCode, inferFirstYearWriting, reportUnmapped,
  findAttributeText, policyFor, reconcileNuPath,
} from "../../scripts/lib/nupath.js";

// Column names exactly as they appear in the live export (27-JUL-26 refresh).
const LIVE_HEADERS = [
  "Advanced Writing Ind.", "Analyzing/Using Data Ind.", "Capstone Ind.",
  "Course ID ", "Course Number", "Creative Express/Innov Ind.",
  "Difference/Diversity Ind.", "Effective Term", "Ethical Reasoning Ind.",
  "Formal/Quant Reasoning Ind.", "Integration Experience Ind.",
  "Interpreting Culture Ind.", "Natural/Designed World Ind.", "Refresh Date",
  "Societies/Institutions Ind.", "Subject Code", "Title",
  "Writing Intensive Ind.", "Count of Course Number",
];
const LIVE_INDICATORS = LIVE_HEADERS.filter(h => h.endsWith("Ind.") && h !== "Count of Course Number");

test("vocabulary › 13 codes, and Tableau publishes all but WF as columns", () => {
  assert.equal(NUPATH_CODES.length, 13);
  assert.ok(NUPATH_CODES.includes("WF"));
  assert.equal(TABLEAU_COLUMN_CODES.length, 12);
  assert.ok(!TABLEAU_COLUMN_CODES.includes("WF"));
});

test("vocabulary › every live indicator column maps to a distinct code", () => {
  const codes = LIVE_INDICATORS.map(indicatorColToCode);
  assert.ok(!codes.includes(null), `unmapped: ${LIVE_INDICATORS.filter((_, i) => !codes[i])}`);
  assert.deepEqual([...new Set(codes)].sort(), [...TABLEAU_COLUMN_CODES].sort());
});

test("vocabulary › non-indicator columns map to nothing", () => {
  for (const h of ["Course ID ", "Subject Code", "Title", "Refresh Date", "Effective Term"]) {
    assert.equal(indicatorColToCode(h), null, h);
  }
});

test("vocabulary › writing codes are not confused for one another", () => {
  // "Advanced Writing" must not read as WI, and "Writing Intensive" not as WD.
  assert.equal(indicatorColToCode("Advanced Writing Ind."), "WD");
  assert.equal(indicatorColToCode("Adv Writ Dscpl Ind."),   "WD");
  assert.equal(indicatorColToCode("Writing Intensive Ind."), "WI");
  assert.equal(indicatorColToCode("1st Yr Writing Ind."),    "WF");
  // Punctuation variants normalize to the same code — the old map used
  // "first.year writing", a regex inside a substring test, which never matched.
  assert.equal(indicatorColToCode("First-Year Writing Ind."), "WF");
  assert.equal(indicatorColToCode("First Yr Writing Ind"),    "WF");
});

test("vocabulary › catalog attribute strings parse, including slash forms", () => {
  assert.deepEqual(parseNUPath("NUpath Natural/Designed World"), ["ND"]);
  assert.deepEqual(parseNUPath("NUpath Analyzing/Using Data"),   ["AD"]);
  assert.deepEqual(parseNUPath("NU Core/NUpath Adv Writ Dscpl"), ["WD"]);
  assert.deepEqual(parseNUPath("NU Core/NUpath 1st Yr Writing"), ["WF"]);
  // Multiple attributes on one line, returned sorted.
  assert.deepEqual(
    parseNUPath("NUpath Analyzing/Using Data, NUpath Capstone Experience"),
    ["AD", "CE"],
  );
  assert.deepEqual(parseNUPath(""), []);
});

// ── WF inference ────────────────────────────────────────────────────

/** A healthy export: the five all-N writing rows, a normal course, a total row. */
const healthyRows = () => new Map([
  ["ENG 1105",  []],
  ["ENG 1107",  []],
  ["ENGW 1102", []],
  ["ENGW 1111", []],
  ["ENGW 1114", []],
  ["ENGW 3302", ["WD"]],
  ["CS 2500",   ["FQ"]],
  ["All",       []],
]);

test("WF › all-N course rows become WF, total rows do not", () => {
  const { granted, skipped } = inferFirstYearWriting(healthyRows(), TABLEAU_COLUMN_CODES);
  assert.equal(skipped, false);
  assert.deepEqual(granted, ["ENG 1105", "ENG 1107", "ENGW 1102", "ENGW 1111", "ENGW 1114"]);
  assert.ok(!granted.includes("All"), "the grand-total row must never be granted WF");
});

test("WF › refuses when an indicator column is missing", () => {
  // A dropped column makes its courses read all-N. Granting them WF would be
  // wrong twice over: they lose their real code and gain one they lack.
  const { granted, skipped, reason } = inferFirstYearWriting(
    healthyRows(), TABLEAU_COLUMN_CODES.filter(c => c !== "WI"),
  );
  assert.equal(skipped, true);
  assert.deepEqual(granted, []);
  assert.match(reason, /WI/);
});

test("WF › refuses rather than mass-assigning when the export shape breaks", () => {
  const rows = new Map(
    Array.from({ length: WF_MAX_INFERRED + 1 }, (_, i) => [`XX ${1000 + i}`, []]),
  );
  const { granted, skipped, reason } = inferFirstYearWriting(rows, TABLEAU_COLUMN_CODES);
  assert.equal(skipped, true);
  assert.deepEqual(granted, []);
  assert.match(reason, /exceeds/);
});

// ── Fidelity guard ──────────────────────────────────────────────────

test("guard › a healthy parse reports nothing", () => {
  const rows = healthyRows();
  for (const key of inferFirstYearWriting(rows, TABLEAU_COLUMN_CODES).granted) {
    rows.set(key, ["WF"]);
  }
  // Give every remaining code a claimant so absentCodes is genuinely empty.
  for (const code of TABLEAU_COLUMN_CODES) rows.set(`ZZ ${1000 + TABLEAU_COLUMN_CODES.indexOf(code)}`, [code]);

  const r = reportUnmapped(LIVE_HEADERS, LIVE_INDICATORS, rows);
  assert.deepEqual(r.unmappedIndicators, []);
  assert.deepEqual(r.absentCodes, []);
  assert.deepEqual(r.zeroCodeRows, []);
});

test("guard › catches the failure that shipped: WF unclaimed, rows left empty", () => {
  // Exactly the pre-fix state — WF never inferred, five rows left with no code.
  const rows = healthyRows();
  for (const code of TABLEAU_COLUMN_CODES) rows.set(`ZZ ${1000 + TABLEAU_COLUMN_CODES.indexOf(code)}`, [code]);

  const r = reportUnmapped(LIVE_HEADERS, LIVE_INDICATORS, rows);
  assert.deepEqual(r.absentCodes, ["WF"]);
  assert.deepEqual(r.zeroCodeRows,
    ["ENG 1105", "ENG 1107", "ENGW 1102", "ENGW 1111", "ENGW 1114"]);
});

test("guard › catches a new or renamed indicator column", () => {
  const headers = [...LIVE_HEADERS, "Global Engagement Ind."];
  const r = reportUnmapped(headers, LIVE_INDICATORS, healthyRows());
  assert.deepEqual(r.unmappedIndicators, ["Global Engagement Ind."]);
});

// ── Catalog attribute line ──────────────────────────────────────────

test("attribute line › found by label text, not by class", () => {
  // The real markup: <p class="courseblockextra noindent"><strong>Attribute(s):
  // </strong> NUpath Ethical Reasoning,  NUpath Societies/Institutions</p>
  // Nothing in that class name says "attribute" or "nupath", which is why the
  // old class-based selector matched zero blocks on every page.
  const texts = [
    "PHIL 1101.  Introduction to Philosophy.  (4 Hours)",
    "Introduces philosophy through classic texts.",
    "Attribute(s):  NUpath Ethical Reasoning,  NUpath Societies/Institutions",
  ];
  assert.deepEqual(parseNUPath(findAttributeText(texts)), ["ER", "SI"]);
});

test("attribute line › tolerates nbsp and returns empty when absent", () => {
  assert.equal(findAttributeText(["Attribute(s): NUpath Writing Intensive"]).includes("Writing"), true);
  assert.equal(findAttributeText(["Prerequisite(s): ENGW 1111", "A description."]), "");
  assert.equal(findAttributeText([]), "");
  assert.equal(findAttributeText(undefined), "");
});

// ── Source policy ───────────────────────────────────────────────────

test("policy › Tableau is authoritative, the catalog is not", () => {
  assert.equal(policyFor("Tableau CSV (direct)").authoritative, true);
  assert.equal(policyFor("Tableau REST API").authoritative, true);
  assert.equal(policyFor("catalog.northeastern.edu").authoritative, false);
  // The catalog cannot express the two codes it never prints.
  assert.ok(!policyFor("catalog.northeastern.edu").codes.includes("WF"));
  assert.ok(!policyFor("catalog.northeastern.edu").codes.includes("WD"));
});

test("reconcile › the catalog fallback can never delete WF or WD", () => {
  // The exact regression: catalog reads ENGW 1111 as having no attributes.
  // Applied naively that clears WF. It must be preserved instead.
  assert.deepEqual(
    reconcileNuPath(["WF"], [], SOURCE_POLICY.catalog), ["WF"]);
  assert.deepEqual(
    reconcileNuPath(["WD"], [], SOURCE_POLICY.catalog), ["WD"]);
});

test("reconcile › the fallback adds but never removes", () => {
  // Adds what it found…
  assert.deepEqual(
    reconcileNuPath(["IC"], ["IC", "SI"], SOURCE_POLICY.catalog), ["IC", "SI"]);
  // …and keeps what it didn't mention, even for codes it *can* express.
  assert.deepEqual(
    reconcileNuPath(["IC", "SI", "WI"], ["IC"], SOURCE_POLICY.catalog), ["IC", "SI", "WI"]);
});

test("reconcile › Tableau may remove, but only codes it can express", () => {
  // A genuine removal from the authority takes effect…
  assert.deepEqual(
    reconcileNuPath(["IC", "SI", "WI"], ["IC", "SI"], SOURCE_POLICY.tableau), ["IC", "SI"]);
  // …and Tableau can express all 13, so nothing is force-kept.
  assert.deepEqual(
    reconcileNuPath(["WF"], [], SOURCE_POLICY.tableau), []);
});

test("reconcile › output is sorted and deduplicated", () => {
  assert.deepEqual(
    reconcileNuPath(["WI", "IC"], ["IC", "AD"], SOURCE_POLICY.tableau), ["AD", "IC"]);
  assert.deepEqual(
    reconcileNuPath(["WF", "IC"], ["IC", "IC"], SOURCE_POLICY.catalog), ["IC", "WF"]);
});

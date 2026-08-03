// Course-code parsing — separators are irrelevant, subjects carry forward.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCourseCodes, readSubstitutionIntent, normalizeCodeQuery,
         parseCodeTerms } from "../../src/core/courseCodeParse.js";

const codes = s => parseCourseCodes(s).codes;

test("parse › separators do not matter", () => {
  for (const s of ["phys 1163 phys1173", "PHYS1163,PHYS1173", "phys1163 phys 1173",
                   "phys1163/phys1173", "phys1163phys1173", "  PHYS  1163 ,, phys1173 "]) {
    assert.deepEqual(codes(s), ["PHYS 1163", "PHYS 1173"], s);
  }
});

test("parse › subject carries forward to a bare number", () => {
  assert.deepEqual(codes("phys 1163 1173"), ["PHYS 1163", "PHYS 1173"]);
  assert.deepEqual(codes("phys1151 1152 1153"),
                   ["PHYS 1151", "PHYS 1152", "PHYS 1153"]);
});

test("parse › a new subject overrides the carried one", () => {
  assert.deepEqual(codes("phys1163 chem1161"), ["PHYS 1163", "CHEM 1161"]);
});

test("parse › a bare number with no subject before it is dropped", () => {
  // "1163" alone is ambiguous across ~200 subjects; never guess.
  assert.deepEqual(codes("1163"), []);
  assert.deepEqual(codes("1163 phys1173"), ["PHYS 1173"]);
});

test("parse › duplicates collapse, order is preserved", () => {
  assert.deepEqual(codes("phys1163 phys1163 phys1151"), ["PHYS 1163", "PHYS 1151"]);
});

test("parse › a trailing subject is reported as partial, not a code", () => {
  const r = parseCourseCodes("phys 1163 ch");
  assert.deepEqual(r.codes, ["PHYS 1163"]);
  assert.equal(r.partialSubject, "CH");
  // A complete code leaves nothing pending.
  assert.equal(parseCourseCodes("phys 1163").partialSubject, null);
});

test("parse › empty and junk input is safe", () => {
  for (const s of ["", null, undefined, "   ", "!!!", "??"]) assert.deepEqual(codes(s), []);
});

test("intent › one code asks for suggestions", () => {
  const i = readSubstitutionIntent("phys1163");
  assert.equal(i.kind, "suggest");
  assert.equal(i.from, "PHYS 1163");
});

test("intent › two codes state a substitution", () => {
  const i = readSubstitutionIntent("phys1163 phys1173");
  assert.equal(i.kind, "pair");
  assert.equal(i.from, "PHYS 1163");
  assert.deepEqual(i.to, ["PHYS 1173"]);
});

test("intent › three or more codes pair the first with each of the rest", () => {
  const i = readSubstitutionIntent("ge1110 ge1501 ge1502");
  assert.equal(i.kind, "pair");
  assert.equal(i.from, "GE 1110");
  assert.deepEqual(i.to, ["GE 1501", "GE 1502"]);
});

test("intent › no codes falls back to search", () => {
  assert.equal(readSubstitutionIntent("organic chem").kind, "search");
});

test("normalize › a code typed without a space still matches the haystack", () => {
  assert.equal(normalizeCodeQuery("phys1111"), "phys 1111");
  assert.equal(normalizeCodeQuery("PHYS 1111"), "PHYS 1111");
  assert.equal(normalizeCodeQuery("  phys  1111 "), "phys 1111");
  assert.equal(normalizeCodeQuery("organic chem"), "organic chem");
  assert.equal(normalizeCodeQuery(""), "");
});

// ── prefix terms: the substitutions box is a search, so each code is a filter ──

test("terms › one course, complete or partial", () => {
  assert.deepEqual(parseCodeTerms("phys"), ["PHYS"]);
  assert.deepEqual(parseCodeTerms("phys116"), ["PHYS 116"]);
  assert.deepEqual(parseCodeTerms("phys1163"), ["PHYS 1163"]);
});

test("terms › two courses, any separator or none", () => {
  for (const s of ["phys1151phys1161", "phys1151, phys1161", "phys 1151 phys 1161",
                   "PHYS1151/PHYS1161"]) {
    assert.deepEqual(parseCodeTerms(s), ["PHYS 1151", "PHYS 1161"], s);
  }
});

test("terms › subject carries forward to a bare number", () => {
  assert.deepEqual(parseCodeTerms("phys 1151 1161"), ["PHYS 1151", "PHYS 1161"]);
});

test("terms › both sides may be partial", () => {
  assert.deepEqual(parseCodeTerms("phys115 phys116"), ["PHYS 115", "PHYS 116"]);
});

test("terms › a leading bare number is ignored", () => {
  assert.deepEqual(parseCodeTerms("1163"), []);
});

test("terms › a run of digits is chunked in FOURS, the real invariant", () => {
  // No separators at all. Taking the digit run whole gave "PHYS 11511161".
  assert.deepEqual(parseCodeTerms("phys11511161"), ["PHYS 1151", "PHYS 1161"]);
  assert.deepEqual(parseCodeTerms("PHYS 1151 1161"), ["PHYS 1151", "PHYS 1161"]);
});

test("terms › a trailing short chunk stays a prefix", () => {
  assert.deepEqual(parseCodeTerms("phys1151116"), ["PHYS 1151", "PHYS 116"]);
  assert.deepEqual(parseCodeTerms("phys11"), ["PHYS 11"]);
});

test("terms › two bare subjects both survive", () => {
  assert.deepEqual(parseCodeTerms("phys chem"), ["PHYS", "CHEM"]);
});

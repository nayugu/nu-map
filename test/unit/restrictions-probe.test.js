// ═══════════════════════════════════════════════════════════════════
// RESTRICTIONS PROBE — the heading grammar and the sampler
//
// The probe's whole job is to tell us which restriction KINDS Banner publishes.
// If its heading grammar silently fails to recognise one, the probe reports
// "this kind does not exist" and we design around a gap that is really a bug.
// So these tests attack the grammar rather than confirm it: the codes that
// collide, the spacing Banner is inconsistent about, the multi-word kinds, and
// the headings that must NOT be swallowed.
// ═══════════════════════════════════════════════════════════════════

import test          from "node:test";
import assert        from "node:assert/strict";

import { parseRestrictions }                        from "../../scripts/lib/class-standing.js";
import { splitHeading, codeOf, labelOf, chooseCrns, crnsForCourses, analyse,
         coalesceValues, decodeEntities }
                                                    from "../../scripts/restrictions-probe.js";

// ── Heading grammar ─────────────────────────────────────────────────

test("the four heading shapes we have real evidence for", () => {
  assert.deepEqual(splitHeading("Must be enrolled in one of the following Classes:"),
    { kind: "Classes", polarity: "must" });
  assert.deepEqual(splitHeading("Must be enrolled in one of the following Levels:"),
    { kind: "Levels", polarity: "must" });
  assert.deepEqual(splitHeading("Cannot be enrolled in one of the following Classes:"),
    { kind: "Classes", polarity: "not" });
  assert.deepEqual(splitHeading("Must be enrolled in one of the following Majors:"),
    { kind: "Majors", polarity: "must" });
});

test("a MULTI-WORD kind survives intact", () => {
  // "Fields of Study" is the case a greedy or single-token capture mangles, and
  // it is one of the kinds we most expect to find. `Concentrations` likewise.
  assert.deepEqual(splitHeading("Must be enrolled in one of the following Fields of Study:"),
    { kind: "Fields of Study", polarity: "must" });
  assert.deepEqual(splitHeading("Cannot be enrolled in one of the following Student Attributes:"),
    { kind: "Student Attributes", polarity: "not" });
});

test("things that are not headings at all are refused, not guessed at", () => {
  for (const h of [
    "Not all restrictions are applicable.",   // Banner's own notice — no colon
    "",
    "following Classes:",                     // no verb, and not Noun-shaped
    "Must be enrolled in Classes",            // no trailing colon
    "  :",
    "123:",                                   // not a noun
  ]) {
    assert.equal(splitHeading(h), null, `should refuse: ${JSON.stringify(h)}`);
  }
});

test("a bare Noun: heading is classified `info`, never dropped", () => {
  // Measured on the first live sample: "Special Approvals:" carries the value
  // "Advisor's Signature" on 15% of sections. It is not a gate on WHO may
  // enrol, so it must not join must/not — but dropping it would have reported
  // that the kind does not exist, which is the failure this probe exists to
  // prevent. Capture it and label it honestly.
  assert.deepEqual(splitHeading("Special Approvals:"),
    { kind: "Special Approvals", polarity: "info" });
  for (const h of ["Prerequisites:", "Corequisites:", "Attributes:", "Mutual Exclusion:"]) {
    const s = splitHeading(h);
    assert.ok(s, `should capture: ${h}`);
    assert.equal(s.polarity, "info");
  }
});

test("an enrolment verb always beats the bare-noun branch", () => {
  // "Attributes:" is info, but "Must be enrolled in one of the following
  // Attributes:" is a real gate. If the bare branch ran first they would merge.
  assert.deepEqual(splitHeading("Must be enrolled in one of the following Attributes:"),
    { kind: "Attributes", polarity: "must" });
});

test("junk input does not throw", () => {
  for (const bad of [null, undefined, 0, {}, [], NaN]) {
    assert.doesNotThrow(() => splitHeading(bad));
    assert.equal(splitHeading(bad), null);
  }
});

// ── Codes and labels ────────────────────────────────────────────────

test("Banner's inconsistent spacing yields the same code", () => {
  // "Junior (JR)" sits beside "Senior(SR)" in the SAME list on real pages.
  assert.equal(codeOf("Junior (JR)"), "JR");
  assert.equal(codeOf("Senior(SR)"),  "SR");
  assert.equal(codeOf("Freshmen ( FR )"), "FR");
});

test("codes longer than two characters are kept", () => {
  // The standing vocabulary is 2 letters, but major/college codes are not —
  // `standingKey` restricts to /[A-Za-z]{2}/ and would drop these, which is
  // exactly why the probe must not reuse it.
  assert.equal(codeOf("Business Admin and Law (BALW)"), "BALW");
  assert.equal(codeOf("Undergraduate (UG)"), "UG");
  assert.equal(codeOf("Bouve College (BV)"), "BV");
});

test("a label containing its own parentheses keeps them", () => {
  assert.equal(codeOf("Engineering (Boston) (EN)"), "EN");
  assert.equal(labelOf("Engineering (Boston) (EN)"), "Engineering (Boston)");
});

test("a value with no code at all degrades to null, never to a wrong code", () => {
  assert.equal(codeOf("Engineering"), null);
  assert.equal(codeOf(""), null);
  assert.equal(labelOf("Engineering"), "Engineering");
});

// ── The comma-split defect, from real captured markup ───────────────

test("a value split at its commas is rejoined into ONE value", () => {
  // Verbatim from .cache/banner/restrictions/202530/40487.html — Banner emits
  // one campus as two spans, splitting the label at its comma.
  assert.deepEqual(coalesceValues(["Toronto", " Canada (TOR)"]),
    ["Toronto, Canada (TOR)"]);
  // …and from 30336.html, one MAJOR split the same way. Read naively this
  // invents a codeless "Politics" and mislabels PPBA as "Phil & Econ/Bus Adm".
  assert.deepEqual(coalesceValues(["Politics", " Phil &amp; Econ/Bus Adm (PPBA)"]),
    ["Politics, Phil & Econ/Bus Adm (PPBA)"]);
  assert.equal(codeOf(coalesceValues(["Politics", " Phil &amp; Econ/Bus Adm (PPBA)"])[0]), "PPBA");
});

test("values that each carry their own code are NOT merged", () => {
  // The Classes case, which is why this defect stayed latent: no commas.
  assert.deepEqual(coalesceValues(["Junior (JR)", "Senior(SR)"]),
    ["Junior (JR)", "Senior(SR)"]);
  assert.equal(coalesceValues(["Junior (JR)", "Senior(SR)"]).length, 2);
});

test("a codeless run is kept, not swallowed", () => {
  // "Special Approvals" values have no code at all. Dropping a trailing
  // buffer would silently lose the entire kind.
  assert.deepEqual(coalesceValues(["Advisor&#39;s Signature"]), ["Advisor's Signature"]);
  assert.deepEqual(coalesceValues(["Instructor", "Department Head"]),
    ["Instructor, Department Head"]);
});

test("coalesceValues survives junk", () => {
  assert.deepEqual(coalesceValues([]), []);
  assert.deepEqual(coalesceValues(null), []);
  assert.deepEqual(coalesceValues(["", "   ", null, undefined]), []);
});

test("entity decoding does not mangle a real registrar label", () => {
  assert.equal(decodeEntities("D&#39;Amore-McKim School Business"),
    "D'Amore-McKim School Business");
  assert.equal(decodeEntities("Phil &amp; Econ"), "Phil & Econ");
  // &amp;#39; must decode to &#39;, not to an apostrophe — one pass only.
  assert.equal(decodeEntities("plain text"), "plain text");
});

// ── The collision that already bit this repo ────────────────────────

test("Journalism (JR) and Junior (JR) are kept apart by their HEADING", () => {
  // class-standing.test.js guards `classesOf` against reading a Majors block as
  // a Classes block. The probe must keep the same discipline for the opposite
  // reason: it tallies BOTH kinds, so a code keyed without its heading would
  // merge a major into the standing vocabulary and report a phantom.
  const page = `
    <span class="status-bold">Must be enrolled in one of the following Classes:</span>
    <span class="detail-popup-indentation">Junior (JR)</span>
    <span class="status-bold">Must be enrolled in one of the following Majors:</span>
    <span class="detail-popup-indentation">Journalism (JR)</span>`;

  const parsed = parseRestrictions(page);
  const seen = new Map();
  for (const [head, values] of Object.entries(parsed)) {
    const s = splitHeading(head);
    assert.ok(s, `heading not recognised: ${head}`);
    seen.set(`${s.kind}|${s.polarity}`, values.map(codeOf));
  }

  assert.deepEqual(seen.get("Classes|must"), ["JR"]);
  assert.deepEqual(seen.get("Majors|must"),  ["JR"]);
  assert.equal(seen.size, 2, "the two JR values must not collapse into one bucket");
  // And the labels are what distinguish them for a human reader.
  assert.notEqual(labelOf("Junior (JR)"), labelOf("Journalism (JR)"));
});

// ── The silent-{} failure this probe exists to catch ────────────────

test("a page whose heading the PARSER misses is reported, not counted as clean", () => {
  // The real risk: Banner renders some kind with different markup, so
  // parseRestrictions returns {} and the probe would otherwise conclude the
  // kind does not exist. `analyse` flags any page that looks like it carries a
  // heading but parsed to nothing, and main() exits 3 on it.
  const unparseable = `<div><b>Must be enrolled in one of the following Cohorts:</b>
    <li>Honors (HON)</li></div>`;
  // Sanity: the fixture really does defeat the parser.
  assert.deepEqual(parseRestrictions(unparseable), {});

  const a = analyse("202530", [{ courseId: "X1000", crn: "1", html: unparseable }]);
  assert.equal(a.unparsed, 0,
    "the heuristic looks for `following …:</span>`, so non-span markup is not flagged");

  // The shape that IS flagged: a span-wrapped heading the regex fails on.
  const spanned = `<span class="status-boldx">Must be enrolled in one of the following Cohorts:</span>
    <span class="detail-popup-indentation">Honors (HON)</span>`;
  assert.deepEqual(parseRestrictions(spanned), {}, "class typo defeats the parser");
  const b = analyse("202530", [{ courseId: "X1000", crn: "2", html: spanned }]);
  assert.equal(b.unparsed, 1, "a span-wrapped heading that parsed to {} must be loud");
});

test("a genuinely empty restrictions page is clean, not a failure", () => {
  const empty = `<section aria-labelledby="restrictions">
    <div class="infoicon"><span class="status-bold">Not all restrictions are applicable.</span></div>
    </section>`;
  const a = analyse("202530", [{ courseId: "X1000", crn: "3", html: empty }]);
  assert.equal(a.unparsed, 0);
  assert.equal(a.withAny, 0);
  assert.equal(a.kinds.size, 0);
});

// ── Within-course agreement, the stratum the sampler exists for ─────

test("analyse detects sections of one course DISAGREEING", () => {
  const gated = (cls) => `<span class="status-bold">Must be enrolled in one of the following Classes:</span>
    <span class="detail-popup-indentation">${cls}</span>`;
  const a = analyse("202530", [
    { courseId: "PJM4850", crn: "1", html: gated("Senior(SR)") },
    { courseId: "PJM4850", crn: "2", html: "<section></section>" },
  ]);
  // PJM 4850 is the real counterexample: gated on 1 of its 2 sections. The
  // probe must surface that rather than fold it away.
  assert.equal(a.perPage.length, 2);
  assert.equal(a.perPage[0].blocks.length, 1);
  assert.equal(a.perPage[1].blocks.length, 0);
  assert.equal(a.withAny, 1, "one of the two sections carries a restriction");
});

// ── Sampler ─────────────────────────────────────────────────────────

test("chooseCrns respects the budget and prefers multi-section courses", () => {
  const byCourse = new Map();
  for (let i = 0; i < 200; i++) byCourse.set(`SUBJ${1000 + i}`, [`c${i}a`]);
  for (let i = 0; i < 40; i++)  byCourse.set(`MULT${2000 + i}`, [`m${i}a`, `m${i}b`, `m${i}c`]);

  const { picked, used } = chooseCrns(byCourse, 100);
  assert.ok(used <= 100, `budget exceeded: ${used}`);
  assert.ok(used > 0);
  const multiPicked = [...picked.keys()].filter(k => k.startsWith("MULT"));
  assert.ok(multiPicked.length > 0, "no multi-section course sampled — stratum A is empty");
  for (const crns of picked.values()) assert.ok(crns.length <= 8, "per-course cap breached");
});

test("chooseCrns is deterministic", () => {
  const build = () => {
    const m = new Map();
    for (let i = 0; i < 50; i++) m.set(`S${i}`, [`x${i}`, `y${i}`]);
    return m;
  };
  const a = chooseCrns(build(), 40);
  const b = chooseCrns(build(), 40);
  assert.deepEqual([...a.picked.keys()], [...b.picked.keys()]);
  assert.equal(a.used, b.used);
});

test("chooseCrns honours an `allowed` restriction", () => {
  const byCourse = new Map();
  for (let i = 0; i < 60; i++) byCourse.set(`S${1000 + i}`, [`a${i}`, `b${i}`]);
  const allowed = new Set(["S1000", "S1005", "S1010"]);
  const { picked } = chooseCrns(byCourse, 100, allowed);
  assert.deepEqual([...picked.keys()].sort(), ["S1000", "S1005", "S1010"],
    "must not sample a course outside the intersection");
});

test("crnsForCourses asks every term for the SAME courses", () => {
  // The fix for the 30-course cross-term base: the list is chosen once, and
  // each term expands it against its own inventory.
  const list = ["A1000", "B2000", "C3000"];
  const termA = new Map([["A1000", ["a1", "a2"]], ["B2000", ["b1"]], ["C3000", ["c1"]]]);
  const termB = new Map([["A1000", ["x9"]],       ["B2000", ["y8", "y7"]], ["C3000", ["z6"]]]);

  const A = crnsForCourses(list, termA);
  const B = crnsForCourses(list, termB);
  assert.deepEqual([...A.picked.keys()], [...B.picked.keys()],
    "the two terms must cover an identical course set");
  assert.equal(A.used, 4);
  assert.equal(B.used, 4);
  // CRNs differ per term, which is the whole point of comparing them.
  assert.notDeepEqual(A.picked.get("A1000"), B.picked.get("A1000"));
});

test("a course missing from one term is skipped, not an error", () => {
  // A course can simply not run in a term. That is not a failure and must not
  // abort the run — it just cannot contribute to cross-term agreement.
  const list = ["A1000", "GONE", "C3000"];
  const term = new Map([["A1000", ["a1"]], ["C3000", ["c1"]]]);
  const { picked, used } = crnsForCourses(list, term);
  assert.deepEqual([...picked.keys()], ["A1000", "C3000"]);
  assert.equal(used, 2);
  assert.doesNotThrow(() => crnsForCourses(list, new Map()));
  assert.equal(crnsForCourses(list, new Map()).used, 0);
});

test("crnsForCourses caps per course so one big lecture cannot eat the budget", () => {
  const list = ["BIG"];
  const term = new Map([["BIG", Array.from({ length: 30 }, (_, i) => `c${i}`)]]);
  assert.equal(crnsForCourses(list, term).used, 8);
  assert.equal(crnsForCourses(list, term, 3).used, 3);
});

test("chooseCrns survives degenerate inputs", () => {
  assert.doesNotThrow(() => chooseCrns(new Map(), 100));
  assert.equal(chooseCrns(new Map(), 100).used, 0);
  const one = new Map([["A1000", ["c1"]]]);
  assert.equal(chooseCrns(one, 100).used, 1);
  assert.equal(chooseCrns(one, 0).used, 0, "a zero budget must fetch nothing");
});

// ═══════════════════════════════════════════════════════════════════
// RESTRICTIONS PROBE — the silent-{} guard and the sampler
//
// The probe's job is to tell us which restriction KINDS Banner publishes. Its
// worst failure is not being wrong, it is being SILENT: a kind rendered with
// markup `parseRestrictions` does not match produces `{}`, and the probe would
// report that the kind does not exist. So the guard that matters is the one
// that notices a page whose raw HTML clearly carries a heading and which parsed
// to nothing — and `main()` exits 3 on it.
//
// The heading grammar, the code reader and the label reader are tested in
// restrictions.test.js, where they now live. This file covers only what is
// still the probe's own.
// ═══════════════════════════════════════════════════════════════════

import test   from "node:test";
import assert from "node:assert/strict";

import { parseRestrictions }        from "../../scripts/lib/class-standing.js";
import { chooseCrns, analyse }      from "../../scripts/restrictions-probe.js";

// ── The silent-{} failure this probe exists to catch ────────────────

test("a page whose heading the PARSER misses is reported, not counted as clean", () => {
  // A span-wrapped heading the class selector fails on: parseRestrictions
  // returns {} and, without this, the run would look clean.
  const spanned = `<span class="status-boldx">Must be enrolled in one of the following Cohorts:</span>
    <span class="detail-popup-indentation">Honors (HON)</span>`;
  assert.deepEqual(parseRestrictions(spanned), {}, "class typo defeats the parser");
  const a = analyse("202530", [{ courseId: "X1000", crn: "2", html: spanned }]);
  assert.equal(a.unparsed, 1, "a span-wrapped heading that parsed to {} must be loud");
});

test("the guard's reach is bounded, and that bound is stated", () => {
  // It looks for `following …:</span>`, so a kind rendered in entirely
  // different markup is NOT flagged. Asserting the limit rather than pretending
  // it is airtight: the probe cannot detect a pane it has never seen the shape
  // of, and a reader should know that before trusting a clean run.
  const nonSpan = `<div><b>Must be enrolled in one of the following Cohorts:</b>
    <li>Honors (HON)</li></div>`;
  assert.deepEqual(parseRestrictions(nonSpan), {});
  assert.equal(analyse("202530", [{ courseId: "X", crn: "1", html: nonSpan }]).unparsed, 0);
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

test("an unrecognised heading is counted and surfaced, never dropped", () => {
  // How a kind whose WORDING we did not anticipate gets found. It parses fine
  // but the grammar declines it, so it must reach `unknownHeadings` and be
  // printed rather than vanish.
  const odd = `<span class="status-bold">Some Future Pane:</span><br/>
    <span class="detail-popup-indentation">whatever (WHV)</span>`;
  const a = analyse("202530", [{ courseId: "X1000", crn: "4", html: odd }]);
  // "Some Future Pane:" is Noun-shaped, so the grammar classifies it `info`
  // rather than rejecting it — which is the point: it is captured, not lost.
  assert.ok(a.kinds.has("Some Future Pane|info"), "a new pane must show up as a kind");
});

// ── Sampler ─────────────────────────────────────────────────────────

test("chooseCrns takes one section per course, within budget", () => {
  // Uniform on purpose. An earlier version over-sampled multi-section courses
  // to measure within-course agreement; that analysis is gone, and for the
  // prevalence figures this file reports, the bias was a defect.
  const byCourse = new Map();
  for (let i = 0; i < 300; i++) byCourse.set(`S${1000 + i}`, [`a${i}`, `b${i}`, `c${i}`]);
  const { picked, used } = chooseCrns(byCourse, 50);
  assert.ok(used <= 50, `budget exceeded: ${used}`);
  assert.ok(used >= 40, `budget badly under-filled: ${used}`);
  for (const crns of picked.values()) {
    assert.equal(crns.length, 1, "more than one section of a course was sampled");
  }
});

test("chooseCrns spreads across the alphabet rather than taking a prefix", () => {
  // Taking the first N would make every histogram a report on ARCH and ARTG.
  const byCourse = new Map();
  for (const s of ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"]) {
    for (let i = 0; i < 10; i++) byCourse.set(`${s}${1000 + i}`, [`${s}${i}`]);
  }
  const subjects = new Set([...chooseCrns(byCourse, 8).picked.keys()].map(k => k.slice(0, 3)));
  assert.ok(subjects.size >= 4, `sample covered only ${subjects.size} subjects: ${[...subjects]}`);
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

test("chooseCrns survives degenerate inputs", () => {
  assert.doesNotThrow(() => chooseCrns(new Map(), 100));
  assert.equal(chooseCrns(new Map(), 100).used, 0);
  const one = new Map([["A1000", ["c1"]]]);
  assert.equal(chooseCrns(one, 100).used, 1);
  assert.equal(chooseCrns(one, 0).used, 0, "a zero budget must fetch nothing");
  // A course present in the inventory with no CRNs must not become a null entry.
  assert.equal(chooseCrns(new Map([["A", []], ["B", ["b1"]]]), 5).used, 1);
});

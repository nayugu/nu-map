// CONTRACT · "Complete 36 semester hours in the major" as a FLOOR, never a sum.
//
// The sentence is a SUBTOTAL. Normally it restates requirements already parsed,
// so adding it demands the major twice — up to 60 SH of phantom credit on one
// page, and over-demanding refuses valid plans. But where the parse is thin it
// is the only statement of the major's size, and the shortfall goes straight
// into free electives: Philosophy BA parses 16 SH of demand against a stated 36
// and told the student 112 of its 128 credits were free.
//
// These tests are hostile to the FIX, because the two ways to get this wrong are
// opposite and both are easy:
//
//   ADD it            -> the major is demanded twice. Asserted against below on
//                        the 18-of-21 shape where the parse already meets the
//                        subtotal.
//   ATTRIBUTE it      -> "which sections are in the major?" is a classifier, and
//                        the only available one (the title) misfiles the cases
//                        that matter. Spanish BA's language section IS its
//                        major; Philosophy BA's is not. The floor is taken
//                        against TOTAL demand precisely so nothing has to
//                        decide, and the Spanish shape is asserted below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseHTML } from 'node-html-parser';
import { parseMajorCreditSubtotal } from '../../scripts/lib/catalog-program-parser.js';
import { applyMajorCreditFloor } from '../../scripts/lib/program-record.js';

const pane = (inner) => parseHTML(`<div id="programrequirementstextcontainer">
  ${inner}<table class="sc_courselist"><tr class="odd"><td class="codecol"><a>PHIL 1101</a></td>
  <td>X</td><td class="hourscol">4</td></tr></table></div>`);

const CM = Object.fromEntries(["PHIL1101", "PHIL2200", "SPNS1101", "SPNS2101"]
  .map(id => [id, { id, subject: id.replace(/\d.*/, ""), number: id.replace(/^\D+/, ""), sh: 4 }]));

const COURSE = (subject, classId) => ({ type: "COURSE", subject, classId });
const SECTION = (title, ...requirements) =>
  ({ type: "SECTION", title, minRequirementCount: requirements.length, requirements });

const prog = (subtotal, sections, extra = {}) => ({
  totalCreditsRequired: 128, majorCreditSubtotal: subtotal,
  requirementSections: sections, ...extra,
});

// ── Reading the sentence ───────────────────────────────────────────

test('subtotal › every phrasing the corpus uses is read', () => {
  for (const [text, want] of [
    ['Complete 36 semester hours in the major.', 36],
    ['Complete 46 semester hours for the major.', 46],
    ['56 semester hours required in the major', 56],
    ['Complete a minimum of 52 semester hours in the major.', 52],
    ['60 semester hours in the major', 60],
  ]) {
    assert.equal(parseMajorCreditSubtotal(pane(`<h2>Major Credit Requirement</h2><p>${text}</p>`)),
      want, text);
  }
});

test('subtotal › an implausible figure is refused, not trusted', () => {
  // It is about to raise a demand floor, and over-demanding refuses valid plans,
  // so it is bounded rather than believed. A degree total that happened to be
  // phrased with "in the major" must not become a 200 SH major.
  for (const text of ['Complete 200 semester hours in the major.',
                      'Complete 4 semester hours in the major.']) {
    assert.equal(parseMajorCreditSubtotal(pane(`<h2>X</h2><p>${text}</p>`)), null, text);
  }
});

test('subtotal › a sentence that is not about the major is not read', () => {
  assert.equal(parseMajorCreditSubtotal(pane('<h2>X</h2><p>128 total semester hours required</p>')), null);
  assert.equal(parseMajorCreditSubtotal(pane('<h2>X</h2><p>Complete 12 semester hours of language study.</p>')), null);
});

// ── The floor ──────────────────────────────────────────────────────

test('floor › fires only on the shortfall, and says so', () => {
  // 8 SH parsed against a stated 36 -> a 28 SH section, not a 36 SH one.
  const d = prog(36, [SECTION("Core", COURSE("PHIL", "1101"), COURSE("PHIL", "2200"))]);
  const s = applyMajorCreditFloor(d, CM);
  assert.ok(s, 'the shortfall was dropped');
  assert.equal(s.creditsRequired, 28, 'the GAP, not the whole subtotal — that would double-count');
  assert.deepEqual(s.requirements, [], 'nothing is enumerated, because nothing is named');
  assert.equal(s.minRequirementCount, 1, 'so no checked box can be drawn');
  assert.ok(s.notes[0].includes('36'), 'the arithmetic is stated for the reader');
});

test('floor › does NOT fire when the parse already meets the subtotal', () => {
  // 18 of the 21 pages that state a subtotal are this shape. Adding here is the
  // expensive failure: the major demanded twice.
  const d = prog(8, [SECTION("Core", COURSE("PHIL", "1101"), COURSE("PHIL", "2200"))]);
  assert.equal(applyMajorCreditFloor(d, CM), null);
  assert.equal(d.requirementSections.length, 1, 'nothing appended');
});

test('floor › does NOT fire when the parse EXCEEDS the subtotal', () => {
  // 10 of 21, by up to 10 SH. A floor may never lower demand, and may never
  // notice that it could.
  const d = prog(4, [SECTION("Core", COURSE("PHIL", "1101"), COURSE("PHIL", "2200"))]);
  assert.equal(applyMajorCreditFloor(d, CM), null);
});

test('floor › needs no view of WHICH sections are the major', () => {
  // The Spanish BA shape, which is why the floor is taken against TOTAL demand.
  // Its "Spanish Language Requirements" is 16 SH and IS the major; a classifier
  // keyed on the title would have excluded it, found a 16 SH shortfall and
  // demanded 16 SH that the student does not owe.
  const d = prog(16, [
    SECTION("Spanish Language Requirements", COURSE("SPNS", "1101"), COURSE("SPNS", "2101")),
    SECTION("Core", COURSE("PHIL", "1101"), COURSE("PHIL", "2200")),
  ]);
  assert.equal(applyMajorCreditFloor(d, CM), null,
    '16 SH of language + 8 of core already exceeds a 16 SH major');
});

// ── Refusing to guess ──────────────────────────────────────────────

test('floor › declines when there is no catalog to size against', () => {
  // Without real credits every course falls back to the modal unit, so the
  // demand this compares against is the superseded estimate — and the floor
  // would fire on programs that do not need it. Silence beats a wrong number.
  const d = prog(36, [SECTION("Core", COURSE("PHIL", "1101"))]);
  assert.equal(applyMajorCreditFloor(d, {}), null);
  assert.equal(applyMajorCreditFloor(d, null), null);
  assert.equal(d.requirementSections.length, 1);
});

test('floor › a program stating no subtotal is untouched', () => {
  const d = { totalCreditsRequired: 128, requirementSections: [SECTION("Core", COURSE("PHIL", "1101"))] };
  assert.equal(applyMajorCreditFloor(d, CM), null);
  assert.equal(d.requirementSections.length, 1);
});

test('floor › is idempotent — running twice does not stack', () => {
  // It runs once per scrape today, but a record round-tripping through a
  // re-parse must not accumulate a second phantom section.
  const d = prog(36, [SECTION("Core", COURSE("PHIL", "1101"))]);
  const first = applyMajorCreditFloor(d, CM);
  assert.ok(first);
  assert.equal(applyMajorCreditFloor(d, CM), null,
    'the section it added is itself demand, so the gap is now closed');
  assert.equal(d.requirementSections.filter(s => s.title === 'Major Credit Requirement').length, 1);
});

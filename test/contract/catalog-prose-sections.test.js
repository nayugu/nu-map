// CONTRACT · a requirement stated in PROSE, with no course list under it.
//
// A requirements pane is <h2> + body pairs, and only the pairs whose body was a
// TABLE were ever read. So "BA Language Requirements — All BA students are
// required to complete the BA degree language requirements, for a total of 12
// semester hours of language study" was invisible, on every one of the 105 BA
// programs in the catalog. Measured over the 24 undergraduate degrees with the
// largest free-elective residual, 23 state credit in prose that the parser could
// not see, 1,177 SH in total.
//
// These tests are hostile to the FIX. Emitting a section for every prose heading
// is easy and catastrophic, because the same pane states credit in prose that is
// a RESTATEMENT of credit already counted:
//
//   ADDITIVE    "for a total of 12 semester hours of language study"
//   A SUBTOTAL  "Complete 36 semester hours in the major"      <- must not count
//   THE TOTAL   "130 total semester hours required"            <- must not count
//   A GPA RULE  "A major GPA of 2.500 is required."            <- must not count
//
// Summing the subtotal would demand the major twice — up to 60 SH of phantom
// credit on one page — which refuses plans that are actually valid. That is the
// expensive direction, so every one of those cases is asserted below, along with
// the ordering property that made this a restructure rather than an append.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseHTML } from 'node-html-parser';
import { parseRequirements, UNDERGRAD_PROFILE } from '../../scripts/lib/catalog-program-parser.js';

/** A requirements pane built from raw block HTML. */
const pane = (inner) => parseHTML(`
  <div id="programrequirementstextcontainer">${inner}</div>`);

const h2 = (t) => `<h2>${t}</h2>`;
const p = (t) => `<p>${t}</p>`;
const table = (title, code = 'PHIL 1101') => `
  <table class="sc_courselist">
    <tr class="hidden noscript"><td>Code</td><td>Title</td><td>Hours</td></tr>
    <tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">${title}</span></td><td class="hourscol"></td></tr>
    <tr class="odd"><td class="codecol"><a>${code}</a></td><td>A Course</td><td class="hourscol">4</td></tr>
  </table>`;

const sectionsOf = (root) => parseRequirements(root, UNDERGRAD_PROFILE, {}).requirementSections;
const titles = (root) => sectionsOf(root).map(s => s.title);
const find = (root, t) => sectionsOf(root).find(s => s.title === t);

const LANGUAGE = 'All BA students are required to complete the BA degree language '
  + 'requirements, for a total of 12 semester hours of language study or demonstrated '
  + 'equivalent proficiency, as described in Additional Requirements for BA students.';

// ── The requirement that was invisible ─────────────────────────────

test('prose sections › a prose heading stating credit becomes a codeless section', () => {
  const root = pane(h2('BA Language Requirements') + p(LANGUAGE) + h2('Core') + table('Core'));
  const s = find(root, 'BA Language Requirements');
  assert.ok(s, 'the 12 SH every BA owes was dropped entirely');
  assert.equal(s.creditsRequired, 12);
});

test('prose sections › it enumerates nothing and ticks nothing', () => {
  // The same contract the in-table codeless sections carry: no course may be
  // invented, and no box may appear already checked.
  const root = pane(h2('BA Language Requirements') + p(LANGUAGE));
  const s = find(root, 'BA Language Requirements');
  assert.deepEqual(s.requirements, [], 'nothing is enumerated, because nothing is named');
  assert.equal(s.minRequirementCount, 1, 'so no checked box can be drawn');
  assert.ok(s.notes.some(n => n.includes('language study')),
    "the registrar's own sentence survives verbatim");
});

test('prose sections › the sentence reaches the reader even when the credit does not', () => {
  const root = pane(h2('Universitywide Requirements')
    + p('All undergraduate students are required to complete the Universitywide Requirements.'));
  assert.deepEqual(titles(root), [],
    'quantified nowhere on the page, so a 0 SH section would claim a measurement we do not have');
});

// ── The restatements, each of which would double-count ─────────────

test('prose sections › a MAJOR SUBTOTAL is refused', () => {
  for (const text of [
    'Complete 36 semester hours in the major.',
    'Complete 46 semester hours for the major.',
    '56 semester hours required in the major',
    'Complete a minimum of 52 semester hours in the major.',
  ]) {
    const root = pane(h2('Philosophy Major Credit Requirement') + p(text) + h2('Core') + table('Core'));
    assert.equal(find(root, 'Philosophy Major Credit Requirement'), undefined,
      `"${text}" restates the sections already parsed; counting it demands the major twice`);
  }
});

test('prose sections › the DEGREE TOTAL is refused', () => {
  const root = pane(h2('Program Requirement') + p('130 total semester hours required'));
  assert.deepEqual(titles(root), [],
    'that is the number the free-elective residual is subtracted FROM');
});

test('prose sections › a GPA rule is refused', () => {
  const root = pane(h2('Major GPA Requirement') + p('A major GPA of 2.500 is required.'));
  assert.deepEqual(titles(root), [], 'parseGpaRule owns this sentence');
});

test('prose sections › an implausibly large figure is refused', () => {
  // A subtotal or total whose wording slipped past the tests above must still
  // not become a requirement. Over-demanding refuses real plans.
  const root = pane(h2('Something') + p('Complete 96 semester hours of coursework.'));
  assert.deepEqual(titles(root), []);
});

// ── Ordering, which is why this was a restructure ──────────────────

test('prose sections › a prose section keeps its place in the document', () => {
  // Collecting these in a second pass and appending them would put the language
  // requirement after the capstone, which is not where the page prints it.
  const root = pane(
    h2('Introduction') + table('Introduction', 'ARTF 1000')
    + h2('BA Language Requirements') + p(LANGUAGE)
    + h2('Capstone') + table('Capstone', 'ARTG 4000'));
  const ts = titles(root);
  assert.ok(ts.indexOf('BA Language Requirements') > ts.indexOf('Introduction'));
  assert.ok(ts.indexOf('BA Language Requirements') < ts.indexOf('Capstone'), ts.join(' | '));
});

test('prose sections › headings that own tables are untouched', () => {
  // The walk changed from "every heading with tables" to "every heading", so the
  // regression to fear is a table-owning heading taking the prose path. Measured
  // over 30 cached pages: 18 sections gained, 0 lost.
  const root = pane(h2('Core') + p('Complete 8 semester hours of the following.') + table('Core'));
  const s = find(root, 'Core');
  assert.ok(s, 'a heading with both prose and a table still parses its table');
  assert.ok((s.requirements ?? []).length > 0, 'and keeps its enumerated courses');
});

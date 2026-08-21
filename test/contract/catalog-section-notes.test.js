// CONTRACT · scripts/lib/catalog-program-parser.js — verbatim catalog notes.
//
// The catalog states real conditions in sentences with no course code in them.
// BioE's and Biochemistry's advanced electives exclude research courses in
// prose; ME BSME states its entire technical-elective requirement in two
// sentences; "A grade of C or higher is required in each course:" sits above a
// writing requirement. Every one of those was read by the parser, found
// unparseable, and dropped — so the requirement shipped WITHOUT the condition,
// which reads exactly like "there is no condition".
//
// The fallback is to print the sentence: no interpretation, no blocking. Which
// makes the whole design rest on one question — WHICH sentences are already
// said by the tree? Answering it by re-testing the instruction patterns from
// outside would drift the moment a grammar above changes, so consumption is
// marked at the point the output is PUSHED, inside parseRowGroup.
//
// These tests are hostile in the direction that costs a student something. A
// spurious note is clutter; a wrongly-consumed row makes a real requirement
// disappear in silence, and that is the failure this whole area exists to end.
// So every "no note" assertion below is paired with proof that the sentence's
// content survives somewhere else in the tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseHTML } from 'node-html-parser';

import { parseRequirements, UNDERGRAD_PROFILE, GRAD_PROFILE } from '../../scripts/lib/catalog-program-parser.js';
import { checkSection } from '../../src/core/gradRequirements.js';

const page = (rows, heading = 'Requirements') => parseHTML(`
  <div id="programrequirementstextcontainer">
    <h2>${heading}</h2>
    <table class="sc_courselist">
      <tr class="hidden noscript"><td>Code</td><td>Title</td><td>Hours</td></tr>
      ${rows}
    </table>
  </div>`);

const areaheader = (title, hours = '') =>
  `<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">${title}</span></td><td class="hourscol">${hours}</td></tr>`;
const comment = (text, hours = '') =>
  `<tr class="odd"><td colspan="2"><span class="courselistcomment">${text}</span></td><td class="hourscol">${hours}</td></tr>`;
const course = (code, title, hours = '4') =>
  `<tr class="even"><td class="codecol"><a>${code}</a></td><td>${title}</td><td class="hourscol">${hours}</td></tr>`;
const option = (code, title, hours = '4') =>
  `<tr class="even"><td class="codecol"><div class="blockindent"><a>${code}</a></div></td><td>${title}</td><td class="hourscol">${hours}</td></tr>`;
const range = (text) =>
  `<tr class="odd"><td colspan="2"><div class="blockindent"><span class="courselistcomment commentindent">${text}</span></div></td><td class="hourscol"></td></tr>`;

const sections = (root, profile = UNDERGRAD_PROFILE) =>
  parseRequirements(root, profile, {}).requirementSections;
const byTitle = (root, title, profile) => sections(root, profile).find(s => s.title === title);

// ── The real pages ──────────────────────────────────────────────────────────

test('the live ME BSME markup keeps both sentences, in document order', () => {
  // The section that names no course is where notes matter most: with an empty
  // requirements array the prose is the ONLY description of the requirement a
  // reader gets. Order is asserted because the two sentences only make sense
  // together — the subject list is the object of the instruction above it, and
  // a set would have been free to reverse them.
  const fixture = join(dirname(fileURLToPath(import.meta.url)),
                       '../fixtures/catalog/mechanical-engineering-bsme.html');
  const out = parseRequirements(parseHTML(readFileSync(fixture, 'utf8')),
                                UNDERGRAD_PROFILE, {});
  const s = out.requirementSections.find(
    x => x.title === 'Mechanical and Industrial Engineering Technical Elective');
  assert.ok(s);
  assert.deepEqual(s.notes, [
    'Complete one technical elective in one of the following subject areas:',
    'EMGT, ENGR, ENSY, IE, ME, or MEIE',
  ]);
  // The instruction row is the one carrying the 4 in its hourscol, so it IS
  // read — it even opens a choose block. It survives as a note only because
  // that block committed nothing. Marking consumption on READ rather than on
  // push would have swallowed the only statement of this requirement.
  assert.equal(s.creditsRequired, 4);
  assert.deepEqual(s.requirements, []);
});

test('the live ME BSME markup keeps a grade condition on a fully-parsed section', () => {
  // The other half of the problem: a section whose courses we read perfectly
  // and whose CONDITION we cannot. "A grade of C or higher is required in each
  // course" is not a GPA rule (it is per-course, not an average), so nothing
  // else in the pipeline carries it, and the panel used to show three tidy
  // checkboxes with no hint that a D fails the requirement.
  const fixture = join(dirname(fileURLToPath(import.meta.url)),
                       '../fixtures/catalog/mechanical-engineering-bsme.html');
  const out = parseRequirements(parseHTML(readFileSync(fixture, 'utf8')),
                                UNDERGRAD_PROFILE, {});
  const s = out.requirementSections.find(x => x.title === 'Writing Requirements');
  assert.ok(s);
  assert.ok(s.requirements.length > 0, 'this section is fully parsed');
  assert.deepEqual(s.notes, ['A grade of C or higher is required in each course:']);
});

// ── What must NOT become a note ──────────────────────────────────────────────

test('a choose instruction the tree expresses is not repeated as a note', () => {
  // The whole point of point-of-consumption marking. "Complete one of the
  // following:" over two indented options IS the OR node below it, so quoting
  // it back would be the parser talking to itself.
  const root = page([
    areaheader('Ethics Elective'),
    comment('Complete one of the following:'),
    option('PHIL 1145', 'Technology and Human Values'),
    option('PHIL 5555', 'Ethics'),
  ].join(''));
  const s = byTitle(root, 'Ethics Elective');
  assert.equal(s.notes, undefined, `unexpected notes: ${JSON.stringify(s.notes)}`);
  // Paired proof the sentence's content is actually in the tree.
  assert.equal(s.requirements[0].type, 'OR');
  assert.equal(s.requirements[0].courses.length, 2);
});

test('a credit-hours instruction the tree expresses is not repeated as a note', () => {
  const root = page([
    areaheader('Technical Electives'),
    comment('Select 8 credit hours from the following:'),
    option('EECE 2150', 'Circuits'),
    option('EECE 2160', 'Embedded Design'),
    option('EECE 2412', 'Fundamentals of Electronics'),
  ].join(''));
  const s = byTitle(root, 'Technical Electives');
  assert.equal(s.notes, undefined);
  assert.equal(s.requirements[0].numCreditsMin, 8);
});

test('a range sentence the tree expresses is not repeated as a note', () => {
  const root = page([
    areaheader('Biology Electives'),
    range('BIOL 3000 or higher'),
  ].join(''));
  const s = byTitle(root, 'Biology Electives');
  assert.equal(s.notes, undefined);
  assert.equal(s.requirements[0].type, 'RANGE');
});

test('a subject pool the tree expresses consumes BOTH of its rows', () => {
  // parseSubjectPool builds its XOM out of two rows. When it succeeds it says
  // everything both sentences said, so both are consumed; the moment it
  // refuses, both come back as notes (the ME test above).
  const root = page([
    areaheader('Nursing Electives'),
    comment('Complete 8 semester hours from the following subject areas:', '8'),
    comment('NRSG'),
  ].join(''));
  const s = byTitle(root, 'Nursing Electives');
  assert.equal(s.notes, undefined, `unexpected notes: ${JSON.stringify(s.notes)}`);
  assert.equal(s.requirements[0].type, 'XOM');
  assert.equal(s.requirements[0].courses[0].subject, 'NRSG');
  // …and the scratch field the pool used to report its rows never ships.
  assert.equal('rows' in s.requirements[0], false);
});

test('a subject pool that REFUSES returns both rows as notes', () => {
  // The same markup on a graduate page, where no level is stated and neither
  // available window is knowable. The pool refuses — and the sentence has to
  // reach the reader, because now nothing else describes the requirement.
  const root = page([
    areaheader('Electives'),
    comment('Complete 8 semester hours from the following subject areas:', '8'),
    comment('NRSG'),
  ].join(''));
  const s = byTitle(root, 'Electives', GRAD_PROFILE);
  assert.deepEqual(s.notes, [
    'Complete 8 semester hours from the following subject areas:',
    'NRSG',
  ]);
  assert.deepEqual(s.requirements, []);
});

test('GPA prose is not a note, because the constraint carries it verbatim', () => {
  // The one legitimate reason to suppress a sentence: it is already said
  // somewhere else, in full. parseRequirements turns this row into a
  // gpaConstraint whose `text` is the same string, so quoting it twice would
  // put the same rule in two places and invite them to disagree.
  const root = page([
    areaheader('Concentration Courses'),
    comment('These courses must average to a minimum of C (2.000):'),
    course('BIOL 3401', 'Cell Biology'),
    course('BIOL 3611', 'Genetics'),
  ].join(''));
  const out = parseRequirements(root, UNDERGRAD_PROFILE, {});
  // This wording makes the section BE the rule, so the section leaves
  // requirementSections entirely — an even stronger form of "said elsewhere".
  assert.equal(out.requirementSections.find(x => x.title === 'Concentration Courses'), undefined);
  assert.equal(out.gpaConstraints.length, 1);
  assert.match(out.gpaConstraints[0].text, /average to a minimum of C/);
  assert.deepEqual(out.gpaConstraints[0].courses.map(c => `${c.subject} ${c.classId}`),
    ['BIOL 3401', 'BIOL 3611']);

  // A GPA sentence riding along on an ordinary section is the other half: the
  // section survives, the rule is surfaced as a constraint, and the sentence
  // still must not be quoted twice.
  const riding = page([
    areaheader('Program Requirement'),
    comment('Minimum 3.000 GPA required.'),
    course('BIOL 3401', 'Cell Biology'),
  ].join(''));
  const out2 = parseRequirements(riding, UNDERGRAD_PROFILE, {});
  const s2 = out2.requirementSections.find(x => x.title === 'Program Requirement');
  assert.ok(s2);
  assert.equal(s2.notes, undefined);
  assert.equal(out2.gpaConstraints.length, 1);
});

test('an areaheader is never a note — it is the section title', () => {
  const root = page([
    areaheader('Required Courses'),
    course('ME 2350', 'Statics'),
  ].join(''));
  const s = byTitle(root, 'Required Courses');
  assert.equal(s.notes, undefined);
});

test('a split-credit annotation is consumed only when a course takes it up', () => {
  // "…count toward the mathematics requirement:" is expressed by the XOM the
  // NEXT course row becomes. With no course row after it, nothing expresses it
  // and it must print.
  const taken = page([
    areaheader('Integrative Requirement'),
    comment('3 semester hours from the following count toward the mathematics requirement:'),
    course('MATH 2331', 'Linear Algebra'),
  ].join(''));
  assert.equal(byTitle(taken, 'Integrative Requirement').notes, undefined);

  const orphaned = page([
    areaheader('Integrative Requirement', '3'),
    comment('3 semester hours from the following count toward the mathematics requirement:'),
  ].join(''));
  assert.deepEqual(byTitle(orphaned, 'Integrative Requirement').notes,
    ['3 semester hours from the following count toward the mathematics requirement:']);
});

// ── What must become a note ─────────────────────────────────────────────────

test('the research exclusion survives on a section whose courses all parsed', () => {
  // Problem 2 as the advisors reported it. Computing the excluded set was
  // considered and refused: the sentence names no course code, and the two
  // available proxies both misfire — title matching calls a "synthesis" course
  // research, and Banner's scheduleType files BIOL 4991 Research as a Lecture.
  // So the sentence prints and the courses stay exactly as parsed.
  const root = page([
    areaheader('Advanced Biology Electives', '8'),
    comment('Research courses may not be used to satisfy this requirement.'),
    option('BIOL 4701', 'Immunology'),
    option('BIOL 4723', 'Virology'),
  ].join(''));
  const s = byTitle(root, 'Advanced Biology Electives');
  assert.deepEqual(s.notes, ['Research courses may not be used to satisfy this requirement.']);
  assert.equal(s.requirements[0].numCreditsMin, 8);
  // A note states a condition this layer cannot check, so it must never be
  // able to REFUSE anything: allocation is byte-identical with and without it.
  const bare = { ...s };
  delete bare.notes;
  const withNote = checkSection(s, new Set(['BIOL 4701', 'BIOL 4723']), {});
  const without  = checkSection(bare, new Set(['BIOL 4701', 'BIOL 4723']), {});
  assert.equal(withNote.sat, without.sat);
  assert.equal(withNote.satCount, without.satCount);
});

test('a range sentence the grammar cannot read prints instead of vanishing', () => {
  // parseRangeText refuses this wording. Before, the row was simply gone and
  // the section rendered empty; now the reader gets the registrar's sentence.
  const root = page([
    areaheader('Humanities Elective', '4'),
    range('Any course in the College of Social Sciences and Humanities'),
  ].join(''));
  const s = byTitle(root, 'Humanities Elective');
  assert.deepEqual(s.notes, ['Any course in the College of Social Sciences and Humanities']);
});

test('an instruction whose block commits nothing prints', () => {
  const root = page([
    areaheader('Minor Requirement', '16'),
    comment('Complete one of the following minors outside of the chosen focus area above.'),
    comment('Behavioral Neuroscience'),
    comment('Biology'),
  ].join(''));
  const s = byTitle(root, 'Minor Requirement');
  // Including the bare labels. They look like noise until you notice that on
  // Interdisciplinary Studies BS (Oakland) — 16 SH, zero parsed requirements —
  // the labels ARE the requirement: fifteen eligible minors, and a short-line
  // filter would have deleted precisely the best case in the corpus.
  assert.deepEqual(s.notes, [
    'Complete one of the following minors outside of the chosen focus area above.',
    'Behavioral Neuroscience',
    'Biology',
  ]);
  assert.equal(s.creditsRequired, 16);
});

test('identical sentences are printed once', () => {
  const root = page([
    areaheader('Electives', '8'),
    comment('Must be taken at the Boston campus.'),
    comment('Must be taken at the Boston campus.'),
  ].join(''));
  assert.deepEqual(byTitle(root, 'Electives').notes, ['Must be taken at the Boston campus.']);
});

test('a non-breaking space in the catalog does not become a distinct sentence', () => {
  const root = page([
    areaheader('Electives', '8'),
    comment('Must be taken&nbsp;at the Boston campus.'),
    comment('Must be taken at the Boston  campus.'),
  ].join(''));
  assert.deepEqual(byTitle(root, 'Electives').notes, ['Must be taken at the Boston campus.']);
});

test('no residue means no field at all', () => {
  // An empty array on 5,708 of 7,644 sections would be 5,708 lines of noise in
  // the committed JSON and a diff on every re-scrape.
  const root = page([areaheader('Required Courses'), course('ME 2350', 'Statics')].join(''));
  const s = byTitle(root, 'Required Courses');
  assert.equal('notes' in s, false);
});

// ── Downstream ──────────────────────────────────────────────────────────────

test('notes reach the allocation result, so the panel and MCP can print them', () => {
  // Hexagonal: the parser writes the field, core carries it, and everything
  // that renders a section reads it from there. checkSection normalises the
  // absent case to [] so no consumer needs a guard.
  const root = page([
    areaheader('Advanced Chemistry Electives', '8'),
    comment('Research courses may not be used to satisfy this requirement.'),
    option('CHEM 4601', 'Physical Chemistry'),
    option('CHEM 4602', 'Physical Chemistry 2'),
  ].join(''));
  const s = byTitle(root, 'Advanced Chemistry Electives');
  const res = checkSection(s, new Set(), {});
  assert.deepEqual(res.notes, ['Research courses may not be used to satisfy this requirement.']);

  const plain = checkSection(
    byTitle(page([areaheader('Required Courses'), course('ME 2350', 'Statics')].join(''),
                 'Requirements'), 'Required Courses'),
    new Set(), {});
  assert.deepEqual(plain.notes, []);
});

test('a concentration keeps the notes of the sections it flattens', () => {
  // A concentration discards its sections' wrappers and keeps only their
  // requirement lists, so a note attached to a wrapper would be lost with it.
  const root = parseHTML(`
    <div id="programrequirementstextcontainer">
      <h2>Concentrations</h2>
      <p>Complete one concentration.</p>
      <ul><li><a href="#biologyconcentration">Biology Concentration</a></li></ul>
      <h3 id="biologyconcentration">Biology Concentration</h3>
      <table class="sc_courselist">
        <tr class="hidden noscript"><td>Code</td><td>Title</td><td>Hours</td></tr>
        ${comment('Research courses may not be used to satisfy this requirement.')}
        ${course('BIOL 3401', 'Cell Biology')}
      </table>
    </div>`);
  const out = parseRequirements(root, UNDERGRAD_PROFILE, {});
  const conc = out.concentrations?.concentrationOptions?.[0];
  assert.ok(conc, 'the concentration was not found');
  assert.deepEqual(conc.notes, ['Research courses may not be used to satisfy this requirement.']);
});

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
import { parseRequirements, UNDERGRAD_PROFILE, GRAD_PROFILE } from '../../scripts/lib/catalog-program-parser.js';

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

// Each of these must be rejected by ITS OWN guard, so every figure below sits
// under the plausibility ceiling. The first version of these tests used 36 and
// 130 — both above the ceiling then in force — so they passed no matter what
// the semantic guards did, and mutation testing duly found that deleting the
// subtotal and total guards broke nothing. A test that asserts the right
// outcome for the wrong reason is worse than no test: it reports coverage it
// does not have.

test('prose sections › a MAJOR SUBTOTAL is refused, by the subtotal guard alone', () => {
  for (const text of [
    'Complete 16 semester hours in the major.',
    'Complete 12 semester hours for the major.',
    '20 semester hours required in the major',
    'Complete a minimum of 18 semester hours in the major.',
  ]) {
    const root = pane(h2('Philosophy Major Credit Requirement') + p(text) + h2('Core') + table('Core'));
    assert.equal(find(root, 'Philosophy Major Credit Requirement'), undefined,
      `"${text}" restates the sections already parsed; counting it demands the major twice`);
  }
});

test('prose sections › the DEGREE TOTAL is refused even when it is small', () => {
  // The case that proves size cannot do this job. A graduate certificate really
  // is 12 semester hours, so its total is indistinguishable BY SIZE from a real
  // 12 SH requirement — only the phrasing separates them. Without this guard
  // every certificate in the catalog grows a phantom 12 SH section.
  //
  // The heading must NOT mention GPA and the figure must sit under the ceiling,
  // or one of the other two guards rejects this and the test proves nothing
  // about the total guard. The first attempt used CourseLeaf's combined
  // "Program Credit/GPA Requirements" heading and was masked by the GPA guard —
  // mutation testing caught it surviving.
  const cert = pane(h2('Program Requirement') + p('12 total semester hours required'));
  assert.deepEqual(titles(cert), [],
    'that is the number the free-elective residual is subtracted FROM');

  const undergrad = pane(h2('Program Requirement') + p('130 total semester hours required'));
  assert.deepEqual(titles(undergrad), []);
});

test('prose sections › on a GRADUATE page the total guard is the ONLY thing standing', () => {
  // Where the guard actually earns its place, and it took two rounds of mutation
  // testing to find out. On an UNDERGRADUATE page it is structurally redundant:
  // `statedTotalIn` only matches inside the credit window, whose floor is 60,
  // and the plausibility ceiling is also 60 — so any total big enough to be
  // recognised is already too big to be emitted, and no undergraduate test can
  // ever isolate the guard.
  //
  // The graduate window floor is 4. A certificate's "12 total semester hours
  // required" is recognised as a total AND sits under the ceiling, so the guard
  // is the only thing between it and a phantom 12 SH requirement — on all 88
  // CPS graduate programs and every certificate in the catalog.
  for (const text of [
    '12 total semester hours required',
    'A total of 34 semester hours are required.',
    '34 minimum semester hours required',
    'A minimum of 28 semester hours beyond the graduate degree is required',
  ]) {
    const root = pane(h2('Program Requirement') + p(text));
    const got = parseRequirements(root, GRAD_PROFILE, {}).requirementSections.map(s => s.title);
    assert.deepEqual(got, [], `"${text}" is a graduate degree total, not a requirement`);
  }
});

test('prose sections › EVERY phrasing of a degree total is refused', () => {
  // The hole a surviving mutant exposed. The guard used to carry its own
  // pattern — "total <unit> required" — and the catalog states a total seven
  // ways. Two of them leaked and became phantom sections of 42 and 28 SH:
  //
  //   "A total of 42 semester hours are required."            -> 42 SH section
  //   "A minimum of 28 semester hours … beyond the graduate
  //    degree is required"                                    -> 28 SH section
  //
  // The second is the doctoral/advanced-entry form, so the programs that would
  // have grown a phantom requirement are precisely the smallest degrees in the
  // catalog. It now asks `statedTotalIn`, the same reader `parseTotalCredits`
  // uses, so the two lists cannot drift.
  for (const text of [
    '96 total semester hours required',
    'A total of 96 semester hours are required.',
    '96 overall semester hours required',
    '96 total semester hours',
    '96 minimum semester hours required',
    'A minimum of 96 semester hours beyond the undergraduate degree is required',
    '96 semester hours required',
    '96 total credits required',
  ]) {
    const root = pane(h2('Program Requirement') + p(text));
    assert.deepEqual(titles(root), [], `"${text}" is a degree total, not a requirement`);
  }
});

test('prose sections › the language sentence is NOT read as a total', () => {
  // It contains "a total of 12 semester hours", which is one of the total
  // phrasings — so the refusal above has to stop short of it. What separates
  // them on an undergraduate page is the credit window: 12 is below the 60 SH
  // floor of a bachelor's degree, so it cannot be one.
  const root = pane(h2('BA Language Requirements') + p(LANGUAGE));
  assert.equal(find(root, 'BA Language Requirements')?.creditsRequired, 12);
});

test('prose sections › a GPA rule is refused, by the GPA guard alone', () => {
  // Also isolated: a figure present, under the ceiling, no "total … required",
  // no "in the major". This is the only shape in which the GPA guard is
  // load-bearing, and it was measured to occur on 0 of 30 sampled pages — so
  // the guard is insurance, and this test is what stops insurance from rotting
  // into a comment that describes a check nothing performs.
  const root = pane(h2('Major GPA Requirement')
    + p('A major GPA of 2.500 is required across 16 semester hours of upper-division coursework.'));
  assert.deepEqual(titles(root), [], 'parseGpaRule owns this sentence');

  // The plain form, which no guard but "there is no figure" needs to reject.
  assert.deepEqual(titles(pane(h2('Major GPA Requirement') + p('A major GPA of 2.500 is required.'))), []);
});

test('prose sections › the ceiling is a backstop, not the mechanism', () => {
  // It must still reject nonsense…
  assert.deepEqual(titles(pane(h2('Something') + p('Complete 300 semester hours of coursework.'))), []);
  // …but it must NOT be what rejects a real requirement. 32 SH focus areas and
  // 16 SH minor requirements exist in the codeless-section corpus, so a ceiling
  // tight enough to catch a degree total would silently delete them.
  const focus = pane(h2('Focus Area') + p('Complete 32 semester hours of focus area coursework.'));
  assert.equal(find(focus, 'Focus Area')?.creditsRequired, 32,
    'a large but real prose requirement survives');
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

// ── "not required" can still mean "pick one" ───────────────────────
//
// Untested until mutation testing showed that deleting the correction outright
// broke nothing. The rule decides real credit — 19 programs, up to 24 SH each —
// so both directions need pinning, not just the one that changed.

const gateway = (heading, prose, options) => pane(
  h2(heading) + p(prose)
  + `<ul>${options.map(o => `<li><a href="#${o.replace(/\W/g, '')}">${o}</a></li>`).join('')}</ul>`
  + options.map(o => `<h2><a name="${o.replace(/\W/g, '')}"></a>${o}</h2>` + table(o)).join(''));

const minOptionsOf = (root) =>
  parseRequirements(root, UNDERGRAD_PROFILE, {}).concentrations?.minOptions;

test('minOptions › an "Electives Option" beside the concentrations makes the choice mandatory', () => {
  // Art BA: "A concentration is not required. Students may complete the
  // electives option IN LIEU OF a concentration." Read as 0, its 20 SH choice
  // demanded nothing and became free electives.
  const root = gateway('Concentration or Electives Option',
    'A concentration is not required. Students may complete the electives option '
    + 'in lieu of a concentration.',
    ['Concentration in Art History and Visual Studies', 'Electives Option']);
  assert.equal(minOptionsOf(root), 1,
    'one of the listed options must be done, even though no CONCENTRATION is required');
});

test('minOptions › a genuinely optional concentration keeps its 0', () => {
  // The 39 programs that score 0 and have no opt-out option in the list. Forcing
  // these to 1 would demand a concentration nobody has to do.
  const root = gateway('Concentration',
    'A concentration is not required.',
    ['Concentration in Applied AI']);
  assert.equal(minOptionsOf(root), 0,
    'no "Electives Option" in the list, so the opt-out is to do none of them');
});

test('minOptions › a required choice is not weakened by the correction', () => {
  const root = gateway('Concentrations',
    'One concentration is required.',
    ['Concentration in Ethics', 'Electives Option']);
  assert.equal(minOptionsOf(root), 1, 'already 1; the correction must not touch it');
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

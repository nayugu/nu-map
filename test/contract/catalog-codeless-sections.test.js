// CONTRACT · scripts/lib/catalog-program-parser.js — a requirement that names no course.
//
// The catalog can state a credit demand and never name a course to satisfy it.
// ME's "Mechanical and Industrial Engineering Technical Elective" is two
// comment rows ("Complete one technical elective in one of the following
// subject areas:" / "EMGT, ENGR, ENSY, IE, ME, or MEIE") and 4 SH. parseTable
// dropped any group it could not build a requirement node from, so the section
// vanished: 4 SH missing from a 140 SH degree, and no sign on the page that a
// technical elective was required at all. 360 groups on 187 program pages.
//
// These tests are hostile to the FIX, not to the old bug. Emitting a section is
// easy; emitting one that cannot lie is the requirement. The two lies available
// are (a) reporting the section satisfied when nobody has done it, and (b)
// inventing a course pool. Both are asserted against below, along with the
// cases where the section must still NOT appear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseHTML } from 'node-html-parser';

import { parseRequirements, UNDERGRAD_PROFILE } from '../../scripts/lib/catalog-program-parser.js';
import { checkSection, allocateMajorWithElectives } from '../../src/core/gradRequirements.js';

/** Wrap course-list rows in the pane shape parseRequirements expects. */
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

const sections = root => parseRequirements(root, UNDERGRAD_PROFILE, {}).requirementSections;
const byTitle = (root, title) => sections(root).find(s => s.title === title);

// ── Against the real page ───────────────────────────────────────────────────

test('the live ME BSME markup yields the technical elective, in page order', () => {
  // Synthetic rows prove the branch fires; only the captured page proves it
  // fires on what NEU actually publishes. Position matters as much as presence:
  // the section is read from the same table as the capstone above it and the
  // supplemental credit below it, so a section appearing at the END would mean
  // the group boundaries were misread even though the count looked right.
  const fixture = join(dirname(fileURLToPath(import.meta.url)),
                       '../fixtures/catalog/mechanical-engineering-bsme.html');
  const out = parseRequirements(parseHTML(readFileSync(fixture, 'utf8')),
                                UNDERGRAD_PROFILE, {});
  const names = out.requirementSections.map(s => s.title);
  const TITLE = 'Mechanical and Industrial Engineering Technical Elective';

  const s = out.requirementSections.find(x => x.title === TITLE);
  assert.ok(s, `${TITLE} is missing; sections were: ${names.join(' | ')}`);
  assert.equal(s.creditsRequired, 4);
  assert.equal(names.indexOf(TITLE), names.indexOf('Mechanical Engineering Capstone') + 1,
    'the section must sit directly after the capstone, as it does on the page');
  assert.equal(out.totalCredits?.value ?? 140, 140, 'the degree total is unchanged');

  // And it must NOT be over-read. The page says "one technical elective in one
  // of the following subject areas", which names the subjects but not which of
  // their courses qualify — so the section carries its 4 SH and no pool. An
  // earlier version of this change emitted RANGE ME 1000–9999 here, which
  // would have counted ME 2350 Statics (required 40 lines above on the same
  // page) toward the technical elective.
  assert.deepEqual(s.requirements, [],
    'the subjects are named, but "technical elective" is not a set we can enumerate');
});

// ── The ME case: the section must exist, with its credit ─────────────────────

test('a credit-bearing group naming no course still yields a section', () => {
  const s = byTitle(page(
    areaheader('Mechanical and Industrial Engineering Technical Elective') +
    comment('Complete one technical elective in one of the following subject areas:', '4') +
    comment('EMGT, ENGR, ENSY, IE, ME, or MEIE')
  ), 'Mechanical and Industrial Engineering Technical Elective');

  assert.ok(s, 'the section was dropped — this is the ME bug');
  assert.equal(s.creditsRequired, 4, 'the registrar’s own hours must survive');
});

test('the credit comes from the areaheader when it carries the hours itself', () => {
  const s = byTitle(page(
    areaheader('Technical Elective', '12') +
    comment('Complete 12 semester hours from the following subject areas:') +
    comment('EMGT, ENGR')
  ), 'Technical Elective');
  assert.equal(s.creditsRequired, 12);
});

// ── It must not claim to be satisfied ────────────────────────────────────────

// A pool the catalog defers to another table ("the depth course list below")
// names no subjects, so it is the shape that legitimately stays unenumerated.
const DEFERRED =
  areaheader('Depth Courses') +
  comment('Complete 20 semester hours from the depth course list below.', '20');

test('an unenumerated section is NOT reported satisfied by an empty plan', () => {
  // minRequirementCount: 0 would make checkSection return sat:true, and the
  // panel draws a CHECKED box off `sec.sat` — credit for work nobody has done.
  // That is a worse answer than the silence it replaces, so it is the single
  // most important property here.
  const s = byTitle(page(DEFERRED), 'Depth Courses');
  assert.equal(s.creditsRequired, 20);

  const result = checkSection(s, new Set(), {});
  assert.equal(result.sat, false, 'an unsatisfiable section must not report satisfied');
  assert.equal(result.total, 0, 'and it must not invent children to satisfy');
});

test('an unenumerated section stays unsatisfied whatever the student places', () => {
  // Nothing can satisfy it, because we do not know what would. It must not
  // flip to satisfied on an unrelated course.
  const s = byTitle(page(DEFERRED), 'Depth Courses');
  const placed = new Set(['ME4570', 'EMGT5220', 'ENGW1111']);
  const courseMap = {
    ME4570:   { subject: 'ME',   number: '4570', sh: 4 },
    EMGT5220: { subject: 'EMGT', number: '5220', sh: 4 },
    ENGW1111: { subject: 'ENGW', number: '1111', sh: 4 },
  };
  assert.equal(checkSection(s, placed, courseMap).sat, false);
});

test('a subject pool is satisfied only by enough credit from those subjects', () => {
  // The other half of the claim: having read a pool, it must evaluate like one
  // — an unrelated course cannot fill it, and one 4 SH course inside the named
  // subjects can.
  const s = byTitle(page(
    areaheader('Electives') +
    comment('Complete 4 semester hours from the following subject areas:', '4') +
    comment('ARCH, LARC')
  ), 'Electives');

  const courseMap = {
    ENGW1111: { subject: 'ENGW', number: '1111', sh: 4 },
    ARCH2310: { subject: 'ARCH', number: '2310', sh: 4 },
  };
  assert.equal(checkSection(s, new Set(['ENGW1111']), courseMap).sat, false,
    'a course outside every named subject must not satisfy it');
  assert.equal(checkSection(s, new Set(['ARCH2310']), courseMap).sat, true,
    'one 4 SH course inside the named subjects must');
});

// ── The pool it MAY read: subjects the registrar named ──────────────────────

const poolOf = s => s.requirements[0];
const rangesOf = s => poolOf(s).courses.map(c => `${c.subject} ${c.idRangeStart}-${c.idRangeEnd}`);

test('a named subject list becomes a credit pool over those subjects', () => {
  // The pure shape: hours + subjects, nothing else. Here the page really is
  // saying "any course in these subjects", so a pool says exactly what it says.
  const s = byTitle(page(
    areaheader('Electives') +
    comment('Complete 8 semester hours from the following subject areas:', '8') +
    comment('SUEN, ARCH, LARC, PPUA, LPSC, and SBSY')
  ), 'Electives');

  assert.equal(poolOf(s).type, 'XOM');
  assert.equal(poolOf(s).numCreditsMin, 8, 'the hourscol outranks the prose count');
  assert.deepEqual(rangesOf(s), [
    'SUEN 1000-9999', 'ARCH 1000-9999', 'LARC 1000-9999',
    'PPUA 1000-9999', 'LPSC 1000-9999', 'SBSY 1000-9999',
  ]);
});

test('a CATEGORY of course inside the named subjects is not enumerated', () => {
  // ME BSME. "one technical elective in one of the following subject areas"
  // names the subjects but not which of their courses is a technical elective.
  // RANGE ME 1000–9999 would admit ME 2350 Statics — required elsewhere on the
  // same page — and every 1000-level intro, which is membership the registrar
  // never granted. The subjects are certain; the pool is not.
  const s = byTitle(page(
    areaheader('Mechanical and Industrial Engineering Technical Elective') +
    comment('Complete one technical elective in one of the following subject areas:', '4') +
    comment('EMGT, ENGR, ENSY, IE, ME, or MEIE')
  ), 'Mechanical and Industrial Engineering Technical Elective');

  assert.ok(s, 'the section must still exist');
  assert.equal(s.creditsRequired, 4, 'with the credit the page states');
  assert.deepEqual(s.requirements, [], 'and no invented pool');
  assert.equal(JSON.stringify(s).includes('RANGE'), false);
});

test('any residual clause refuses the pool', () => {
  // Each of these names its subjects and then says something we do not model.
  // Enumerating would be wrong in a different direction each time: broader,
  // narrower, conditional on the student, or conditional on prerequisites.
  const residual = [
    'Complete 12–17 semester hours in the following subject areas to fulfill the minimum program hours (see faculty advisor for other acceptable elective courses):',
    'Complete 8 semester hours of courses at the 5000 level or above in the following subject area. See suggested elective course list.',
    'Complete any business class for which the pre-req is met in the following subject areas:',
    'Those who do not choose a concentration should take 27 additional semester hours in the following subject areas:',
    'Complete one business course from the following subject areas:',
  ];
  for (const text of residual) {
    const s = byTitle(page(areaheader('Elective') + comment(text, '8') + comment('FINA, MGMT')), 'Elective');
    assert.ok(s, `no section for: ${text}`);
    assert.deepEqual(s.requirements, [], `should not have enumerated: ${text}`);
  }
});

test('the trailing conjunction is not swallowed into a subject', () => {
  // Splitting on /,|\s+or\s+/ over "ME, or MEIE" yields the subject "or MEIE",
  // a RANGE that matches nothing while looking like a real requirement. It got
  // as far as parsed output once. Both conjunctions are checked because the
  // catalog uses both, and accepting only "or" dropped the "and" page entirely.
  for (const [row, want] of [
    ['EMGT, ENGR, ENSY, IE, ME, or MEIE',        ['EMGT', 'ENGR', 'ENSY', 'IE', 'ME', 'MEIE']],
    ['SUEN, ARCH, LARC, PPUA, LPSC, and SBSY',   ['SUEN', 'ARCH', 'LARC', 'PPUA', 'LPSC', 'SBSY']],
    ['ACCT, ENTR, FINA, MGMT',                   ['ACCT', 'ENTR', 'FINA', 'MGMT']],
    ['PSYC',                                     ['PSYC']],
  ]) {
    const s = byTitle(page(
      areaheader('Elective') +
      comment('Complete 8 semester hours from the following subject areas:', '8') +
      comment(row)
    ), 'Elective');
    assert.ok(s, `no section for "${row}"`);
    assert.deepEqual(poolOf(s).courses.map(c => c.subject), want, `from "${row}"`);
  }
});

test('a stated level window narrows the pool', () => {
  const cases = [
    ['Complete 4 semester hours of 5000- to 6000-level course work in the following subject area:', 5000, 6999],
    ['Complete 8 semester hours of courses at the 5000 level or above in the following subject area:', 5000, 9999],
    ['Complete 8 semester hours in the following subject areas:', 1000, 9999],
  ];
  for (const [text, start, end] of cases) {
    const s = byTitle(page(areaheader('Elective') + comment(text, '8') + comment('ARTG')), 'Elective');
    assert.ok(s, `no section for "${text}"`);
    assert.deepEqual(rangesOf(s), [`ARTG ${start}-${end}`], text);
  }
});

// ── The pools it must REFUSE to read ────────────────────────────────────────

test('a NEGATED subject list is never turned into a pool', () => {
  // "from outside the following subject area: ARCH" means every subject except
  // ARCH. Emitting RANGE ARCH would inverse the requirement — the single worst
  // outcome available here — and enumerating the complement over ~130 subjects
  // is not what the sentence says either. The section stays visible, unread.
  const s = byTitle(page(
    areaheader('Elective') +
    comment('Complete 8–16 semester hours (5000 level or above) from outside the following subject area:', '8') +
    comment('ARCH')
  ), 'Elective');

  assert.ok(s, 'the section must still be visible');
  assert.deepEqual(s.requirements, [], 'but it must name no courses');
  assert.equal(JSON.stringify(s).includes('ARCH'), false, 'ARCH must not appear as a requirement');
});

test('an exclusion list is never turned into a pool', () => {
  // MSECE: "Courses from the following subject areas may not count toward any
  // concentration". Reading this as a pool would REQUIRE what the page forbids.
  const out = sections(page(
    areaheader('Excluded Courses') +
    comment('Courses from the following subject areas may not count toward any concentration within the MSECE program:', '8') +
    comment('CSYE, ENSY, EMGT, INFO, SBSY, TELE')
  ));
  const s = out.find(x => x.title === 'Excluded Courses');
  assert.deepEqual(s?.requirements ?? [], []);
});

test('an unparseable level phrase refuses rather than guessing the window', () => {
  // "at the graduate level" — defaulting to 1000–9999 would admit 1000-level
  // undergraduate courses into a graduate requirement. Degrade to less
  // information, not to wrong information.
  const s = byTitle(page(
    areaheader('Elective') +
    comment('Complete 4 semester hours at the graduate level from the following subject area:', '4') +
    comment('NRSG')
  ), 'Elective');

  assert.ok(s, 'the section must still be visible with its credit');
  assert.equal(s.creditsRequired, 4);
  assert.deepEqual(s.requirements, [], 'no pool, because the level could not be read');
});

// ── Where it must still NOT appear ──────────────────────────────────────────

test('a group with no courses AND no credit is still dropped', () => {
  // Prose with no credit demand is not a requirement. Emitting it would put an
  // empty titled box in the panel for every advisory row in the catalog — and
  // the note itself is the other change, not this one.
  const out = sections(page(
    areaheader('Advising Note') +
    comment('Students should consult their faculty advisor before registering.')
  ));
  assert.equal(out.find(s => s.title === 'Advising Note'), undefined);
});

test('a group that DOES name courses is untouched by this change', () => {
  const s = byTitle(page(
    areaheader('Required Engineering') +
    course('ME 2350', 'Statics') +
    course('ME 3475', 'Fluid Mechanics')
  ), 'Required Engineering');

  assert.equal(s.requirements.length, 2);
  assert.equal(s.minRequirementCount, 2);
  assert.equal(s.creditsRequired, undefined, 'an enumerated section carries no phantom credit');
  assert.equal(checkSection(s, new Set(['ME2350', 'ME3475']),
    { ME2350: { subject: 'ME', number: '2350', sh: 4 },
      ME3475: { subject: 'ME', number: '3475', sh: 4 } }).sat, true);
});

test('a GPA-titled shell is still consumed as a constraint, not emitted', () => {
  // The pre-existing branch: a comment-only group stating a GPA rule leaves
  // requirementSections entirely. The new branch must not intercept it.
  const out = parseRequirements(page(
    areaheader('Major GPA Requirement') +
    comment('2.000 minimum GPA required in ME/MEIE coursework')
  ), UNDERGRAD_PROFILE, {});
  assert.equal(out.requirementSections.find(s => /GPA/i.test(s.title)), undefined);
  // parseRequirements emits `gpaConstraints`; program-record renames it to
  // `gpaRequirements` when it builds the stored record.
  assert.ok(out.gpaConstraints.length >= 1, 'the GPA rule must still be captured');
});

// ── Through the path the app actually uses ──────────────────────────────────

test('the allocator survives an empty section and does not starve its neighbours', () => {
  // checkSection is the narrow reader; the app reaches requirements through
  // allocateMajorWithElectives, which walks every section to divide placed
  // courses between them. A section with no requirements must be inert there:
  // it can claim nothing, so it must not consume a course another section
  // needs, and it must not push courses into General Electives either.
  const major = {
    requirementSections: [
      byTitle(page(DEFERRED), 'Depth Courses'),
      byTitle(page(
        areaheader('Required Engineering') + course('ME 2350', 'Statics')
      ), 'Required Engineering'),
    ],
    generalElectiveSH: 8,
  };
  const courseMap = {
    ME2350:   { subject: 'ME',   number: '2350', sh: 4 },
    EMGT5220: { subject: 'EMGT', number: '5220', sh: 4 },
  };
  const placed = new Set(['ME2350', 'EMGT5220']);

  const out = allocateMajorWithElectives(major, placed, courseMap);
  const [unenumerated, required] = out.sections;

  assert.equal(unenumerated.sat, false, 'the empty section must not report satisfied');
  assert.equal(required.sat, true, 'ME 2350 must still reach the section that requires it');
  // EMGT 5220 matches nothing, so it belongs to general electives — the empty
  // section must not have absorbed it on the strength of its subject appearing
  // in a comment row.
  assert.equal(out.generalElectives.satCount, 1);
});

test('scratch comment text never reaches the emitted section', () => {
  // _comments is transient by contract ("never let scratch text reach the
  // JSON"). The new branch passes it along, so this asserts the strip still
  // happens — a leak would ship parser internals to the browser.
  const s = byTitle(page(
    areaheader('Technical Elective') +
    comment('Complete one technical elective in one of the following subject areas:', '4') +
    comment('EMGT, ME')
  ), 'Technical Elective');
  assert.equal('_comments' in s, false);
});

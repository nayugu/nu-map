// CONTRACT · scripts/lib/catalog-program-parser.js — CourseLeaf's areasubheader.
//
// A group can hold several sub-runs, each introduced by
// `<span class="courselistcomment areasubheader">`. Neither of parseTable's
// boundary tests matches it — `areasubheader` is a distinct class token, and
// `"even areasubheader undefined subheader".includes("areaheader")` is false —
// so it arrived at parseRowGroup as an ordinary comment row and did nothing at
// all. 1,663 groups on 466 pages are shaped this way.
//
// The consequence was a choose block that ran straight through the boundary.
// Data Science BS offers a choice between a three-course CS pathway and a
// three-course DS pathway, and shipped as:
//
//   OR(AND(CS2500,CS2501), AND(CS2510,CS2511), AND(CS3500,CS3501),
//      AND(DS2000,DS2001), AND(DS2500,DS2501), DS3500)
//
// "pick one of six" — so a student who took CS 2500 and its lab had the whole
// 12 SH pathway marked satisfied and was two courses short at graduation. That
// is UNDER-requiring, the failure a student cannot recover from, and it predates
// every change in this area: the parser before it has no mention of
// `areasubheader` and produces exactly that tree.
//
// These tests pin what the markup BOUNDS and, just as importantly, what it does
// not. Where the extent of a run cannot be read off the page, the old
// over-requiring shape is kept on purpose — see the last section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseHTML } from 'node-html-parser';

import { parseRequirements, UNDERGRAD_PROFILE } from '../../scripts/lib/catalog-program-parser.js';
import { checkSection, allocateMajor } from '../../src/core/gradRequirements.js';

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
/** The real markup: class token `areasubheader`, on both tr and span. */
const subheader = (title) =>
  `<tr class="odd areasubheader undefined subheader"><td colspan="2"><span class="courselistcomment areasubheader undefined">${title}</span></td><td class="hourscol"></td></tr>`;
const comment = (text, hours = '') =>
  `<tr class="odd"><td colspan="2"><span class="courselistcomment">${text}</span></td><td class="hourscol">${hours}</td></tr>`;
const course = (code, title = code, hours = '4') =>
  `<tr class="even"><td class="codecol"><a>${code}</a></td><td>${title}</td><td class="hourscol">${hours}</td></tr>`;
const option = (code, title = code, hours = '4') =>
  `<tr class="even"><td class="codecol"><div class="blockindent"><a>${code}</a></div></td><td>${title}</td><td class="hourscol">${hours}</td></tr>`;

const sections = root => parseRequirements(root, UNDERGRAD_PROFILE, {}).requirementSections;
const byTitle = (root, title) => sections(root).find(s => s.title === title);
/** Compact tree shape, so an assertion reads like the requirement. */
const shape = (n) => n.type === 'COURSE'
  ? `${n.subject}${n.classId}`
  : n.type === 'RANGE'
    ? `${n.subject}${n.idRangeStart}-${n.idRangeEnd}`
    : `${n.type}(${(n.courses ?? []).map(shape).join(',')})`;

// ── The bounded case: indented runs ─────────────────────────────────────────

test('subheader › each subheadered run of indented options is ONE option', () => {
  const root = page([
    areaheader('Programming Sequence Pathways'),
    comment('Choose one of the two options.', '12'),
    subheader('Computer Science Option'),
    option('CS 2500'), option('CS 2510'), option('CS 3500'),
    subheader('Data Science Option'),
    option('DS 2000'), option('DS 2500'), option('DS 3500'),
  ].join(''));
  const s = byTitle(root, 'Programming Sequence Pathways');
  assert.equal(s.requirements.length, 1);
  assert.equal(shape(s.requirements[0]),
    'OR(AND(CS2500,CS2510,CS3500),AND(DS2000,DS2500,DS3500))',
    'one branch or the other, and a branch is all of its courses');
});

test('subheader › a run of ONE course stays a course, not a one-member AND', () => {
  const root = page([
    areaheader('Track'),
    comment('Complete one of the following:'),
    subheader('Track A'), option('CS 2500'),
    subheader('Track B'), option('DS 2000'),
  ].join(''));
  assert.equal(shape(byTitle(root, 'Track').requirements[0]), 'OR(CS2500,DS2000)');
});

test('subheader › runs of unequal length are read as they are written', () => {
  // No symmetry is assumed. A two-course branch beside a one-course branch is
  // exactly what the page says, and guessing a uniform option length was the
  // design this replaced.
  const root = page([
    areaheader('Track'),
    comment('Complete one of the following:'),
    subheader('Track A'), option('CS 2500'), option('CS 2510'),
    subheader('Track B'), option('DS 2000'),
  ].join(''));
  assert.equal(shape(byTitle(root, 'Track').requirements[0]),
    'OR(AND(CS2500,CS2510),DS2000)');
});

test('subheader › the first UNINDENTED row ends the block', () => {
  // The bound that makes this safe with nothing inferred: an unindented row was
  // never an option, so it is an obligation and the choice is over.
  const root = page([
    areaheader('Core'),
    comment('Complete one of the following:'),
    subheader('Track A'), option('CS 2500'), option('CS 2510'),
    subheader('Track B'), option('DS 2000'), option('DS 2500'),
    course('MATH 1341'), course('MATH 1342'),
  ].join(''));
  const s = byTitle(root, 'Core');
  assert.equal(shape(s.requirements[0]), 'OR(AND(CS2500,CS2510),AND(DS2000,DS2500))');
  assert.deepEqual(s.requirements.slice(1).map(shape), ['MATH1341', 'MATH1342'],
    'the courses after the choice are obligations, not more options');
});

test('subheader › an orclass alternative attaches inside its run', () => {
  const root = page([
    areaheader('Track'),
    comment('Complete one of the following:'),
    subheader('Track A'), option('CS 2500'),
    `<tr class="even orclass"><td class="codecol"><a>CS 2501</a></td><td>or</td><td class="hourscol"></td></tr>`,
    subheader('Track B'), option('DS 2000'),
  ].join(''));
  assert.equal(shape(byTitle(root, 'Track').requirements[0]),
    'OR(OR(CS2500,CS2501),DS2000)');
});

// ── The bounded case: flush options inside a run ────────────────────────────

test('subheader › an instruction INSIDE a run takes that run\'s flush courses', () => {
  // 511 groups on 184 pages. The instruction sits under a subheader, and
  // CourseLeaf stops indenting its options — so the first flush course used to
  // close a choose block holding nothing, discarding the instruction and
  // shipping every option as required.
  const root = page([
    areaheader('Licensure'),
    subheader('For students pursuing emergency licensure'),
    comment('Complete one of the following:'),
    course('EDU 6513'), course('EDU 6185'),
    subheader('For students not pursuing emergency licensure'),
    comment('Complete one of the following:'),
    course('EDU 6426'), course('EDU 6866'),
  ].join(''));
  const s = byTitle(root, 'Licensure');
  assert.deepEqual(s.requirements.map(shape),
    ['OR(EDU6513,EDU6185)', 'OR(EDU6426,EDU6866)'],
    'each run offers a choice; the runs themselves are not merged');
});

// ── What is deliberately NOT changed ───────────────────────────────────────

test('subheader › an unbounded flush choice keeps its over-requiring shape', () => {
  // Elementary Education MAT: the instruction comes BEFORE the first subheader
  // and its options are flush, so the run that holds the last alternative also
  // holds two genuinely required courses and nothing on the page separates them.
  //
  // Reading the runs as options here would make EDU 6426 and EDU 6866 optional —
  // under-requiring, which a student does not recover from. So the section keeps
  // demanding all of them, and the instruction reaches the reader as a note
  // instead. Over is recoverable; under is not.
  const root = page([
    areaheader('Required Courses'),
    comment('Complete one of the following:'),
    subheader('For students pursuing emergency licensure'), course('EDU 6513'),
    subheader('For students not pursuing emergency licensure'), course('EDU 6185'),
    course('EDU 6426'), course('EDU 6866'),
  ].join(''));
  const s = byTitle(root, 'Required Courses');
  assert.deepEqual(s.requirements.map(shape), ['EDU6513', 'EDU6185', 'EDU6426', 'EDU6866']);
  assert.equal(s.minRequirementCount, 4);
  assert.ok(s.notes.includes('Complete one of the following:'),
    'the instruction we could not express must still reach the reader');
});

test('subheader › a count ABOVE ONE means categories, not branches', () => {
  // Public Health BA: "Complete three of the following (two must be at the 3000
  // level or above and from the same area)" over five thematic areas. Reading a
  // run as a conjunction here demanded all ~25 courses of a theme — and
  // `check-major-integrity` caught it, along with three others, as a newly
  // over-consuming pool. You do not complete THREE of two tracks: a count above
  // one is a count of courses, so the subheaders are labels.
  const root = page([
    areaheader('Upper-Level Course'),
    comment('Complete three of the following (two must be from the same area):', '9'),
    subheader('Society and Behavior'), option('PSYC 1214'), option('SOCL 1280'),
    subheader('Law, Policy, and Human Rights'), option('POLS 1155'), option('PHIL 1165'),
  ].join(''));
  const s = byTitle(root, 'Upper-Level Course');
  const flat = JSON.stringify(s.requirements);
  assert.ok(!flat.includes('"AND"'), 'no theme may become a conjunction');
  assert.deepEqual(s.requirements[0].courses.map(shape),
    ['PSYC1214', 'SOCL1280', 'POLS1155', 'PHIL1165'],
    'all four stay options of one pool');
});

test('subheader › a CREDIT pool spans its subheadered areas', () => {
  // "Complete 12 credit hours from the following:" over three areas is ONE 12 SH
  // pool, not a choice between areas. Arming the run-as-option reading here
  // would demand one area's worth of credit instead of the pool's.
  const root = page([
    areaheader('Breadth'),
    comment('Complete 12 credit hours from the following:', '12'),
    subheader('Systems'), option('CS 3650'), option('CS 3700'),
    subheader('Theory'), option('CS 4800'), option('CS 4805'),
  ].join(''));
  const s = byTitle(root, 'Breadth');
  assert.equal(s.requirements[0].type, 'XOM');
  assert.equal(s.requirements[0].numCreditsMin, 12);
  assert.deepEqual(s.requirements[0].courses.map(shape),
    ['CS3650', 'CS3700', 'CS4800', 'CS4805'],
    'all four remain one pool — the areas are categories, not alternatives');
});

test('subheader › an indented pool with no instruction is untouched', () => {
  // Measured: 862 groups put a subheader BETWEEN two indented option rows,
  // where it is a category label inside one pool. Closing a block there would
  // split a single pool in two, so nothing here fires without an explicit
  // count instruction immediately above the first subheader.
  const root = page([
    areaheader('Electives'),
    option('CS 3650'), subheader('Theory'), option('CS 4800'),
  ].join(''));
  const s = byTitle(root, 'Electives');
  assert.equal(s.requirements.length, 1, 'ONE node — the subheader did not split the pool');
  assert.deepEqual(s.requirements[0].courses.map(shape), ['CS3650', 'CS4800']);
});

test('subheader › the subheader NAMES its branch, and stops being a note', () => {
  // Notes are section-level and printed in document order, which is right when a
  // sentence's scope is unknown. Here it is not: the subheader labels the run
  // directly beneath it. As notes, "Option 1" and "Option 2" stacked at the top
  // of the section as a flat pair — divorced from the branches they name and
  // reading like two conditions on the whole requirement — while the catalog
  // prints each one INLINE above its own group.
  const root = page([
    areaheader('Biology'),
    comment('Complete one of the following options:', '8'),
    subheader('Option 1'), option('BIOL 1141'), option('BIOL 1147'),
    subheader('Option 2'), option('BIOL 1111'), option('BIOL 1113'),
  ].join(''));
  const s = byTitle(root, 'Biology');
  const or = s.requirements[0];
  assert.equal(or.type, 'OR');
  assert.deepEqual(or.courses.map(c => c.label), ['Option 1', 'Option 2']);
  // The LABELS are displayed verbatim as branch headings, so they are the one
  // thing withheld from the notes — by string identity, not by judging
  // expressiveness. The instruction above them is not a label, so it is quoted,
  // and it heads the section because nothing precedes it.
  assert.deepEqual(s.notes, ['Complete one of the following options:']);
  for (const label of ['Option 1', 'Option 2']) {
    assert.ok(!s.notes.includes(label),
      `${label} is displayed as a branch heading — quoting it too would double it`);
  }
});

test('subheader › a named branch reaches the audit as its own heading', () => {
  // Hexagonal: the parser writes `label` on the node, the checkers surface it as
  // `branchLabel`, and every renderer heads the branch with it instead of
  // "All of". Kept apart from `label` so a renderer can tell the catalog's own
  // name from the text composed for nesting.
  const root = page([
    areaheader('Biology'),
    comment('Complete one of the following options:', '8'),
    subheader('Option 1'), option('BIOL 1141'), option('BIOL 1147'),
    subheader('Option 2'), option('BIOL 1111'), option('BIOL 1113'),
  ].join(''));
  const res = checkSection(byTitle(root, 'Biology'), new Set(['BIOL1141', 'BIOL1147']), {});
  const branches = res.children[0].children;
  assert.deepEqual(branches.map(b => b.branchLabel), ['Option 1', 'Option 2']);
  assert.equal(branches[0].sat, true, 'Option 1 is complete');
  assert.equal(branches[1].sat, false, 'Option 2 is not, and is not required to be');
  // And the composed label a PARENT shows names the branches rather than
  // nesting "All of (…)" inside "One of (…)".
  assert.equal(res.children[0].label, 'One of (Option 1, Option 2)');
});

test('subheader › an unnamed branch still falls back to "All of"', () => {
  const root = page([
    areaheader('Track'),
    comment('Complete one of the following:'),
    subheader(''), option('CS 2500'), option('CS 2510'),
    subheader(''), option('DS 2000'), option('DS 2500'),
  ].join(''));
  const res = checkSection(byTitle(root, 'Track'), new Set(), {});
  for (const b of res.children[0].children) {
    assert.equal(b.branchLabel, undefined);
    assert.match(b.label, /^All of \(/);
  }
});

test('subheader › a subheader naming no BRANCH still prints as a note', () => {
  // Consumption is earned, not assumed: a subheader only becomes a label when a
  // branch is actually built from the run beneath it. With no count instruction
  // there is no branch, so the row is prose we could not express — and it prints,
  // which is what keeps a condition from vanishing when the shape is one we do
  // not read.
  const root = page([
    areaheader('Electives', '8'),
    subheader('Approved by the program director'),
    option('CS 3650'), option('CS 4800'),
  ].join(''));
  const s = byTitle(root, 'Electives');
  assert.deepEqual(s.notes, ['Approved by the program director']);
  assert.equal(JSON.stringify(s.requirements).includes('label'), false,
    'and nothing claims it as a name');
});

// ── The real page ──────────────────────────────────────────────────────────

test('subheader › the live Data Science BS pathway is a choice of TRACKS', () => {
  const root = page([
    areaheader('Programming Sequence Pathways'),
    comment('Choose one of the two options.', '12'),
    subheader('Computer Science Option'),
    `<tr class="even"><td class="codecol"><div class="blockindent"><a>CS 2500</a><span class="blockindent">and <a>CS 2501</a></span></div></td><td>Fundamentals 1 and Lab</td><td class="hourscol">5</td></tr>`,
    `<tr class="odd"><td class="codecol"><div class="blockindent"><a>CS 2510</a><span class="blockindent">and <a>CS 2511</a></span></div></td><td>Fundamentals 2 and Lab</td><td class="hourscol">5</td></tr>`,
    option('CS 3500'),
    subheader('Data Science Option'),
    `<tr class="even"><td class="codecol"><div class="blockindent"><a>DS 2000</a><span class="blockindent">and <a>DS 2001</a></span></div></td><td>Programming with Data and Practicum</td><td class="hourscol">5</td></tr>`,
    option('DS 2500'), option('DS 3500'),
  ].join(''));
  const s = byTitle(root, 'Programming Sequence Pathways');
  assert.equal(shape(s.requirements[0]),
    'OR(AND(AND(CS2500,CS2501),AND(CS2510,CS2511),CS3500),' +
    'AND(AND(DS2000,DS2001),DS2500,DS3500))');
  // The co-requisite pairs survive as pairs inside their branch: a student on
  // the CS track takes CS 2500 WITH its lab, not one or the other.
  assert.ok(!shape(s.requirements[0]).includes('OR(CS2500'));
});

// ── A count above one: the subheaders are CATEGORIES, not branches ──────────
//
// The third reading of an areasubheader, and the one the other two exist to be
// told apart from. "Complete three of the following" over five themed areas is
// one pool of three courses, not a choice between areas — reading the runs as
// alternatives demanded a whole theme (~25 courses) and check-major-integrity
// caught it as newly over-consuming. So the TREE is left alone and the titles
// become display metadata in XOM.groups, which XomGroupHeader renders above the
// courses each one heads.
//
// Before this, the five titles were five notes stacked at the top of the
// section: present, but in a flat list divorced from the courses they head, so
// they read as five conditions on the whole requirement. That is the shape a
// screenshot of Public Health BA (Oakland) showed.

test('subheader › a count above one makes the subheaders category HEADINGS', () => {
  const root = page([
    areaheader('Upper-Level Course'),
    comment('Complete three of the following (two must be from the same area):', '9'),
    subheader('Society and Behavior'), option('SOCL 3441'), option('PSYC 3402'),
    subheader('Global Health'), option('PHTH 1270'), option('INTL 3200'),
  ].join(''));
  const s = byTitle(root, 'Upper-Level Course');

  // One pool: the tree is untouched, which is the whole point.
  assert.equal(s.requirements.length, 1);
  const pool = s.requirements[0];
  assert.equal(pool.type, 'XOM');
  assert.equal(pool.courses.length, 4, 'still ONE pool of four options');

  // The titles head their own courses, in document order.
  assert.deepEqual(pool.groups.map(g => g.title),
    ['Society and Behavior', 'Global Health']);
  assert.deepEqual(pool.groups.map(g => g.courses.map(shape)),
    [['SOCL3441', 'PSYC3402'], ['PHTH1270', 'INTL3200']]);

  // Displayed verbatim as headings, so they are NOT also quoted as notes —
  // the same rule as a branch label, and it holds by string identity.
  const notes = s.notes ?? [];
  for (const title of ['Society and Behavior', 'Global Health']) {
    assert.ok(!notes.includes(title), `${title} is a heading; quoting it would double it`);
  }
  // The instruction itself is not a heading, so it is still quoted.
  assert.deepEqual(notes,
    ['Complete three of the following (two must be from the same area):']);
});

test('subheader › a category set that does not PARTITION the pool prints instead', () => {
  // The hostile case, and a bug this file was written to catch. Options appear
  // BEFORE the first subheader, so the boundaries do not account for every
  // option; rendering headings would hide MATH 2331 inside a pool it belongs to.
  // Headings are refused — and then the titles must come back as notes, because
  // they were withheld expecting to be displayed. Getting that wrong dropped 39
  // sentences corpus-wide and moved the partition ratchet from 5.68% to 7.3%.
  const root = page([
    areaheader('Electives'),
    comment('Complete three of the following:', '9'),
    option('MATH 2331'),
    subheader('Applied'), option('MATH 3081'),
    subheader('Theory'), option('MATH 3150'),
  ].join(''));
  const s = byTitle(root, 'Electives');
  const pool = s.requirements[0];
  assert.equal(pool.courses.length, 3, 'every option is still in the pool');
  assert.equal(pool.groups, undefined, 'a non-partition yields no headings');
  // Nothing is lost: the titles are quoted instead of shown, ON THE POOL they
  // describe rather than at the section, so they stay beside their own courses.
  const notes = pool.notes ?? [];
  for (const title of ['Applied', 'Theory']) {
    assert.ok(notes.includes(title), `${title} was withheld AND not displayed — dropped`);
  }
});

test('subheader › category headings never change what satisfies the pool', () => {
  // Display metadata must be inert. Same pool twice, headings and none.
  const rows = (withSubs) => [
    areaheader('Electives'),
    comment('Complete two of the following:', '8'),
    ...(withSubs ? [subheader('A')] : []), option('SOCL 3441'),
    ...(withSubs ? [subheader('B')] : []), option('PSYC 3402'),
  ].join('');
  const courseMap = {
    'SOCL 3441': { subject: 'SOCL', classId: '3441', title: 'A', credits: 4 },
    'PSYC 3402': { subject: 'PSYC', classId: '3402', title: 'B', credits: 4 },
  };
  const strip = (o) => JSON.parse(JSON.stringify(o,
    (k, v) => (k === 'notes' || k === 'groups' ? undefined : v)));
  for (const placed of [[], ['SOCL 3441'], ['SOCL 3441', 'PSYC 3402']]) {
    const set = new Set(placed);
    assert.deepEqual(
      strip(checkSection(byTitle(page(rows(true)), 'Electives'), set, courseMap)),
      strip(checkSection(byTitle(page(rows(false)), 'Electives'), set, courseMap)),
      `headings changed the verdict for [${placed.join(', ')}]`);
  }
});

test('subheader › category headings survive ALLOCATION, not just checking', () => {
  // The bug this exists to prevent, and it is not hypothetical: the headings
  // were first emitted as {title, children}, but the PARSED group shape is
  // {title, courses} — allocateNode reads `g.courses.length` to re-slice the
  // allocated children, so it threw on 40 pages and the scrape rails refused
  // the whole run. checkSection does not touch `groups`, so a check-only test
  // passed while the scraper could not write at all.
  //
  // The lesson is the repo's own rule, which I broke: enumerate the consumers of
  // a node shape before introducing one. The panel reads the ALLOCATED shape
  // (`children`); the allocator reads the PARSED shape (`courses`). Verifying
  // against the renderer alone proved nothing about the producer.
  const root = page([
    areaheader('Upper-Level Course'),
    comment('Complete three of the following:', '9'),
    subheader('Society and Behavior'), option('SOCL 3441'), option('PSYC 3402'),
    subheader('Global Health'), option('PHTH 1270'), option('INTL 3200'),
  ].join(''));
  const section = byTitle(root, 'Upper-Level Course');
  assert.deepEqual(section.requirements[0].groups.map(g => g.courses.length), [2, 2],
    'the parsed shape must be {title, courses} — allocateNode slices on it');

  const courseMap = Object.fromEntries(
    ['SOCL 3441', 'PSYC 3402', 'PHTH 1270', 'INTL 3200'].map((k) => {
      const [subject, classId] = k.split(' ');
      return [k, { subject, classId, title: k, credits: 4 }];
    }));
  const major = { requirementSections: [section], totalCreditsRequired: 12 };

  // Must not throw, with nothing placed and with the pool satisfied.
  for (const placed of [[], ['SOCL 3441', 'PSYC 3402', 'PHTH 1270']]) {
    // allocateMajor returns the section results ARRAY (plus a synthetic General
    // Electives section appended), not an object.
    const res = allocateMajor(major, new Set(placed), courseMap);
    const pool = res[0].children[0];
    // And the allocated shape carries `children`, which is what the panel and
    // the PDF render. Both halves of the contract, in one assertion.
    assert.deepEqual(pool.groups.map(g => g.title),
      ['Society and Behavior', 'Global Health']);
    assert.deepEqual(pool.groups.map(g => g.children.length), [2, 2]);
  }
});

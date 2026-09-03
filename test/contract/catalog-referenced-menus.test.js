// CONTRACT · scripts/lib/catalog-program-parser.js — a heading that is a MENU.
//
// The parser owns every heading that owns a table, and turns each `areaheader`
// group inside it into a requirement section. That is right until a heading is
// not a requirement at all:
//
//   <h2>Computer Science Electives</h2>
//     Complete two courses … in the following ranges:
//       CS 2500 to CS 7999 …
//       One course from Khoury meaningful minors list (SEE BELOW).
//   <h2>Khoury Meaningful Minors</h2>
//     [Bouvé Health Sciences] [Arts, Media and Design] [Engineering] …
//
// Those eight college groups shipped as eight requirement sections at
// `minRequirementCount: 1` — "take one course from each of eight colleges",
// which NEU does not require and the page does not say. Measured with the
// app's own `demandOf`: Computer Science, Minor derived 52 SH against a page
// that states 20 (29 SH phantom); Data Science, Minor 45 (27 phantom). The
// same figure is the denominator `minorOverlap` derives the 50% double-count
// ceiling from, so the CS minor's cap was 26 SH against a 20 SH minor.
//
// These tests pin the three things that make the repair safe: the menu leaves
// the section list, its courses are NOT lost, and it can pay for at most one
// course. Plus the rail — because the reason this is a hand adjudication is
// that an unrecognised cross-reference must stop the run rather than be
// guessed at in either direction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseHTML } from 'node-html-parser';

import { parseRequirements, UNDERGRAD_PROFILE } from '../../scripts/lib/catalog-program-parser.js';
import { allocateSections } from '../../src/core/gradRequirements.js';

const comment = (text, cls = 'courselistcomment', hours = '') =>
  `<tr class="odd"><td colspan="2"><span class="${cls}">${text}</span></td><td class="hourscol">${hours}</td></tr>`;
const areaheader = (title) =>
  `<tr class="even areaheader"><td colspan="2"><span class="courselistcomment areaheader">${title}</span></td><td class="hourscol"></td></tr>`;
const course = (code, hours = '4') =>
  `<tr class="even"><td class="codecol"><a>${code}</a></td><td>${code}</td><td class="hourscol">${hours}</td></tr>`;
const table = (rows) => `<table class="sc_courselist">
  <tr class="hidden noscript"><td>Code</td><td>Title</td><td>Hours</td></tr>${rows}</table>`;

/**
 * The real page shape: a pool that points forward, then the menu it names.
 *
 * Copied from the live markup, including the instruction row's own
 * `hourscol` of 8 — that figure is what makes the section a credit POOL
 * rather than a list of separate requirements, and therefore what the menu
 * has something to fold into. Dropping it is not fixture trivia; it produces
 * a different shape, which is why it gets its own test below.
 */
const pageWith = (pointer, hours = '8') => parseHTML(`
  <div id="programrequirementstextcontainer">
    <h2>Computer Science Electives</h2>
    ${table(
      comment('Complete two courses that are not already required in the following ranges:',
              'courselistcomment', hours) +
      comment('CS 2500 to CS 7999', 'courselistcomment commentindent') +
      comment('CY 3000 or higher', 'courselistcomment commentindent') +
      comment(pointer, 'courselistcomment commentindent'))}
    <h2>Khoury Meaningful Minors</h2>
    ${table(
      areaheader('Arts, Media and Design') + course('ARTG 5100') + course('ARTG 5110') +
      areaheader('Engineering') + course('EECE 2160'))}
  </div>`);

const parse = (root) => parseRequirements(root, UNDERGRAD_PROFILE, { url: 'https://example/p/' });

const POINTER = 'One course from Khoury meaningful minors list (see below).';

test('menu › the menu is not a requirement section, and its areas are not either', () => {
  const { requirementSections } = parse(pageWith(POINTER));
  const titles = requirementSections.map(s => s.title);
  assert.deepEqual(titles, ['Computer Science Electives'],
    'the menu heading or its college areas still ship as requirements');
});

test('menu › the menu is READ, not dropped — every course survives in the pool', () => {
  const { requirementSections, tablesConsumed, tablesOnPage } = parse(pageWith(POINTER));
  // The coverage check must not be able to pass by ignoring the menu's table.
  assert.equal(tablesConsumed, tablesOnPage);

  const pool = requirementSections[0].requirements[0];
  const flat = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'COURSE') flat.push(`${n.subject} ${n.classId}`);
    (n.courses ?? []).forEach(walk);
  })(pool);
  for (const c of ['ARTG 5100', 'ARTG 5110', 'EECE 2160']) {
    assert.ok(flat.includes(c), `${c} was lost with the menu`);
  }
});

test('menu › the area names survive as labelled branches', () => {
  // Without them the list reaches the student as one anonymous run. The area
  // is the catalog's own fact, and the only place the page names it once the
  // sections are gone.
  const { requirementSections } = parse(pageWith(POINTER));
  const pool = requirementSections[0].requirements[0];
  const menu = pool.courses[pool.courses.length - 1];
  assert.deepEqual(menu.courses.map(b => b.label),
                   ['Arts, Media and Design', 'Engineering']);
});

test('menu › the whole menu pays for AT MOST ONE course', () => {
  // The property the page states and the reason the fold is an OR: a student
  // who took three menu courses is credited for one of them.
  const { requirementSections } = parse(pageWith(POINTER));
  const courseMap = Object.fromEntries([
    ['ARTG', 5100], ['ARTG', 5110], ['EECE', 2160], ['CS', 3000],
  ].map(([subject, n]) => [`${subject}${n}`,
    { id: `${subject}${n}`, subject, number: String(n), sh: 4 }]));

  const poolFor = (placed) => {
    const [r] = allocateSections(requirementSections, new Set(placed), new Set(), courseMap);
    return r.requirements?.[0] ?? r.children?.[0];
  };

  const three = poolFor(['ARTG5100', 'ARTG5110', 'EECE2160']);
  assert.equal(three.allocatedCourses.size, 1, 'the menu claimed more than one course');
  assert.equal(three.satSh, 4, 'the menu paid more than one course of credit');

  // And `satSh` must never disagree with what was allocated — the two used to,
  // which is how two menu courses satisfied a pool that may take one.
  for (const placed of [['ARTG5100', 'ARTG5110', 'EECE2160'], ['ARTG5100', 'CS3000'], []]) {
    const p = poolFor(placed);
    const summed = [...p.allocatedCourses].reduce((n, k) => n + (courseMap[k]?.sh ?? 4), 0);
    assert.equal(p.satSh, summed, `satSh disagrees with allocation for [${placed}]`);
  }
});

test('menu › the pointer sentence still reaches the student verbatim', () => {
  // Notes are a partition, and this row states a condition the tree cannot:
  // WHICH one course, and that it replaces a Khoury elective.
  const { requirementSections } = parse(pageWith(POINTER));
  assert.ok((requirementSections[0].notes ?? []).includes(POINTER),
            'the cross-reference sentence was consumed instead of copied');
});

test('menu › a host that is not a pool is REPORTED, never reshaped', () => {
  // Without the instruction row's credit figure the section is two separate
  // RANGE requirements, not one pool, and there is nothing to add an
  // alternative to. Wrapping it would be inventing a shape for a case the
  // corpus does not contain — both live pages produce pools, and the full
  // cached run over 1,112 programs raises this warning zero times. Degrade and
  // say so: the menu's courses go uncredited, which is visible, rather than
  // the section's `minRequirementCount` quietly coming to mean something else.
  const { requirementSections, warnings } = parse(pageWith(POINTER, ''));
  assert.equal(requirementSections.length, 1);
  assert.ok(requirementSections[0].requirements.length > 1,
            'the host was reshaped instead of left alone');
  assert.ok(warnings.some(w => /found no pool to fold into/.test(w)),
            `the drop was silent: ${JSON.stringify(warnings)}`);
});

test('menu › an UNADJUDICATED cross-reference stops the parse, naming the page', () => {
  // The rail, exercised through the real entry point rather than in isolation
  // — a guard that only fires when called directly is not guarding the caller.
  assert.throws(
    () => parse(pageWith('Choose one course from the approved list (see below).')),
    e => /unadjudicated cross-reference/.test(e.message)
      && e.message.includes('https://example/p/')
      && /Choose one course from the approved list/.test(e.message),
  );
});

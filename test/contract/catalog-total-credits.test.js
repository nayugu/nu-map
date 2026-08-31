// CONTRACT · what `parseTotalCredits` reads, and what it refuses to read.
//
// Two failures, both silent, both found by measuring the cached catalog rather
// than by reading the code:
//
//   1. A MINOR states 15–25 SH and the undergraduate window starts at 60, so
//      every total a minor page published was discarded as a stray number. All
//      173 shipped `totalCreditsRequired: 0` while Computer Science, Minor
//      prints "20 semester hours required" on the page in as many words.
//
//   2. A combined major states its major SUBTOTAL and its degree total in
//      identical words and puts the subtotal first — "92 total semester hours
//      required in the major" ahead of "128 total semester hours required" —
//      and `text.match` takes the first occurrence. Behavioral Neuroscience and
//      Philosophy, BS shipped as a 92 SH degree. `totalCreditsRequired` is what
//      the free-elective allowance is a residual against, so 36 SH of a real
//      degree simply vanished.
//
// The HTML here is hand-built rather than captured, because what is being
// tested is the reading of a SENTENCE — the fixtures in major-parser.test.js
// exist for table-shape questions, and a whole page would bury this one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';

import {
  parseTotalCredits, totalsProfileFor, isMinorProgramName,
  MINOR_CREDIT_WINDOW, UNDERGRAD_PROFILE,
} from '../../scripts/lib/catalog-program-parser.js';

/** A requirements pane holding the given sentences, as CourseLeaf renders them. */
const page = (title, ...sentences) => parse(`
  <h1 class="page-title">${title}</h1>
  <div id="programrequirementstextcontainer">
    <table class="sc_courselist"><tr class="odd"><td class="codecol">CS 2500</td>
      <td>Fundamentals of Computer Science 1</td><td class="hourscol">4</td></tr></table>
    ${sentences.map(s => `<p>${s}</p>`).join('\n')}
  </div>`);

const totalFor = (title, ...sentences) =>
  parseTotalCredits(page(title, ...sentences),
                    totalsProfileFor(UNDERGRAD_PROFILE, title), {});

// ── A minor's own window ─────────────────────────────────────────

test('totals › a minor states 20 SH and is believed', () => {
  assert.equal(totalFor('Computer Science, Minor', '20 semester hours required').value, 20);
});

test('totals › the same sentence on a DEGREE page is still out of range', () => {
  // Not a quirk to work around — it is the degree window doing its job. A
  // bachelor's is 120–134 SH, so "20 semester hours required" on a degree page
  // is one of its sections talking.
  assert.equal(totalFor('Computer Science, BSCS (Boston)', '20 semester hours required').value, 0);
});

test('totals › every phrasing a minor actually uses is read', () => {
  // Taken from the pages, not invented: the twelve minors that state a total
  // between them use these four shapes.
  const cases = [
    ['20 semester hours required', 20],
    ['16 total semester hours required', 16],
    ['Minimum of 16 semester hours required in the minor', 16],
    ['15 total semester hours required', 15],
  ];
  for (const [sentence, want] of cases) {
    assert.equal(totalFor('Audiology, Minor', sentence).value, want, sentence);
  }
});

test('totals › a minor does not inherit a DEGREE-sized figure from its page', () => {
  // Minor pages sit inside a department's section of the catalog and quote the
  // parent degree; the ceiling is what stops that number being read as the
  // minor's. This is why the window has two ends and not just a floor.
  assert.equal(totalFor('Audiology, Minor', '128 total semester hours required').value, 0);
  assert.equal(MINOR_CREDIT_WINDOW[1], 60);
});

test('totals › a figure below a real minor is refused', () => {
  // No Northeastern minor is under 15 SH (the catalog's floor is four courses),
  // so an 8 is a section talking. The floor is 12 rather than 15 because the
  // window is a plausibility check, not a policy.
  assert.equal(totalFor('Audiology, Minor', '8 semester hours required').value, 0);
});

// ── The subtotal that must not win ───────────────────────────────

test('totals › the major subtotal does not outrank the degree total', () => {
  const r = totalFor('Behavioral Neuroscience and Philosophy, BS (Boston)',
                     '92 total semester hours required in the major',
                     '128 total semester hours required');
  assert.equal(r.value, 128, 'took the subtotal that was printed first');
});

test('totals › order does not matter, and neither does the qualifier used', () => {
  for (const qualifier of ['in the major', 'for the major', 'toward the major', 'in the major.']) {
    const first = totalFor('Combined Major, BS (Boston)',
                           `92 total semester hours required ${qualifier}`,
                           '128 total semester hours required');
    const last = totalFor('Combined Major, BS (Boston)',
                          '128 total semester hours required',
                          `92 total semester hours required ${qualifier}`);
    assert.equal(first.value, 128, qualifier);
    assert.equal(last.value, 128, qualifier);
  }
});

test('totals › a page with ONLY a subtotal reports nothing, not the subtotal', () => {
  // "No total stated" is honest and an unknown is cheap; a confident wrong
  // total is what costs a student a term. 84 is not this degree's size.
  assert.equal(totalFor('Cultural Anthropology and Philosophy, BA (Boston)',
                        '84 semester hours required in the major').value, 0);
});

test('totals › an unqualified subtotal loses to the larger figure beside it', () => {
  // Cultural Anthropology and Health Science, BS prints "94 semester hours
  // required" and "128 semester hours required" with NOTHING to tell them
  // apart — no "in the major", same phrasing, sibling paragraphs in the same
  // pane. Taking the first shipped a 94 SH bachelor's degree, and three pages
  // in the catalog were in that state.
  //
  // The rule is the largest in-window match of the winning pattern: a subtotal
  // is part of a total, so it cannot exceed it.
  assert.equal(totalFor('Cultural Anthropology and Health Science, BS (Boston)',
                        '94 semester hours required',
                        '128 semester hours required').value, 128);
});

test('totals › order does not matter for an unqualified subtotal either', () => {
  assert.equal(totalFor('Combined Major, BS (Boston)',
                        '128 semester hours required',
                        '94 semester hours required').value, 128);
});

test('totals › a STRONGER phrasing still outranks a larger weak one', () => {
  // Priority ACROSS patterns is untouched — the max applies only within the
  // first pattern that matches. A page stating its total explicitly must not be
  // overruled by a bigger number phrased more loosely.
  const r = totalFor('Combined Major, BS (Boston)',
                     '128 total semester hours required',
                     '200 semester hours required');
  assert.equal(r.value, 128);
  assert.equal(r.source, 'stated-total');
});

test('totals › the window still bounds what "largest" can reach', () => {
  // 400 is outside [60, 250], so it is not a candidate at all. The ceiling is
  // what keeps "largest" from meaning "largest number on the page".
  assert.equal(totalFor('Combined Major, BS (Boston)',
                        '128 semester hours required',
                        '400 semester hours required').value, 128);
});

test('totals › a minor is bounded the same way, by its own window', () => {
  // The minor ceiling is 60, so a degree figure quoted on a minor's page loses
  // to the minor's own even though it is larger.
  assert.equal(totalFor('Audiology, Minor',
                        '15 total semester hours required',
                        '128 total semester hours required').value, 15);
});

// ── Which pages are minors ───────────────────────────────────────

test('totals › "Minor" is matched as the catalog\'s suffix, not as a substring', () => {
  assert.equal(isMinorProgramName('Arabic, Minor'), true);
  assert.equal(isMinorProgramName('Music, Minor (Boston)'), true);
  assert.equal(isMinorProgramName('Computer Science, BSCS (Boston)'), false);
  // The one that would quietly hand a DEGREE the minor window.
  assert.equal(isMinorProgramName('Race, Minorities, and Global Studies, BA'), false);
  assert.equal(isMinorProgramName('Minority Health, BS'), false);
  assert.equal(isMinorProgramName(null), false);
  assert.equal(isMinorProgramName(undefined), false);
});

test('totals › the profile switch changes the window and nothing else', () => {
  const minor = totalsProfileFor(UNDERGRAD_PROFILE, 'Arabic, Minor');
  const degree = totalsProfileFor(UNDERGRAD_PROFILE, 'Arabic, BA (Boston)');
  assert.deepEqual(minor.creditWindow, MINOR_CREDIT_WINDOW);
  assert.equal(degree, UNDERGRAD_PROFILE, 'a degree keeps the very object it came with');
  assert.equal(minor.level, UNDERGRAD_PROFILE.level);
  assert.equal(minor.pathPrefix, UNDERGRAD_PROFILE.pathPrefix);
});

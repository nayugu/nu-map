// CONTRACT · the Sample Plan of Study grid parser against real catalog HTML.
//
// Every assertion here is a case that broke the parser, kept as a named
// diagnosis rather than a snapshot. The four that matter:
//
//   1. a program publishes SEVERAL plans and querySelector reads one
//   2. content rows are not index-aligned with the term header
//   3. a cell's codes live in its links, not its text
//   4. two plans must never end up sharing a label
//
// The governing bias is the opposite of the requirement parser's. Requirements
// are checked against, so missing one warns a student wrongly; a sample plan is
// only ever offered as a starting point, so the cost of dropping an entry is
// small and the cost of INVENTING one is high — a fabricated course would be
// placed into a student's plan as though the department had asked for it.
// Hence the ⊆ direction is asserted and equality is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'node-html-parser';

import { extractPlanGrid, planGridCourseKeys } from '../../scripts/lib/plan-grid.js';
import { extractPlanOfStudyCourses } from '../../scripts/lib/catalog-program-parser.js';

const DIR  = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/catalog');
const load = name => parse(readFileSync(join(DIR, `${name}.html`), 'utf8'));
const grid = name => extractPlanGrid(load(name));

/** Every fixture, so a new capture is covered without editing this file. */
const FIXTURES = readdirSync(DIR).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''));

const termOf = (plan, yearLabel, termName) =>
  plan.years.find(y => y.label === yearLabel)?.terms.find(t => t.term === termName);

const kinds = term => term.entries.map(e => e.kind);
const codes = term => term.entries.map(e => (e.codes ?? []).join('+'));

// ── 1. Several plans per program ─────────────────────────────────────────────

test('plan grid › every published plan is returned, not just the first', () => {
  // Philosophy BA publishes six. A querySelector pass returned one and silently
  // picked a co-op pattern on the student's behalf, which is the single
  // variable the planner exists to get right.
  assert.equal(grid('philosophy-ba').plans.length, 6);
  assert.equal(grid('cs-bscs').plans.length, 2);
  assert.equal(grid('physics-bs').plans.length, 2);
  assert.equal(grid('political-science-ba').plans.length, 1);
});

test('plan grid › a plan label survives its heading', () => {
  const labels = grid('cs-bscs').plans.map(p => p.label);
  assert.deepEqual(labels, [
    'Four Years, Two Co-ops in Spring/Summer First Half',
    'Four Years, Two Co-ops in Summer Second Half/Fall',
  ]);
  // Plan length varies and is part of the label, not decoration.
  assert.match(grid('physics-bs').plans[0].label, /^Five Years, Three Co-ops/);
});

// ── 2. Sticky concentration context ──────────────────────────────────────────

test('plan grid › a concentration announced once is inherited by the next plan', () => {
  // All six philosophy headings are H3, so nesting cannot be read from the tag.
  // "Philosophy with Concentration in Law and Ethics: <pattern>" is followed by
  // a bare "<pattern>" that still belongs to Law and Ethics.
  const plans = grid('philosophy-ba').plans;
  assert.deepEqual(plans.map(p => p.concentration), [
    null, null,
    'Philosophy with Concentration in Law and Ethics',
    'Philosophy with Concentration in Law and Ethics',
    'Philosophy with Concentration in Religious Studies',
    'Philosophy with Concentration in Religious Studies',
  ]);
  // The pattern is kept separately from the composed label.
  assert.equal(plans[3].pattern, 'Four Years, Two Co-ops in Spring/Summer First Half');
  assert.equal(plans[3].label,
    'Philosophy with Concentration in Law and Ethics: Four Years, Two Co-ops in Spring/Summer First Half');
});

test('plan grid › labels are unique within a program', () => {
  // The label is how a saved selection points at a plan, so a collision makes
  // the student's choice unrecoverable. Three philosophy plans collided before
  // context was inherited.
  for (const name of FIXTURES) {
    const g = grid(name);
    if (!g) continue;
    const labels = g.plans.map(p => p.label);
    assert.equal(new Set(labels).size, labels.length,
      `${name}: duplicate plan label in ${JSON.stringify(labels)}`);
    for (const l of labels) assert.ok(l.trim(), `${name}: blank plan label`);
  }
});

// ── 3. Row alignment ─────────────────────────────────────────────────────────

test('plan grid › a term with nothing in it does not shift the columns', () => {
  // Political Science BA year 4. The header names three terms as code/hours
  // pairs, but rows 2-4 open with ONE unclassed empty cell for Fall rather than
  // an empty pair, so index-matching filed every later entry one term early.
  //
  //   header  Fall | Hours | Spring | Hours | Summer 1 | Hours
  //   row 1   Co-op | 0 | POLS 4701 or 4703 | 4 | Elective | 4
  //   row 2   ""      | Elective | 4 | Elective | 4
  const y4 = grid('political-science-ba').plans[0].years.find(y => y.label === 'Year 4');
  assert.deepEqual(y4.terms.map(t => t.term), ['Fall', 'Spring', 'Summer 1']);

  assert.deepEqual(kinds(y4.terms[0]), ['coop']);
  assert.deepEqual(kinds(y4.terms[1]), ['choice', 'placeholder', 'coop', 'placeholder']);
  assert.deepEqual(kinds(y4.terms[2]), ['placeholder', 'placeholder']);

  // The entry that used to land in Fall.
  assert.deepEqual(codes(y4.terms[1])[0], 'POLS4701+POLS4703');
});

test('plan grid › per-term credit hours come from the sum row', () => {
  const y4 = grid('political-science-ba').plans[0].years.find(y => y.label === 'Year 4');
  assert.deepEqual(y4.terms.map(t => t.hours), [0, 16, 8]);
  // A co-op term reads 0, not null — the catalog states it.
  assert.equal(y4.terms[0].hours, 0);
});

// ── 4. Codes come from links ─────────────────────────────────────────────────

test('plan grid › the second half of "POLS 4701 or 4703" is a real course', () => {
  // The visible text abbreviates the subject away. Reading text would yield one
  // course; reading the <a class="bubblelink code"> titles yields both.
  const y4 = grid('political-science-ba').plans[0].years.find(y => y.label === 'Year 4');
  assert.deepEqual(y4.terms[1].entries[0].codes, ['POLS4701', 'POLS4703']);
  assert.equal(y4.terms[1].entries[0].kind, 'choice');
});

test('plan grid › "and" is a pair to take, "or" is a choice to make', () => {
  // Conflating these is the expensive mistake: calling a corequisite pair a
  // choice drops a required course, so the parse defaults to "courses".
  const fall = termOf(grid('cs-bscs').plans[0], 'Year 1', 'Fall');
  assert.deepEqual(kinds(fall), ['course', 'courses', 'courses', 'course', 'choice']);
  assert.deepEqual(codes(fall), [
    'CS1200', 'CS1800+CS1802', 'CS2000+CS2001', 'ENGW1111', 'MATH1365+MATH1465',
  ]);
});

test('plan grid › co-ops and unnamed slots are kinds, not courses', () => {
  const y1 = grid('cs-bscs').plans[0].years.find(y => y.label === 'Year 1');
  const spring = y1.terms.find(t => t.term === 'Spring');
  assert.deepEqual(kinds(spring), ['courses', 'course', 'placeholder', 'placeholder']);
  assert.equal(spring.entries[2].text, 'General Elective');
  assert.equal(spring.entries[2].codes, undefined);

  const coop = termOf(grid('cs-bscs').plans[0], 'Year 2', 'Spring');
  assert.deepEqual(kinds(coop), ['coop']);
  // "Experiential Learning" is a co-op block too, under a different name.
  const y4 = grid('political-science-ba').plans[0].years.find(y => y.label === 'Year 4');
  assert.equal(y4.terms[1].entries[2].kind, 'coop');
});

// ── 5. Term identity ─────────────────────────────────────────────────────────

test('plan grid › term headers map to NU Map semester types', () => {
  const y1 = grid('cs-bscs').plans[0].years[0];
  assert.deepEqual(y1.terms.map(t => t.term), ['Fall', 'Spring', 'Summer 1', 'Summer 2']);
  assert.deepEqual(y1.terms.map(t => t.type), ['fall', 'spring', 'sumA', 'sumB']);
});

test('plan grid › every term the catalog names is understood', () => {
  // An unmapped header would leave type null and make the plan unplaceable.
  // Better to learn about a new spelling here than from a student.
  for (const name of FIXTURES) {
    const g = grid(name);
    if (!g) continue;
    for (const p of g.plans) for (const y of p.years) for (const t of y.terms) {
      assert.ok(t.type, `${name} / ${p.label} / ${y.label}: unmapped term "${t.term}"`);
    }
  }
});

// ── 6. Absence is normal ─────────────────────────────────────────────────────

test('plan grid › a program with no plan returns null, not an empty shell', () => {
  // Minors publish none and most graduate programs publish none. Absence must
  // read as "nothing to offer", never as a parse failure.
  assert.equal(grid('bioengineering-phd'), null);
  assert.equal(grid('conc-finance'), null);
});

test('plan grid › a returned plan is never empty', () => {
  // A grid parsed into zero entries is a failure wearing success's clothes; it
  // would surface in the UI as a sample plan that does nothing when applied.
  for (const name of FIXTURES) {
    const g = grid(name);
    if (!g) continue;
    for (const p of g.plans) {
      const entries = p.years.flatMap(y => y.terms.flatMap(t => t.entries));
      assert.ok(entries.length, `${name} / ${p.label}: parsed to no entries`);
      assert.ok(p.years.length, `${name} / ${p.label}: parsed to no years`);
    }
  }
});

// ── 7. Against the flat witness ──────────────────────────────────────────────

test('plan grid › the grid never invents a course the flat reader cannot see', () => {
  // extractPlanOfStudyCourses reads the same pane by a different route (every
  // course link anywhere in it), so it is a superset by construction: it also
  // picks up courses named in prose paragraphs, which have no term and are not
  // ours to place. Any key we produce that it does NOT have means we read a
  // code out of something that is not a course link.
  for (const name of FIXTURES) {
    const g = grid(name);
    if (!g) continue;
    const witness = new Set(extractPlanOfStudyCourses(load(name)) ?? []);
    for (const key of planGridCourseKeys(g)) {
      assert.ok(witness.has(key), `${name}: grid produced ${key}, absent from the flat witness`);
    }
  }
});

test('plan grid › the grid matches the witness wherever the plan is only tables', () => {
  // Where a pane holds nothing but grids the two routes must agree exactly —
  // this is what catches a whole year or column being dropped.
  for (const name of ['cs-bscs', 'art-ba', 'bsba', 'philosophy-ba', 'political-science-ba']) {
    const witness = extractPlanOfStudyCourses(load(name)) ?? [];
    assert.deepEqual(planGridCourseKeys(grid(name)), [...witness].sort(),
      `${name}: grid and flat witness disagree`);
  }
});

test('plan grid › courses named in prose are the witness\'s, not the grid\'s', () => {
  // Physics BS names PHYS 4621/4623/4651/4652 in a <p> beside the grids, as
  // SPAN.sc_courseinline. The flat reader counts them because it counts every
  // link in the pane; we must not, because a prose course has no term and
  // placing it would be a guess. Being stricter here is correct, so it is
  // pinned rather than treated as a gap to close.
  const witness = new Set(extractPlanOfStudyCourses(load('physics-bs')) ?? []);
  const fromGrid = new Set(planGridCourseKeys(grid('physics-bs')));
  const prose = [...witness].filter(k => !fromGrid.has(k)).sort();
  assert.deepEqual(prose, ['PHYS4621', 'PHYS4623', 'PHYS4651', 'PHYS4652']);
});

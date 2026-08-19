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

import { extractPlanGrid, planGridCourseKeys, verifyPlanGrid } from '../../scripts/lib/plan-grid.js';
import { extractPlanOfStudyCourses } from '../../scripts/lib/catalog-program-parser.js';

const DIR  = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/catalog');
const load = name => parse(readFileSync(join(DIR, `${name}.html`), 'utf8'));
const grid = name => extractPlanGrid(load(name));

/** Every fixture, so a new capture is covered without editing this file. */
const FIXTURES = readdirSync(DIR).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''));

const termOf = (plan, yearLabel, termName) =>
  plan.years.find(y => y.label === yearLabel)?.terms.find(t => t.term === termName);

// The entry model is one node type; these name the SHAPES it takes, so the
// assertions below keep reading as the diagnoses they were written as.
const kindOf = (e) =>
  e.heading ? 'heading'
  : e.either ? 'either'
  : e.vacation ? 'vacation'
  : e.coop ? 'coop'
  : !e.options.length ? 'placeholder'
  : e.options.length > 1 ? 'choice'
  : e.options[0].length > 1 ? 'courses'
  : 'course';
const kinds = term => term.entries.map(kindOf);
const codes = term => term.entries.map(e => e.options.flat().join('+'));

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
  assert.deepEqual(y4.terms[1].entries[0].options, [['POLS4701'], ['POLS4703']],
    'two groups — a choice the student makes, not a pair they take');
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
  assert.deepEqual(spring.entries[2].options, [], 'named nothing — the answer is left open');

  const coop = termOf(grid('cs-bscs').plans[0], 'Year 2', 'Spring');
  assert.deepEqual(kinds(coop), ['coop']);
  // "Experiential Learning" is a co-op block too, under a different name.
  const y4 = grid('political-science-ba').plans[0].years.find(y => y.label === 'Year 4');
  assert.equal(y4.terms[1].entries[2].coop, true);
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

// ── 5. Option groups keep the catalog's grouping ─────────────────────────────
//
// 36 cells mix `and` with `or`, and flattening them asserts something false:
// "PSYC 3200 or PT 5410 and PT 5411" means PSYC 3200 OR (PT 5410 AND PT 5411),
// so a flat three-way list tells a student that PT 5410 alone satisfies it.
// Every text below is taken verbatim from the shipped corpus.
// In a real cell the links ARE the visible text, with only connectives between
// them — "MATH 1365 or 1465" shows the second code with its subject stripped.
// So a cell is written as a template whose {} are links; `TITLE|shown` gives a
// link whose title differs from what the catalog prints.
const cellEntry = (template, links = [], sh = '') => {
  let i = 0;
  const body = template.replace(/\{\}/g, () => {
    const [title, shown = title] = String(links[i++]).split('|');
    return `<a class="bubblelink code" title="${title}">${shown}</a>`;
  });
  const html = '<div id="planofstudytextcontainer"><table class="sc_plangrid">'
    + '<tr class="plangridterm"><th>Fall</th><th>Hours</th></tr>'
    + `<tr><td class="codecol">${body}</td><td class="hourscol">${sh}</td></tr>`
    + '</table></div>';
  return extractPlanGrid(parse(html))?.plans[0].years[0].terms[0].entries[0];
};

test('a pair joined by "and" is one group; alternatives are separate groups', () => {
  assert.deepEqual(cellEntry('{} and {}', ['CS 2100', 'CS 2101']).options,
    [['CS2100', 'CS2101']], 'both required');
  assert.deepEqual(cellEntry('{} or {}', ['CS 4530', 'CS 4535|4535']).options,
    [['CS4530'], ['CS4535']], 'pick one');
  // The second mention carries no subject — which is why grouping is read from
  // the text while the codes come from the links.
  assert.deepEqual(cellEntry('{} or {}', ['MATH 1365', 'MATH 1465|1465']).options,
    [['MATH1365'], ['MATH1465']]);
});

test('a mixed and/or cell keeps its grouping and is flagged for review', () => {
  const e = cellEntry('{} or {} and {}', ['PSYC 3200', 'PT 5410', 'PT 5411']);
  assert.deepEqual(e.options, [['PSYC3200'], ['PT5410', 'PT5411']],
    'PSYC 3200 alone, or BOTH PT courses — never PT 5410 by itself');
  assert.equal(e.ambiguous, true, 'mixed connectives are best-effort, so they are reviewable');

  assert.deepEqual(
    cellEntry('{} or {} and {} and {}',
      ['BIOL 1111', 'PHYS 1155', 'PHYS 1156', 'PHYS 1157']).options,
    [['BIOL1111'], ['PHYS1155', 'PHYS1156', 'PHYS1157']]);
});

test('a comma list ending in ", or" separates on the commas too', () => {
  // Otherwise this comes out as one five-course group plus a stray.
  assert.deepEqual(
    cellEntry('{}, {}, {}, {}, {}, or {}',
      ['MATH 1231', 'MATH 1241|1241', 'MATH 1245|1245', 'MATH 1251|1251',
       'MATH 1340|1340', 'MATH 1341|1341']).options,
    [['MATH1231'], ['MATH1241'], ['MATH1245'], ['MATH1251'], ['MATH1340'], ['MATH1341']]);
  assert.deepEqual(
    cellEntry('{}, {}, or {}', ['ENGW 3302', 'ENGW 3307|3307', 'ENGW 3315|3315']).options,
    [['ENGW3302'], ['ENGW3307'], ['ENGW3315']]);
});

test('no code is ever lost, whatever the connectives do', () => {
  const texts = [
    ['{}, and {}, {} and {}, or {}',
      ['CS 1100', 'CS 1101', 'CS 2000', 'CS 2001', 'MISM 2510']],
    ['{}, and {}, or {} and {}',
      ['ENVR 1500', 'ENVR 1501', 'ENVR 3300', 'ENVR 3301']],
    ['{} or {} and {}', ['CHEM 5620', 'CHEM 3331|3331', 'CHEM 3332|3332']],
  ];
  for (const [text, links] of texts) {
    const e = cellEntry(text, links);
    const flat = e.options.flat();
    assert.equal(flat.length, links.length, `every code kept: ${text}`);
    assert.equal(new Set(flat).size, links.length, 'and none duplicated');
  }
});

// ── 6. A cell that names nothing is the same node with no answer ─────────────
test('an unnamed reservation is an entry with empty options, not a special kind', () => {
  const e = cellEntry('Khoury Elective', [], '4');
  assert.deepEqual(e.options, []);
  assert.equal(e.sh, 4);
  assert.equal(e.text, 'Khoury Elective', 'the catalog wording is kept verbatim');
});

test('a heading labels the rows beneath it instead of reserving a place', () => {
  const kind = (text, sh = '') => {
    const e = cellEntry(text, [], sh);
    return e.heading ? 'heading' : e.either ? 'either' : e.vacation ? 'vacation'
         : e.coop ? 'coop' : 'entry';
  };
  assert.equal(kind('Complete the following:'), 'heading');
  assert.equal(kind('Pharmaceutics &amp; Drug Delivery:'), 'heading');
  assert.equal(kind('or'), 'heading');
  // Credit decides before wording: BSBA prints a term's hours ON the heading
  // and leaves the courses beneath blank, so a priced row is a reservation.
  assert.equal(kind('During the first year of courses, students must complete one course '
    + 'for each specialization:', 3), 'entry');
  assert.equal(kind('Dialogue of Civilizations'), 'entry', 'unpriced but real');
  assert.equal(kind('Vacation'), 'vacation');
});

test('a cell offering co-op OR vacation keeps the choice', () => {
  // Both patterns are anchored and neither excludes the other, so whichever
  // ran first used to silently decide: "Co-op or vacation" became a forced
  // co-op, "Vacation or optional co-op #2" a forced vacation.
  assert.deepEqual(cellEntry('Co-op or vacation', []).either, ['coop', 'vacation']);
  assert.deepEqual(cellEntry('Vacation or optional co-op #2', []).either, ['coop', 'vacation']);
  assert.equal(cellEntry('Vacation', []).vacation, true);
  assert.equal(cellEntry('Co-op', []).coop, true);
});

// ── 7. The catalog checks our arithmetic ─────────────────────────────────────
test('every term in every fixture sums to the total the catalog printed', () => {
  const bad = [];
  for (const name of FIXTURES) {
    const g = grid(name);
    if (g) bad.push(...verifyPlanGrid(g, name).worst);
  }
  assert.deepEqual(bad, [], 'terms whose parsed hours disagree with the catalog');
});

// ── 8. An independent reading of the same HTML ───────────────────────────────
//
// Every other check here trusts extractPlanGrid to say what a cell contained.
// The checksum is stronger — the totals come from the department, not from us —
// but it verifies ARITHMETIC, so a parse could assign rows to the wrong terms
// and still add up if the errors cancelled.
//
// This walks the table a second time, deliberately naively, and compares
// content cell by cell. It is not a better parser: it exists to disagree.
// Reading the live catalog by other means DID disagree once, putting Computer
// Science BSCS's EECE 2310/2311 in Year 2 Fall and CS 3000/3650 in Summer 2 —
// the reverse of the truth. The raw HTML settled it our way, and the cause was
// the `colspan="2"` empty cells this file walks left-to-right precisely to
// survive.
function naiveTerms(html) {
  const table = /<table class="sc_plangrid"[\s\S]*?<\/table>/.exec(html)?.[0];
  if (!table) return null;
  const out = [];            // [{ year, term, cells: [text] }]
  let columns = [];
  let year = '';
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    // Tags become a SPACE, not nothing: "<a>ARTH 1001</a>and <a>ARTH 1002</a>"
    // otherwise reads as "ARTH 1001and ARTH 1002".
    const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#160;|&nbsp;/g, ' ')
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    // A cell arrives as the remainder of its own opening tag, so everything up
    // to the first '>' is attributes rather than content.
    const body = (c) => c.slice(c.indexOf('>') + 1).split('</td>')[0];
    if (/plangridyear/.test(row)) { year = strip(row); continue; }
    if (/plangridterm/.test(row)) {
      columns = (row.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? [])
        .map(strip).filter(t => t && !/^hours$/i.test(t));
      for (const term of columns) out.push({ year, term, cells: [] });
      continue;
    }
    if (/plangridsum|plangridtotal/.test(row)) continue;
    if (!columns.length) continue;
    // Walk left to right: a codecol opens a term, anything else is one empty
    // term. Indexing instead is the bug this shape exists to defend against.
    const cells = row.split('<td').slice(1);
    let term = 0;
    for (let i = 0; i < cells.length && term < columns.length; term++) {
      const isCode = /^[^>]*class="[^"]*codecol/.test(cells[i]);
      if (isCode) {
        const text = strip(body(cells[i]));
        const slot = out.find(o => o.year === year && o.term === columns[term]);
        if (text && slot) slot.cells.push(text);
        i += /^[^>]*class="[^"]*hourscol/.test(cells[i + 1] ?? '') ? 2 : 1;
      } else i += 1;
    }
  }
  return out;
}

test('a second, naive reading of the HTML agrees cell for cell', () => {
  const mismatches = [];
  for (const name of FIXTURES) {
    const html = readFileSync(join(DIR, `${name}.html`), 'utf8');
    const naive = naiveTerms(html);
    const parsed = grid(name);
    if (!naive || !parsed) continue;
    const plan = parsed.plans[0];            // naiveTerms reads the first table
    for (const y of plan.years) {
      for (const t of y.terms) {
        // Plus the wording of any row FOLDED INTO a "select one of the following" header.
        // The naive reader knows nothing about indentation, so it still sees those rows as
        // cells of their own; `optionLabels` is exactly what they said, kept for that reason
        // as much as for the UI. Without this the comparison would report a cell lost every
        // time the parser correctly recognised a choice.
        const mine = t.entries.flatMap(e => [e.text, ...(e.optionLabels ?? [])]);
        const theirs = naive.find(o => o.year === y.label && o.term === t.term)?.cells ?? [];
        // Compare as multisets of visible text: the naive reader knows nothing
        // about headings, groups or co-ops, only what the cell said.
        // Turning every tag into a space leaves one before punctuation
        // ("ENGW 1111 , ECON 1116"), which is an artefact of reading naively
        // rather than a difference in what the cell said.
        const norm = (a) => [...a]
          .map(s => s.replace(/\s+/g, ' ').replace(/\s+([,;:.])/g, '$1').trim())
          .sort();
        if (JSON.stringify(norm(mine)) !== JSON.stringify(norm(theirs))) {
          mismatches.push({ fixture: name, year: y.label, term: t.term, mine, theirs });
        }
      }
    }
  }
  assert.deepEqual(mismatches, [], 'cells our parser and a naive walk disagree about');
});

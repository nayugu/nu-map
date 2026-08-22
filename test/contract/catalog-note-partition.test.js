// CONTRACT · scripts/lib/catalog-program-parser.js — notes are a PARTITION.
//
// The guarantee the positional-notes design rests on: every prose row of a
// requirement group reaches exactly one place — the node it introduced, or the
// section — and none is invented. It replaced a subtraction (notes = all prose
// rows − rows the parser marked consumed), which had two structural defects:
// position was lost, because the complement was computed after the fact; and
// partial expression was invisible, because a row was consumed atomically, so
// "Complete two of the following (excluding HIST 2301 and HIST 2302):" was
// consumed for its COUNT and the exclusion went with it.
//
// This file is deliberately hostile in the direction that matters. A test that
// only confirmed "notes exist" would have passed against the old code too. So:
//
//   · COVERAGE — no prose row may go missing (the old failure), checked against
//     the raw markup rather than against the parser's own opinion of what it
//     consumed. Reading consumption back out of the parser would be the same
//     mistake as re-testing the instruction patterns from outside: it drifts.
//   · NO INVENTION — nothing may appear that the page does not say, which is
//     what would break if a renderer or a merge started synthesising text.
//   · INERTNESS — a note must never change whether a requirement is satisfied.
//     A sentence states a condition this code cannot check, so allocation must
//     be byte-identical with and without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseHTML } from 'node-html-parser';
import { parseRequirements } from '../../scripts/lib/catalog-program-parser.js';
import { checkSection } from '../../src/core/gradRequirements.js';

// Resolved from THIS FILE, not the cwd. `npm run test:contract` runs with cwd
// set to test/contract, so a bare '.cache/catalog' does not exist there and both
// corpus tests would silently skip — a no-op test that reads as a passing one,
// which is the same trap the browser suite fell into.
const CACHE = process.env.CATALOG_HTML_CACHE
  ?? fileURLToPath(new URL('../../.cache/catalog', import.meta.url));
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Every prose row the markup shows, by group, ignoring areaheaders. */
function proseRowsOf(root) {
  const out = [];
  for (const table of root.querySelectorAll('table.sc_courselist')) {
    for (const tr of table.querySelectorAll('tr')) {
      const sp = tr.querySelector('td[colspan="2"] span.courselistcomment');
      if (!sp) continue;
      if ((sp.getAttribute('class') ?? '').includes('areaheader')) continue;
      const t = norm(sp.text);
      if (t) out.push(t);
    }
  }
  return out;
}

const notesUnder = (nodes) => (nodes ?? []).flatMap(
  (r) => [...(r?.notes ?? []), ...notesUnder(r?.courses),
          ...(r?.groups ?? []).flatMap((g) => notesUnder(g.courses ?? g.children))]);

function allNotesOf(out) {
  const secs = [
    ...(out.requirementSections ?? []),
    ...(out.concentrations?.concentrationOptions ?? []),
  ];
  return secs.flatMap((s) => [...(s.notes ?? []), ...notesUnder(s.requirements)]);
}

const pages = existsSync(CACHE)
  ? readdirSync(CACHE).filter((f) => f.endsWith('.html') && !f.includes('archive_'))
  : [];

// A fixed, spread sample rather than the whole cache: the guarantee is per-page,
// so 400 pages exercise it thousands of times over while keeping the suite fast.
// Deterministic stride, so a failure is reproducible.
const sample = pages.filter((_, i) => i % Math.max(1, Math.floor(pages.length / 400)) === 0);

test('every prose row the catalog prints survives somewhere', (t) => {
  if (!pages.length) return t.skip(`no catalog cache at ${CACHE}`);
  const missing = [];
  let rows = 0;
  for (const file of sample) {
    const html = readFileSync(`${CACHE}/${file}`, 'utf8');
    if (!html.includes('sc_courselist')) continue;
    let root, out;
    try { root = parseHTML(html); out = parseRequirements(root, {}, {}); } catch { continue; }

    const printed = new Set(allNotesOf(out));
    // Titles and labels are displayed verbatim too, and a sentence promoted to
    // one of those is shown, not lost.
    const shown = new Set([...printed]);
    const collect = (nodes) => (nodes ?? []).forEach((r) => {
      if (r?.label) shown.add(norm(r.label));
      // XOM.groups titles are displayed verbatim by XomGroupHeader, above the
      // courses each one heads. A sentence promoted to a category heading is
      // shown, not lost — this test caught exactly that move when the thematic
      // subheaders stopped being notes.
      for (const g of r?.groups ?? []) { shown.add(norm(g.title)); collect(g.courses ?? g.children); }
      collect(r?.courses);
    });
    for (const s of out.requirementSections ?? []) { shown.add(norm(s.title)); collect(s.requirements); }
    for (const c of out.concentrations?.concentrationOptions ?? []) { shown.add(norm(c.title)); collect(c.requirements); }
    for (const g of out.gpaConstraints ?? []) if (g?.text) shown.add(norm(g.text));

    for (const row of proseRowsOf(root)) {
      rows++;
      // A group the parser drops entirely (no section emitted) takes its prose
      // with it — that is a separate, pre-existing behaviour with its own
      // coverage elsewhere. What must not happen is a row vanishing from a
      // section that DID survive, so only count rows whose text is nowhere.
      if (!shown.has(row) && ![...shown].some((v) => v.includes(row))) {
        missing.push({ file, row });
      }
    }
  }
  assert.ok(rows > 1000, `expected a substantial sample, saw ${rows} prose rows`);
  // Measured 5.68% (134/2360), and NOT expected to be zero, for two reasons
  // that were both checked rather than assumed:
  //
  //   · this counts every sc_courselist on the page, including panes
  //     partitionPanes excludes on purpose (a second requirement pane is a
  //     different PROGRAM — see docs/program-variants.md). History MA's missing
  //     "Complete 20 semester hours from the following:" is pane #1; the pane
  //     actually parsed carries all four of its sentences.
  //   · the subject-pool rows, withheld because an anchored grammar proved they
  //     are wholly expressed.
  //
  // So this is a ratchet against regression, not a coverage claim. Tight enough
  // that dropping a real class of sentence trips it.
  const rate = missing.length / rows;
  assert.ok(rate < 0.065,
    `${missing.length}/${rows} (${(rate * 100).toFixed(1)}%) prose rows reach nothing; `
    + `first: ${JSON.stringify(missing.slice(0, 3), null, 1)}`);
});

test('no note is invented — every one is a sentence on the page', (t) => {
  if (!pages.length) return t.skip(`no catalog cache at ${CACHE}`);
  const bogus = [];
  let notes = 0;
  for (const file of sample) {
    const html = readFileSync(`${CACHE}/${file}`, 'utf8');
    if (!html.includes('sc_courselist')) continue;
    let root, out;
    try { root = parseHTML(html); out = parseRequirements(root, {}, {}); } catch { continue; }
    const onPage = new Set(proseRowsOf(root));
    for (const n of allNotesOf(out)) {
      notes++;
      if (!onPage.has(n)) bogus.push({ file, note: n });
    }
  }
  assert.ok(notes > 500, `expected a substantial sample, saw ${notes} notes`);
  assert.deepEqual(bogus.slice(0, 5), [],
    `${bogus.length}/${notes} notes are not verbatim rows of their own page`);
});

test('a note never decides whether a requirement is satisfied', () => {
  // Same section twice, one carrying prose at every level. If a checker ever
  // reads a note — or a renderer's needs push one into the satisfaction path —
  // these diverge. That would be the expensive failure: a sentence stating a
  // condition we cannot evaluate must not be able to refuse a plan.
  const section = (withNotes) => ({
    type: 'SECTION',
    title: 'Electives',
    ...(withNotes ? { notes: ['Research courses may not be used.'] } : {}),
    minRequirementCount: 1,
    requirements: [
      { type: 'OR',
        ...(withNotes ? { notes: ['Complete one of the following:'] } : {}),
        courses: [
          { type: 'COURSE', subject: 'PHIL', classId: '1145',
            ...(withNotes ? { notes: ['Offered in fall only.'] } : {}) },
          { type: 'COURSE', subject: 'PHIL', classId: '5555' },
        ] },
    ],
  });
  const courseMap = {
    'PHIL 1145': { subject: 'PHIL', classId: '1145', title: 'A', credits: 4 },
    'PHIL 5555': { subject: 'PHIL', classId: '5555', title: 'B', credits: 4 },
  };
  const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === 'notes' ? undefined : v)));

  for (const placed of [[], ['PHIL 1145'], ['PHIL 5555'], ['PHIL 1145', 'PHIL 5555']]) {
    const set = new Set(placed);
    assert.deepEqual(
      strip(checkSection(section(true), set, courseMap)),
      strip(checkSection(section(false), set, courseMap)),
      `notes changed the verdict for [${placed.join(', ')}]`);
  }
});

test('notes reach the node, so a renderer can print them in position', () => {
  const res = checkSection({
    type: 'SECTION', title: 'Electives', minRequirementCount: 1,
    requirements: [
      { type: 'OR', notes: ['Complete one of the following:'],
        courses: [{ type: 'COURSE', subject: 'PHIL', classId: '1145' }] },
    ],
  }, new Set(), { 'PHIL 1145': { subject: 'PHIL', classId: '1145', title: 'A', credits: 4 } });
  assert.deepEqual(res.children[0].notes, ['Complete one of the following:']);
});

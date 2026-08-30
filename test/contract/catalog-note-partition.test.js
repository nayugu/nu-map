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
import {
  parseRequirements, UNDERGRAD_PROFILE, GRAD_PROFILE,
} from '../../scripts/lib/catalog-program-parser.js';
import { checkSection } from '../../src/core/gradRequirements.js';

// Resolved from THIS FILE, not the cwd. `npm run test:contract` runs with cwd
// set to test/contract, so a bare '.cache/catalog' does not exist there and both
// corpus tests would silently skip — a no-op test that reads as a passing one,
// which is the same trap the browser suite fell into.
const CACHE = process.env.CATALOG_HTML_CACHE
  ?? fileURLToPath(new URL('../../.cache/catalog', import.meta.url));
const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * The profile a cached page must be parsed with.
 *
 * ⚠ Both tests below used to pass `{}`, and an empty profile is not a neutral
 * one: `proseSectionSH` asks `statedTotalIn` whether a sentence is a degree
 * total, and that reads `profile.creditWindow`. Destructuring `undefined`
 * throws, the `catch { continue }` beneath swallowed it, and **605 of the 631
 * cached program pages were skipped in silence** — the partition guarantee ran
 * on 4% of the corpus while reporting nothing wrong. The `rows > 1000`
 * assertion is the only reason anyone found out, and only once a cache existed.
 *
 * So the profile is now the real one, and `parseFailures` below counts what
 * the catch swallows instead of letting it hide the next one.
 */
const profileFor = (file) => (file.includes('_graduate_') ? GRAD_PROFILE : UNDERGRAD_PROFILE);

/**
 * Prose the pane prints OUTSIDE any table.
 *
 * A requirements pane is a run of headings and body copy, and the body copy is
 * a source of sections in its own right: `proseSectionSH` reads "…a total of 12
 * semester hours of language study" off a `<p>` on all 105 BA programs. The
 * note such a section carries is a page sentence like any other — it simply is
 * not a `courselistcomment` row.
 *
 * Missing from `onPage` below until the sample stopped being 4% of the corpus,
 * at which point 136 of 5,709 notes read as invented when every one of them is
 * printed on its page. "On the page" has to mean the page, not the tables.
 */
function proseParasOf(root) {
  const out = [];
  for (const el of root.querySelectorAll('p, li, div.noindent')) {
    if (el.closest('table')) continue;
    const t = norm(el.text);
    if (t) out.push(t);
  }
  return out;
}

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
  let rows = 0, parseFailures = 0;
  for (const file of sample) {
    const html = readFileSync(`${CACHE}/${file}`, 'utf8');
    if (!html.includes('sc_courselist')) continue;
    let root, out;
    try { root = parseHTML(html); out = parseRequirements(root, profileFor(file), {}); }
    catch { parseFailures++; continue; }

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
  // A page the parser THREW on is a page this guarantee did not check, and a
  // silent `continue` is how 96% of them went missing once before. Assert on
  // the swallowed count, not just on the sample size — the two fail for
  // different reasons and only this one names the cause.
  assert.equal(parseFailures, 0, `${parseFailures} pages threw and were skipped in silence`);
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
  let notes = 0, parseFailures = 0;
  for (const file of sample) {
    const html = readFileSync(`${CACHE}/${file}`, 'utf8');
    if (!html.includes('sc_courselist')) continue;
    let root, out;
    try { root = parseHTML(html); out = parseRequirements(root, profileFor(file), {}); }
    catch { parseFailures++; continue; }
    const onPage = new Set([...proseRowsOf(root), ...proseParasOf(root)]);
    for (const n of allNotesOf(out)) {
      notes++;
      // Equal to a row or a paragraph, or a sentence taken verbatim out of one
      // — `proseSectionSH` may quote part of a paragraph. Containment is the
      // weaker test and it is the honest one: what is being ruled out is text
      // the page does not say, not text the page says at a different length.
      if (!onPage.has(n) && ![...onPage].some((v) => v.includes(n))) {
        bogus.push({ file, note: n });
      }
    }
  }
  assert.equal(parseFailures, 0, `${parseFailures} pages threw and were skipped in silence`);
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

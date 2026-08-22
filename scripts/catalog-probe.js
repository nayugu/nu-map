#!/usr/bin/env node
/**
 * catalog-probe.js — ask questions about catalog requirement TABLES, fast.
 *
 * The companion to `corpus-ask.js`. That instrument answers questions about
 * courses and finished plans; this one answers questions about the *markup we
 * parse*: which row shapes exist, how often, and on which pages. Those are the
 * questions that decide parser changes, and every one of them used to be
 * answered by a script written in a chat and deleted afterwards.
 *
 * It reads the on-disk HTML cache (`CATALOG_HTML_CACHE`, see lib/catalog-cache.js)
 * so it never touches the network. Populate the cache once:
 *
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/scrape-majors.js
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/scrape-grad-majors.js
 *
 * ~8,000 pages / 390 MB, and a probe over the whole thing is ~30 s — against
 * ~12 minutes to re-fetch politely. Then:
 *
 *   node scripts/catalog-probe.js --count 'g.codes.length === 0'
 *   node scripts/catalog-probe.js --tally 'g.rows.length' --where 'g.hours > 0'
 *   node scripts/catalog-probe.js --show 'g.section.includes("Technical Elective")'
 *   node scripts/catalog-probe.js --json out.json --where '…'
 *
 * The unit of analysis is a GROUP: one areaheader sub-section of one
 * sc_courselist table, which is exactly the unit `parseTable` turns into a
 * SECTION (or drops). Each group is exposed to the expression as `g`:
 *
 *   g.page      <h1> of the page
 *   g.file      cache filename (the source url is embedded in it)
 *   g.pane      id of the containing *textcontainer div
 *   g.table     index of the table within the page
 *   g.section   areaheader title, or '(lead)' for rows before the first one
 *   g.hours     the areaheader's own hourscol, as a number (0 when absent)
 *   g.rows      [{ cls, code, title, hours, text, comment, indent }]
 *   g.codes     course codes appearing in the group's codecol cells
 *   g.comments  courselistcomment texts (non-areaheader), whitespace-normalised
 *   g.notes     <p>/<div> prose in the same pane, outside any table
 *
 * Exit status is 0 for a successful probe regardless of what it found — this is
 * a question, not a verdict. Unlike verify-chart, a probe proves nothing about
 * the corpus being correct; it only reports what the markup says.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { parse as parseHTML } from 'node-html-parser';
import {
  parseRequirements, UNDERGRAD_PROFILE, GRAD_PROFILE,
} from './lib/catalog-program-parser.js';

const CACHE_DIR = process.env.CATALOG_HTML_CACHE || '.cache/catalog';

const argv = process.argv.slice(2);
const flag = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const WHERE = flag('--where') ?? flag('--count') ?? flag('--show') ?? null;
const MODE  = argv.includes('--tally') ? 'tally'
            : argv.includes('--count') ? 'count'
            : argv.includes('--json')  ? 'json'
            : 'show';
const TALLY = flag('--tally');
const OUT   = flag('--json');
const LIMIT = parseInt(flag('--limit') ?? '40', 10);

if (argv.includes('--help') || (!WHERE && !TALLY && !argv.includes('--parse'))) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8')
    .split('\n').slice(1).filter(l => l.startsWith(' *')).map(l => l.slice(3)).join('\n'));
  process.exit(0);
}

const norm = s => (s ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const cell = (tr, sel) => norm(tr.querySelector(sel)?.text);

/** The row's hourscol as a number: "4-5" → 4, absent → 0. */
function hoursOf(tr) {
  const m = norm(tr.querySelector('td.hourscol')?.text).match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

/** Split one sc_courselist table into areaheader groups, mirroring parseTable. */
function groupsOf(table) {
  const groups = [];
  let cur = null;
  for (const tr of table.querySelectorAll('tr')) {
    const cls = tr.getAttribute('class') ?? '';
    if (cls.includes('hidden') && cls.includes('noscript')) continue;
    const ahSpan = tr.querySelector('span.areaheader, span.courselistcomment.areaheader');
    if (cls.includes('areaheader') || ahSpan) {
      if (cur) groups.push(cur);
      cur = { section: norm(ahSpan?.text ?? tr.text), hours: hoursOf(tr), rows: [] };
      continue;
    }
    if (!cur) cur = { section: '(lead)', hours: 0, rows: [] };
    const commentSpan = tr.querySelector('span.courselistcomment');
    cur.rows.push({
      cls,
      code:    cell(tr, 'td.codecol'),
      title:   cell(tr, 'td:not(.codecol):not(.hourscol)'),
      hours:   hoursOf(tr),
      text:    norm(tr.text),
      comment: commentSpan ? norm(commentSpan.text) : '',
      indent:  !!tr.querySelector('span.commentindent, div.blockindent'),
    });
  }
  if (cur) groups.push(cur);
  return groups;
}

/** Prose in a pane that is not inside any course table — where notes live. */
function notesOf(pane) {
  const out = [];
  for (const el of pane.querySelectorAll('p, div.noindent, ul li')) {
    if (el.closest('table')) continue;
    const t = norm(el.text);
    if (t) out.push(t);
  }
  return [...new Set(out)];
}

/**
 * --parse <substring>: run the real parser over the matching cached page(s) and
 * print the SECTIONS it produces. The question "what does my parser change do
 * to this page" otherwise costs a scraper run per look, and the answer scrolls
 * past inside a 545-program log.
 */
if (argv.includes('--parse')) {
  const needle = flag('--parse');
  const hits = readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('.html') && !f.includes('archive_') && f.includes(needle));
  if (!hits.length) {
    console.error(`no cached page matches "${needle}" (cache: ${CACHE_DIR})`);
    process.exit(1);
  }
  for (const file of hits.slice(0, 3)) {
    const root = parseHTML(readFileSync(`${CACHE_DIR}/${file}`, 'utf8'));
    const profile = file.includes('_graduate_') ? GRAD_PROFILE : UNDERGRAD_PROFILE;
    const out = parseRequirements(root, profile, {});
    console.log(`\n══ ${norm(root.querySelector('h1')?.text)}  [${file}]`);
    for (const s of out.requirementSections ?? []) {
      const n = (s.requirements ?? []).length;
      console.log(`  § ${s.title}  —  ${n} requirement${n === 1 ? '' : 's'}`
        + `, min ${s.minRequirementCount}`
        + (s.creditsRequired ? `, ${s.creditsRequired} SH` : '')
        + (s.notes?.length ? `, ${s.notes.length} note(s)` : ''));
      for (const note of s.notes ?? []) console.log(`      note: ${note}`);
      // The requirement tree, so a note's POSITION is visible. A note attached
      // to a node prints above that node, exactly where the renderers put it —
      // which is the only way to check placement without a scraper run.
      const walk = (nodes, depth) => {
        for (const r of nodes ?? []) {
          const pad = '  '.repeat(depth + 3);
          for (const note of r.notes ?? []) console.log(`${pad}↳ note: ${note}`);
          const what = r.type === 'COURSE'
            ? `${r.subject} ${r.classId}`
            : r.type + (r.label ? ` "${r.label}"` : '')
              + (r.numCreditsMin ? ` ≥${r.numCreditsMin}SH` : '');
          console.log(`${pad}${what}`);
          // XOM.groups is display metadata — category headings inside one pool.
          // Printed here because "did the subheader become a heading or vanish"
          // is the only question that distinguishes the fix from a data loss.
          if (r.groups?.length) {
            for (const g of r.groups) {
              console.log(`${pad}  ▸ ${g.title}`);
              walk(g.children, depth + 2);
            }
            continue;
          }
          if (r.courses) walk(r.courses, depth + 1);
        }
      };
      if (process.argv.includes('--tree')) walk(s.requirements, 0);
    }
    if (out.generalElectiveSH) console.log(`  general electives: ${out.generalElectiveSH} SH`);
    for (const note of out.notes ?? []) console.log(`  program note: ${note}`);
  }
  process.exit(0);
}

const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.html'));
const records = [];

/**
 * --sections: the unit of analysis becomes the SECTION the parser PRODUCES
 * rather than the markup group it reads. Same four modes, same `g` binding.
 *
 * The markup view answers "what does the catalog say"; this one answers "what
 * did we make of it", which is the other half of every parser question and the
 * half that used to need a full scraper run to see. `g.notes` here is the
 * section's residual prose — the sentences the parse did not express — so
 *
 *   node scripts/catalog-probe.js --sections --tally 'g.notes.length'
 *
 * is the coverage measurement for change 2.
 */
const SECTIONS = argv.includes('--sections');
if (SECTIONS) {
  for (const file of files) {
    if (file.includes('archive_')) continue;
    const html = readFileSync(`${CACHE_DIR}/${file}`, 'utf8');
    if (!html.includes('sc_courselist')) continue;
    let root;
    try { root = parseHTML(html); } catch { continue; }
    const page = norm(root.querySelector('h1')?.text) || file;
    const profile = file.includes('_graduate_') ? GRAD_PROFILE : UNDERGRAD_PROFILE;
    let out;
    try { out = parseRequirements(root, profile, {}); } catch { continue; }
    const nodeNotesOf = (nodes) => (nodes ?? []).flatMap(
      r => [...(r.notes ?? []), ...nodeNotesOf(r.courses)]);
    const push = (s, conc) => records.push({
      page, file, pane: conc ? 'concentration' : 'section', table: 0,
      section: s.title ?? '', hours: s.creditsRequired ?? 0,
      reqs: (s.requirements ?? []).length, min: s.minRequirementCount ?? 0,
      notes: s.notes ?? [], conc: !!conc, rows: [],
      // Prose attached to a NODE rather than the section. `g.notes` alone can no
      // longer answer a coverage question, because the sentences that used to
      // pile up there are now the ones that found their place.
      nodeNotes: nodeNotesOf(s.requirements ?? []),
    });
    for (const s of out.requirementSections ?? []) push(s, false);
    for (const c of out.concentrations?.concentrationOptions ?? []) push(c, true);
  }
}

if (!SECTIONS) for (const file of files) {
  const html = readFileSync(`${CACHE_DIR}/${file}`, 'utf8');
  if (!html.includes('sc_courselist')) continue;
  let root;
  try { root = parseHTML(html); } catch { continue; }
  const page = norm(root.querySelector('h1')?.text) || file;
  const panes = root.querySelectorAll('div[id$="textcontainer"]');
  const scoped = panes.length ? panes : [root];
  for (const pane of scoped) {
    const paneId = pane.getAttribute?.('id') ?? '(page)';
    const notes = notesOf(pane);
    pane.querySelectorAll('table.sc_courselist').forEach((table, ti) => {
      for (const g of groupsOf(table)) {
        records.push({
          page, file, pane: paneId, table: ti,
          section: g.section, hours: g.hours, rows: g.rows,
          codes: g.rows.map(r => r.code).filter(Boolean),
          comments: g.rows.map(r => r.comment).filter(Boolean),
          notes,
        });
      }
    });
  }
}

const pred = WHERE ? new Function('g', `return (${WHERE});`) : () => true;
const matched = records.filter(g => { try { return pred(g); } catch { return false; } });

if (MODE === 'count') {
  const pages = new Set(matched.map(g => g.page));
  console.log(`${matched.length} groups on ${pages.size} pages (of ${records.length} groups, ${new Set(records.map(r => r.page)).size} pages)`);
} else if (MODE === 'tally') {
  const keyFn = new Function('g', `return (${TALLY});`);
  const counts = new Map();
  for (const g of matched) {
    const k = String(keyFn(g));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows = [...counts].sort((a, b) => b[1] - a[1]);
  const total = matched.length;
  for (const [k, n] of rows.slice(0, LIMIT)) {
    console.log(`${String(n).padStart(6)}  ${(100 * n / total).toFixed(1).padStart(5)}%  ${k}`);
  }
  console.log(`${String(total).padStart(6)}  total (${rows.length} distinct)`);
} else if (MODE === 'json') {
  writeFileSync(OUT, JSON.stringify(matched, null, 1));
  console.log(`wrote ${matched.length} groups → ${OUT}`);
} else {
  for (const g of matched.slice(0, LIMIT)) {
    console.log(`\n── ${g.page}  [${g.pane} #${g.table}]\n   § ${g.section}${g.hours ? `  (${g.hours} SH)` : ''}`);
    if (SECTIONS) {
      console.log(`     ${g.reqs} requirement${g.reqs === 1 ? '' : 's'}, min ${g.min}`);
      for (const n of g.notes) console.log(`     note: ${n}`);
    } else {
      for (const r of g.rows) console.log(`     ${r.cls.padEnd(24)} | ${r.code.padEnd(22)} | ${r.title}${r.hours ? `  [${r.hours}]` : ''}`);
    }
  }
  console.log(`\n${matched.length} ${SECTIONS ? 'sections' : 'groups'} matched${matched.length > LIMIT ? ` (showing ${LIMIT}; --limit N for more)` : ''}`);
}

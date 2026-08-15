#!/usr/bin/env node
/**
 * pane-probe.js — what is actually inside a program page's requirement panes?
 *
 * `partitionPanes` includes every `*textcontainer` pane that has tables and
 * merges them into one flat program. That is right when a second pane is a
 * CONTINUATION (more requirements of the same degree) and wrong when it is a
 * VARIANT (the same degree restated for exchange students, advanced entry,
 * an experiential track…), because a variant restates the same headings and
 * the same concentration menu, and the merge turns that into duplicates.
 *
 * Nothing in the emitted bundle records which case a page was, so this asks
 * the pages themselves. For every program it reports the panes, their heading
 * sets, how much those sets overlap, and whether more than one pane carries a
 * concentration menu.
 *
 * Classification is by heading overlap, not by pane id — ids are as varied as
 * everything else in this catalog ("exchangestudents", "advancedentryphd",
 * "lawllmexperiential"), and a word list over them would be the same mistake
 * as classifying concentrations by heading text.
 *
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/pane-probe.js [--limit N]
 *
 * Writes a JSON report to stdout's companion file and prints a summary.
 */
import { readFileSync, writeFileSync } from 'fs';
import { parse as parseHTML } from 'node-html-parser';
import { politeFetch, cacheSummary } from './lib/catalog-cache.js';

const BUNDLE = 'public/northeastern/programs-bundle.json';
const OUT    = '.pane-probe.json';

const argLimit = () => {
  const i = process.argv.indexOf('--limit');
  return i === -1 ? Infinity : Number(process.argv[i + 1]);
};

/** Heading text inside one pane, normalized enough to compare across panes. */
function headingsOf(pane) {
  return pane.querySelectorAll('h1, h2, h3, h4')
    .map(h => h.text.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

/** Does this pane contain a concentration menu — a list of /concentrations/
 *  links or of in-page anchors sitting under a heading? Counts links only, so
 *  a pane that merely mentions the word does not register. */
function concentrationSignals(pane) {
  const links = pane.querySelectorAll('a[href]').map(a => a.getAttribute('href') ?? '');
  return {
    external: links.filter(h => /\/(?:under)?graduate\/[^/]+\/concentrations\//.test(h)).length,
    anchors:  links.filter(h => h.startsWith('#') && h.length > 1).length,
  };
}

/**
 * Credits a pane accounts for, by summing its tables' hours column.
 *
 * This is the arithmetic behind the only non-lexical test that distinguishes
 * the two cases. A CONTINUATION partitions the degree, so its panes SUM to the
 * stated total (PharmD's undergraduate phase + graduate phase). ALTERNATIVES
 * do not — each pane is a whole path on its own, so the sum overshoots badly.
 *
 * Deliberately crude: ranges ("4-8") take the low end and blank cells count
 * zero. It is a discriminator, not a credit authority — parseTotalCredits
 * remains the source for what a degree actually requires.
 */
function paneCredits(pane) {
  let sh = 0;
  for (const td of pane.querySelectorAll('td.hourscol')) {
    const m = td.text.replace(/\s+/g, '').match(/^(\d+(?:\.\d+)?)/);
    if (m) sh += Number(m[1]);
  }
  return sh;
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / (A.size + B.size - hit);
};

const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'));
const targets = bundle.programs
  .filter(p => p.sourceUrl)
  .slice(0, argLimit());

const report = [];
let done = 0;

for (const p of targets) {
  let root;
  try { root = parseHTML(await politeFetch(p.sourceUrl, { delayMs: 600 })); }
  catch (e) { report.push({ id: p.id, error: String(e.message ?? e) }); continue; }

  // Mirror partitionPanes exactly — same selection, so the finding applies to
  // what the scraper really parses rather than to a lookalike.
  const panes = [];
  for (const d of root.querySelectorAll('div[id]')) {
    const id = d.getAttribute('id') ?? '';
    if (!/textcontainer$/.test(id)) continue;
    const tables = d.querySelectorAll('table.sc_courselist').length;
    if (!tables) continue;
    if (/^planofstudy/.test(id)) continue;
    panes.push({ id, tables, headings: headingsOf(d), conc: concentrationSignals(d),
                 sh: paneCredits(d) });
  }

  if (panes.length > 1) {
    // Overlap of each later pane against the first — the first pane is the
    // baseline curriculum on every page examined by hand.
    const overlaps = panes.slice(1).map(x => +jaccard(panes[0].headings, x.headings).toFixed(3));
    const concPanes = panes.filter(x => x.conc.external > 0 || x.conc.anchors > 0).length;
    report.push({
      id: p.id, url: p.sourceUrl,
      panes: panes.map(x => ({ id: x.id, tables: x.tables, headings: x.headings.length,
                               sh: x.sh, ...x.conc })),
      overlaps, maxOverlap: Math.max(...overlaps), concPanes,
      statedTotal: p.totalCreditsRequired ?? null,
      sumSh: panes.reduce((n, x) => n + x.sh, 0),
      maxPaneSh: Math.max(...panes.map(x => x.sh)),
    });
  } else {
    report.push({ id: p.id, panes: panes.length, single: true });
  }

  if (++done % 100 === 0) process.stderr.write(`  ${done}/${targets.length}\n`);
}

writeFileSync(OUT, JSON.stringify(report, null, 1));

const multi = report.filter(r => !r.single && !r.error);
const bucket = (lo, hi) => multi.filter(r => r.maxOverlap >= lo && r.maxOverlap < hi).length;
console.log(`programs probed        ${report.length}`);
console.log(`  errors               ${report.filter(r => r.error).length}`);
console.log(`  single pane          ${report.filter(r => r.single).length}`);
console.log(`  multi-pane           ${multi.length}`);
console.log(`    overlap 0          ${bucket(0, 0.001)}   (disjoint — continuation)`);
console.log(`    overlap 0-0.3      ${bucket(0.001, 0.3)}`);
console.log(`    overlap 0.3-0.7    ${bucket(0.3, 0.7)}`);
console.log(`    overlap 0.7-1.0    ${bucket(0.7, 1.001)}   (near-identical — variant)`);
console.log(`  >1 pane w/ conc menu ${multi.filter(r => r.concPanes > 1).length}`);
console.log(cacheSummary());
console.log(`report → ${OUT}`);

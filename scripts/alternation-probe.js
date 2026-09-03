#!/usr/bin/env node
/**
 * alternation-probe.js — can the MARKUP tell an alternative track from a
 * cross-count, now that the Sample Plan of Study is going away?
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * `shared: true` carries two populations that need opposite treatment:
 *
 *   · a genuine CROSS-COUNT ("Integrative Courses") — nothing else names its
 *     courses, so it must be scheduled or the requirement is deleted;
 *   · an ALTERNATIVE TRACK ("Taxation Track", "Thesis Option") — the branch the
 *     student did not take, which must not be scheduled or every master's
 *     student is forced into a thesis.
 *
 * Shape cannot separate them; `src/engine/demand.js` measured that and says so.
 * The only discriminator is the Sample Plan of Study: an alternative is a
 * branch the plan did not take, so it names none of the section's courses.
 *
 * On 2026-09-02 that discriminator started disappearing. NEU moved the plans
 * out of the central catalog onto individual college pages, and the 2027
 * edition publishes none: 349 committed for 2026, 0 parsed. With no witness
 * `witnessedSharedNodes` returns nothing for every shared section, so the ~26
 * genuine cross-counts silently stop being scheduled — under-requiring, the
 * direction CLAUDE.md calls unrecoverable.
 *
 * Both `shared-sections.js` and `docs/chart-open-defects.md` already name the
 * durable fix: teach the parser that two panes are ALTERNATIVES, so a track
 * becomes a choice rather than a section hidden to stop being double-charged.
 * That only works if the alternation is actually stated in the markup. Accounting
 * MSA suggests it is —
 *
 *     … Financial Reporting … Tracks  Complete one of the following tracks:
 *       Audit Track  Course List …
 *
 * — but one page is an anecdote. This measures the whole population before
 * anybody designs a parser change, which is the order this repository works in.
 *
 * ── What it does NOT do ─────────────────────────────────────────────
 *
 * It does not classify anything and nothing consumes its output. It reports the
 * instruction text found above each shared section, against the verdict the
 * WITNESS gives today, while we still have the plans to ask. That cross-tab is
 * the evidence a design needs: a signal that fires on the alternatives and
 * stays quiet on the cross-counts is a replacement; anything else is not.
 *
 * Usage:
 *   node scripts/alternation-probe.js                 # both trees
 *   node scripts/alternation-probe.js --tree graduate
 *   node scripts/alternation-probe.js --limit 20      # a quick look
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/alternation-probe.js
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import { politeFetch } from './lib/catalog-cache.js';
import { keysNamedElsewhere, witnessedSharedNodes } from '../src/engine/demand.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const TREES = arg('--tree') ? [arg('--tree')] : ['undergraduate', 'graduate'];
const LIMIT = Number(arg('--limit', Infinity));
const YEAR = arg('--year', '2026');

/** "Complete one of the following …" and the ways CourseLeaf phrases it. */
const ALTERNATION = /\b(complete|select|choose)\b[^.]{0,40}\bone\b[^.]{0,40}\b(of the following|option|track|concentration|pathway|route)/i;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === 'requirements.json') out.push(p);
  }
  return out;
}

/**
 * Rows of every requirement table on the page, in document order, each tagged
 * as a section HEADING, a free-text INSTRUCTION, or neither.
 */
// A trailing `\b` looks right here and is wrong: a row's text runs the code
// straight into the title — "ARTD 2371Animation Basics and Animation Tools5" —
// so there is no word boundary after the digits and the code is skipped. It cost
// two thirds of the matches before anyone looked at what was being extracted.
// `(?!\d)` is the assertion actually wanted: four digits, not five.
const CODE = /\b([A-Z]{2,5})\s*(\d{4})(?!\d)/g;

/** Course codes in a row — from CourseLeaf's own link markup where it exists. */
function codesIn(tr) {
  const linked = tr.querySelectorAll('a.bubblelink, span.bubblelink')
    .map(a => a.text.replace(/\s+/g, ' ').trim())
    .filter(t => /^[A-Z]{2,5} \d{4}$/.test(t));
  if (linked.length) return linked;
  return [...tr.text.matchAll(CODE)].map(m => `${m[1]} ${m[2]}`);
}

function tableRows(pageRoot) {
  const rows = [];
  for (const table of pageRoot.querySelectorAll('table.sc_courselist')) {
    for (const tr of table.querySelectorAll('tr')) {
      const wide = tr.querySelector('td[colspan="2"]');
      const span = wide?.querySelector('span.courselistcomment, span.areaheader');
      if (!span) { rows.push({ kind: "course", codes: codesIn(tr) }); continue; }
      const cls = span.getAttribute('class') ?? '';
      const text = span.text.replace(/\s+/g, ' ').trim();
      rows.push({ kind: cls.includes('areaheader') ? 'heading' : 'instruction', text, codes: [] });
    }
  }
  return rows;
}

/** Course codes named anywhere inside a parsed requirement section. */
function sectionCodes(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => sectionCodes(n, out)); return out; }
  if (node.type === 'COURSE' && node.subject) out.add(`${node.subject} ${node.classId}`);
  for (const v of Object.values(node)) if (v && typeof v === 'object') sectionCodes(v, out);
  return out;
}

/**
 * Find the heading that owns a section, by the COURSES under it rather than by
 * its title.
 *
 * Titles are the obvious key and the wrong one: NEU renamed a whole family of
 * these in the 2027 roll ("Integrative Requirement" → "Integrative Requirement
 * Courses"), and `uniquify` may have appended a ` (2)` that the catalog never
 * had. Both make a title lookup miss a section that is plainly still there.
 * Courses survive a rename, so they are what is matched on; the title is only
 * the tie-breaker.
 */
function locateHeading(rows, section) {
  const want = sectionCodes(section);
  const headings = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'heading') continue;
    const owned = new Set();
    for (let j = i + 1; j < rows.length && rows[j].kind !== 'heading'; j++) {
      rows[j].codes?.forEach(c => owned.add(c));
    }
    headings.push({ index: i, text: rows[i].text, owned });
  }
  if (!headings.length) return null;

  let best = null;
  for (const h of headings) {
    const hit = [...want].filter(c => h.owned.has(c)).length;
    const share = want.size ? hit / want.size : 0;
    const titled = norm(h.text) === norm(section.title) ? 1 : 0;
    const score = share + titled * 0.5;
    if (!best || score > best.score) best = { ...h, score, share, titled };
  }
  // Enough of the section's courses under it to be the same section, or an
  // exact title with nothing to compare (a prose section naming no course).
  if (best.share >= 0.5 || (best.titled && want.size === 0)) return best;
  return null;
}

/**
 * The instruction governing a heading: the nearest instruction row above it,
 * allowed to sit above a RUN of sibling headings (the Accounting MSA shape,
 * where "Complete one of the following tracks:" precedes `Audit Track` and the
 * shared `Taxation Track` comes after it).
 *
 * `headingsCrossed` is reported rather than capped, because how far these
 * instructions really sit from their sections is one of the things being
 * measured. A rule that guesses the distance is exactly what this is for.
 */
function governingInstruction(rows, index) {
  let headingsCrossed = 0;
  for (let i = index - 1; i >= 0; i--) {
    // Bounded. An unbounded walk-back finds SOME comment on almost every page —
    // on the first run it was reporting a footnote about ARTG 5000 four sections
    // away as though it governed the heading. A rule that always finds something
    // measures nothing.
    if (index - i > 60 || headingsCrossed > 2) return null;
    if (rows[i].kind === 'heading') { headingsCrossed++; continue; }
    if (rows[i].kind === 'instruction') {
      return { text: rows[i].text, headingsCrossed, distance: index - i };
    }
  }
  return null;
}

/**
 * Titles are compared loosely, and the reason is worth stating.
 *
 * The labels come from the committed 2026 records — the only place that edition
 * survives, because NEU's archive currently stops at 2024-2025 and the live site
 * has rolled to 2027. So this matches 2026 section titles against 2027 markup,
 * and every section NEU renamed in the roll drops out of the sample. That costs
 * coverage, not correctness: a heading whose title still matches is the same
 * section. The count that did not match is reported rather than hidden.
 *
 * ` (2)` is stripped because it is ours, not the catalog's — `uniquify` adds it
 * when a page carries two sections of the same name. That also means such a
 * title can match the wrong twin, so they are counted separately.
 */
const DISAMBIGUATED = / \(\d+\)$/;
const norm = s => (s ?? '').replace(DISAMBIGUATED, '').replace(/\s+/g, ' ').trim().toLowerCase();

async function main() {
  const files = TREES.flatMap(t => walk(join(ROOT, `data/northeastern/programs/${t}/${YEAR}`)));
  const targets = [];
  for (const file of files) {
    let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }
    const sections = j.requirementSections ?? [];
    const shared = sections.filter(s => s?.shared);
    if (!shared.length) continue;
    const witness = new Set(j.metadata?.planOfStudyCourses ?? []);
    const elsewhere = keysNamedElsewhere(sections);
    for (const s of shared) {
      targets.push({
        name: j.name, url: j.metadata?.sourceUrl, title: s.title, section: s,
        hasPlan: witness.size > 0,
        // The verdict the engine gives TODAY. `emits` means the plan witnesses
        // the section, i.e. a genuine cross-count.
        emits: witnessedSharedNodes(s, elsewhere, witness).length > 0,
      });
    }
  }

  const byUrl = new Map();
  for (const t of targets) {
    if (!t.url) continue;
    if (!byUrl.has(t.url)) byUrl.set(t.url, []);
    byUrl.get(t.url).push(t);
  }
  const urls = [...byUrl.keys()].slice(0, LIMIT);
  console.log(`${targets.length} shared sections across ${byUrl.size} pages `
    + `(${YEAR}, ${TREES.join(' + ')}); fetching ${urls.length}\n`);

  const results = [];
  for (const [n, url] of urls.entries()) {
    process.stdout.write(`  [${n + 1}/${urls.length}] ${url.slice(0, 92)} … `);
    let rows;
    try {
      rows = tableRows(parse(await politeFetch(url)));
    } catch (e) {
      console.log(`FETCH FAILED (${e.message})`);
      continue;
    }
    for (const t of byUrl.get(url)) {
      const hit = locateHeading(rows, t.section);
      const gov = hit ? governingInstruction(rows, hit.index) : null;
      results.push({
        ...t,
        ambiguous: DISAMBIGUATED.test(t.title),
        headingFound: !!hit,
        instruction: gov?.text ?? null,
        headingsCrossed: gov?.headingsCrossed ?? null,
        distance: gov?.distance ?? null,
        alternation: !!(gov && ALTERNATION.test(gov.text)),
        // The strict reading: the instruction sits directly above this heading,
        // governing it alone rather than a run of siblings.
        alternationAdjacent: !!(gov && gov.headingsCrossed === 0 && ALTERNATION.test(gov.text)),
      });
    }
    console.log('ok');
  }

  // ── The cross-tab that decides whether a parser rule is possible ──
  const seen = results.filter(r => r.headingFound);
  const cross = seen.filter(r => r.emits);                 // witness says CROSS-COUNT
  const alt = seen.filter(r => !r.emits && r.hasPlan);     // witness says ALTERNATIVE
  const mute = seen.filter(r => !r.hasPlan);               // no plan: witness cannot speak
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');

  console.log(`\n─────────── heading located for ${seen.length} of ${results.length} shared sections\n`);
  const line = (label, rows, note) => {
    const loose = rows.filter(r => r.alternation).length;
    const strict = rows.filter(r => r.alternationAdjacent).length;
    console.log(`  ${label.padEnd(26)} ${String(rows.length).padStart(3)}  `
      + `→ alternation instruction: ${String(loose).padStart(3)} (${pct(loose, rows.length)}) loose, `
      + `${String(strict).padStart(3)} (${pct(strict, rows.length)}) directly above   ${note}`);
  };
  line('witness says CROSS-COUNT', cross, '— should be LOW');
  line('witness says ALTERNATIVE', alt, '— should be HIGH');
  line('witness CANNOT SPEAK', mute, '— the population the fix must cover');

  const show = (label, rows) => {
    if (!rows.length) return;
    console.log(`\n${label}`);
    for (const r of rows.slice(0, 25)) {
      console.log(`   ${r.name} :: ${r.title}`);
      console.log(`      ${r.instruction ? JSON.stringify(r.instruction.slice(0, 96)) : '(no instruction above it)'}`
        + (r.headingsCrossed ? `  [${r.headingsCrossed} heading(s) above]` : ''));
    }
    if (rows.length > 25) console.log(`   …and ${rows.length - 25} more`);
  };
  show('FALSE POSITIVES — cross-counts that look like alternatives:', cross.filter(r => r.alternation));
  show('MISSES — alternatives with no alternation instruction:', alt.filter(r => !r.alternation));
  show('Alternatives the instruction DOES catch:', alt.filter(r => r.alternation));

  const notFound = results.filter(r => !r.headingFound);
  if (notFound.length) {
    console.log(`\n⚠  ${notFound.length} shared section(s) had no matching heading in the live markup — `
      + `renamed upstream, or nested somewhere this probe does not look:`);
    for (const r of notFound.slice(0, 12)) console.log(`   ${r.name} :: ${r.title}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

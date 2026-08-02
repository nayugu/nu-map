#!/usr/bin/env node
/**
 * scrape-majors.js
 *
 * Scrapes undergraduate degree requirements from catalog.northeastern.edu
 * and outputs parsed.initial.json files in the Major2 schema used by
 * the graduation requirement panel.
 *
 * This is a ground-up replacement for the stale external/graduatenu data.
 * ~45% of combined/joint major programs were missing writing requirements
 * and other sections because the old graduatenu scraper was removed in 2023.
 *
 * Output: src/data/majors/{year}/{college}/{slug}/parsed.initial.json
 *
 * Usage:
 *   node scripts/scrape-majors.js               # preview (no writes)
 *   node scripts/scrape-majors.js --write        # write output files
 *   node scripts/scrape-majors.js --dry-run      # first 5 programs, no write
 *   node scripts/scrape-majors.js --url <url>    # single program URL
 *   node scripts/scrape-majors.js --year 2025    # override catalog year tag
 *
 * Rate limit: 600 ms between requests by default.
 * Override: MAJORS_DELAY_MS=300 node scripts/scrape-majors.js
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { parse as parseHTML }       from 'node-html-parser';
import { markSharedSections }       from './lib/major-integrity.js';
import { politeFetch, cacheSummary } from './lib/catalog-cache.js';
import { parseSitemapPrograms }      from './lib/catalog-programs.js';
import { checkScrapeRails }          from './lib/scrape-rails.js';
import { parseRequirements, parseTotalCredits, findLeakedMarkers,
         extractPlanOfStudyCourses,
         normalizeConcentrationHref,
         UNDERGRAD_PROFILE as PROFILE } from './lib/catalog-program-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_ROOT    = join(ROOT, 'src/data/majors');
const CHANGE_LOG  = join(ROOT, 'public/northeastern/change-log.json');
const CHANGE_LOG_MAX = 600;
const BASE      = 'https://catalog.northeastern.edu';
// /azindex/ is Disallow'd in the catalog's robots.txt; the sitemap is not.
const SITEMAP_URL = `${BASE}/sitemap.xml`;
const DELAY_MS  = parseInt(process.env.MAJORS_DELAY_MS ?? '600', 10);
const YEAR      = parseInt(process.env.MAJORS_YEAR ?? String(new Date().getFullYear()), 10);

const WRITE   = process.argv.includes('--write');
const DRY_RUN = process.argv.includes('--dry-run');
const URL_ARG = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : null; })();

// ── Utilities ─────────────────────────────────────────────────────────────────

// Every request goes through politeFetch, which owns the rate limit globally —
// so extra fetches inside a program (concentration pages) can't outpace the
// configured delay. Set CATALOG_HTML_CACHE to reuse pages across local runs.
const fetchPage = url => politeFetch(url, { delayMs: DELAY_MS });

/** "Computer Science, BSCS (Boston)" → "computer_science_bscs_(boston)" */
function slugify(str) {
  return str.toLowerCase()
    .replace(/[,]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_()\-]/g, '')
    .replace(/_+/g, '_')
    .trim();
}

// ── Program list ──────────────────────────────────────────────────────────────

async function fetchProgramUrls() {
  console.log('Fetching sitemap…');
  const xml = await fetchPage(SITEMAP_URL);
  const programs = parseSitemapPrograms(xml, { pathPrefix: '/undergraduate/', minSegments: 3 });
  console.log(`Found ${programs.length} program URLs`);
  return programs;
}

// ── Credit helpers ────────────────────────────────────────────────────────────

// ── Course link parsing ───────────────────────────────────────────────────────

// ── Range text parser ─────────────────────────────────────────────────────────

// ── Row group parser ──────────────────────────────────────────────────────────

// ── Table parser ──────────────────────────────────────────────────────────────

// ── Full page parser ──────────────────────────────────────────────────────────

// ── Requirements region ───────────────────────────────────────────────────────
//
// Every table.sc_courselist lives in the Program Requirements tab pane
// (verified across the catalog). Program pages use
// #programrequirementstextcontainer; standalone concentration pages use
// #concentrationrequirementstextcontainer — hence the suffix match rather than
// a literal id. Scoping here keeps page chrome (the Print Options dialog, the
// edition sidebar) and the Plan of Study pane out of the walk.
// ── Validate no internal markers escape into output ───────────────────────────
// ── Output path ───────────────────────────────────────────────────────────────

function outPath(college, slug) {
  return join(OUT_ROOT, String(YEAR), college, slug, 'parsed.initial.json');
}

// ── Scrape one program ────────────────────────────────────────────────────────

/**
 * Parse a page, then resolve any concentrations that live on their own pages.
 *
 * Business programs list ~17 concentrations as links rather than inline
 * tables. Those pages were already being fetched every run and thrown away as
 * "no requirements found", so resolving them costs no extra requests once the
 * page cache is warm. Only /concentrations/ paths are followed, and the count
 * is capped, so a markup change can't turn the scraper into a crawler.
 */
const MAX_EXTERNAL_CONCENTRATIONS = 40;

async function parseRequirementsResolvingExternals(root) {
  const first = parseRequirements(root, PROFILE);
  const pending = (first.pendingExternal ?? []).slice(0, MAX_EXTERNAL_CONCENTRATIONS);
  if (!pending.length) return first;

  const resolved = new Map();
  for (const link of pending) {
    const url = normalizeConcentrationHref(link.href);
    if (!url) continue;
    try { resolved.set(url, parseHTML(await fetchPage(url))); }
    catch { /* a missing concentration page must not fail the program */ }
  }
  return parseRequirements(root, PROFILE, { resolveExternal: u => resolved.get(u) ?? null });
}

async function scrapeProgram(url) {
  const html = await fetchPage(url);
  const root = parseHTML(html);

  const name = root.querySelector('#page-title h1, h1.page-title, h1')
    ?.text?.trim()
    ?.replace(/\s+/g, ' ')
    ?? '';

  const { value: totalCreditsRequired, source: totalCreditsSource } = parseTotalCredits(root, PROFILE);
  const { requirementSections, concentrations, generalElectiveSH,
          tablesPresent, tablesConsumed, tablesOnPage, tablesExcluded,
          unconsumedHeadings } = await parseRequirementsResolvingExternals(root);

  // A program can be entirely concentrations: Philosophy BA's whole major is
  // five mutually-exclusive options and has no base requirement section.
  // Dropping it for having no sections lost the program altogether.
  if (!requirementSections.length && !concentrations) return null;

  const data = {
    name,
    metadata:  {
      verified: false,
      lastEdited: new Date().toLocaleDateString('en-US'),
      branch: 'main',
      // Parse coverage — how many requirement tables the page offered vs how
      // many we actually turned into requirements. Any gap means content was
      // dropped on the floor; scripts/verify-majors.js gates on it.
      tablesPresent,
      tablesConsumed,
      tablesOnPage,
      tablesExcluded,
      ...(unconsumedHeadings?.length ? { unconsumedHeadings } : {}),
      // Courses the department's own sample plan names. A one-directional
      // witness: anything here that matches no requirement means we dropped
      // something. Never the reverse — the plan picks one branch per choice.
      planOfStudyCourses: extractPlanOfStudyCourses(root),
    },
    totalCreditsRequired,
    // Which phrasing produced the number — 'stated-total' and friends come
    // from what the page says is required; 'plan-grid' means we fell back to
    // the sample plan and the value may exceed the true minimum.
    ...(totalCreditsSource ? { totalCreditsSource } : {}),
    yearVersion: YEAR,
    requirementSections,
    ...(concentrations ? { concentrations } : {}),
    ...(generalElectiveSH > 0 ? { generalElectiveSH } : {}),
  };

  // Mark cross-count sections (integrative / GPA re-lists / shared credit) that would
  // otherwise be impossible to satisfy under single-use allocation. See lib/major-integrity.js.
  markSharedSections(data);

  return data;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/** Every committed program file in this tree, so the rails can see removals. */
function listCommittedPrograms() {
  const out = [];
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === 'parsed.initial.json') out.push(p);
    }
  };
  walk(OUT_ROOT);
  return out;
}

async function main() {
  let programs;

  if (URL_ARG) {
    const parts = URL_ARG.replace(BASE, '').replace(/^\/|\/$/g, '').split('/');
    programs = [{ url: URL_ARG, college: parts[1] ?? 'unknown', name: '' }];
  } else {
    programs = await fetchProgramUrls();
    if (DRY_RUN) {
      programs = programs.slice(0, 5);
      console.log('Dry-run: processing first 5 programs only');
    }
  }

  let done = 0, skipped = 0, failed = 0, written = 0;
  // Buffered, not written as we go: the rails below need to see the whole run
  // before any of it lands. Writing per-program meant a broken parse was
  // already committed by the time anyone looked at the log.
  const pending = new Map();   // outPath → parsed program

  for (const prog of programs) {
    process.stdout.write(`  ${prog.url} … `);
    try {
      const data = await scrapeProgram(prog.url);

      if (!data) {
        console.log('SKIP (no requirements found)');
        skipped++;
      } else {
        const slug = slugify(data.name || prog.college);
        const path = outPath(prog.college, slug);
        const concCount = data.concentrations?.concentrationOptions?.length ?? 0;
        const { tablesPresent: tp, tablesConsumed: tc } = data.metadata;
        const gap = tp > tc ? `  ⚠ DROPPED ${tp - tc}/${tp} tables` : '';
        console.log(`OK  "${data.name}" — ${data.requirementSections.length} sections${concCount ? ` + ${concCount} concentrations` : ''}, ${data.totalCreditsRequired} SH${gap}`);

        const leaks = findLeakedMarkers(data);
        if (leaks.length) {
          console.warn(`  ⚠  _CHOOSE markers not converted at: ${leaks.join(', ')}`);
        }

        // metadata.verification is deliberately NOT carried over from the
        // previous file. The requirements just changed, so an old verdict
        // would be a stale claim — worse than no claim. verify-majors.js
        // recomputes it immediately after the scrape; both workflows run it
        // in that order.
        pending.set(path, data);
        done++;
      }
    } catch (err) {
      console.log(`FAIL  ${err.message}`);
      failed++;
    }

    // No sleep here — politeFetch owns the rate limit globally, so it also
    // applies to the extra requests a single program can make. Sleeping again
    // would double the gap, and would make a fully-cached run needlessly slow.
  }

  // ── Write rails ────────────────────────────────────────────────────────
  // Compare the whole run against what is committed before letting any of it
  // land. A single program regressing is drift; a fleet regressing is upstream
  // breakage, and this job pushes straight to main unattended.
  if (WRITE && !URL_ARG && !DRY_RUN) {
    const previous = new Map();
    for (const p of pending.keys()) {
      if (existsSync(p)) { try { previous.set(p, JSON.parse(readFileSync(p, 'utf8'))); } catch {} }
    }
    for (const p of listCommittedPrograms()) {
      if (!previous.has(p)) { try { previous.set(p, JSON.parse(readFileSync(p, 'utf8'))); } catch {} }
    }
    const { ok, failures, stats } = checkScrapeRails({
      discovered: programs.length, failed, results: pending, previous,
    });
    console.log(`\nRails: ${stats.nowCount} parsed vs ${stats.prevCount} committed, ` +
                `${stats.nowSections} sections vs ${stats.prevSections}, ${stats.vanished} vanished.`);
    if (!ok) {
      console.error(`\n❌  Refusing to write — this run looks like upstream breakage:\n`);
      for (const f of failures) console.error(`   • ${f}`);
      console.error(`\n    Nothing was written. Inspect the catalog markup before re-running.\n`);
      process.exit(1);
    }
  }

  if (WRITE) {
    for (const [p, data] of pending) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(data, null, 2));
      written++;
    }
  }

  console.log(`\nResults: ${done} scraped, ${written} written, ${skipped} skipped, ${failed} failed`);
  if (!WRITE && !DRY_RUN && done > 0) console.log('Run with --write to save output files.');

  if (WRITE) {
    let changeLog = { runs: [] };
    if (existsSync(CHANGE_LOG)) {
      try { changeLog = JSON.parse(readFileSync(CHANGE_LOG, 'utf8')); } catch {}
    }
    changeLog.runs = changeLog.runs ?? [];
    changeLog.runs.unshift({
      type:      'majors',
      subject:   '🎓 Major Requirements',
      timestamp: new Date().toISOString(),
      done, written, skipped, failed,
    });
    if (changeLog.runs.length > CHANGE_LOG_MAX) changeLog.runs = changeLog.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(changeLog, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${CHANGE_LOG}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

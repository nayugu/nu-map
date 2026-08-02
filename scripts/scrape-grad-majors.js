#!/usr/bin/env node
/**
 * scrape-grad-majors.js
 *
 * Scrapes graduate (master's) program requirements from catalog.northeastern.edu
 * and outputs parsed.initial.json files in the Major2 schema used by
 * the graduation requirement panel.
 *
 * Uses the same HTML parsing logic as scrape-majors.js (undergrad), since
 * catalog.northeastern.edu renders graduate pages with the same structure.
 * Key differences: targets /graduate/ paths, lower credit minimum (20 vs 60),
 * and writes to src/data/grad-majors/ instead of src/data/majors/.
 *
 * Output: src/data/grad-majors/{year}/{college}/{slug}/parsed.initial.json
 *
 * Usage:
 *   node scripts/scrape-grad-majors.js               # preview (no writes)
 *   node scripts/scrape-grad-majors.js --write        # write output files
 *   node scripts/scrape-grad-majors.js --dry-run      # first 5 programs, no write
 *   node scripts/scrape-grad-majors.js --url <url>    # single program URL
 *   node scripts/scrape-grad-majors.js --year 2025    # override catalog year tag
 *
 * Rate limit: 600 ms between requests by default.
 * Override: GRAD_DELAY_MS=300 node scripts/scrape-grad-majors.js
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname }            from 'path';
import { fileURLToPath }            from 'url';
import { parse as parseHTML }       from 'node-html-parser';
import { markSharedSections }       from './lib/major-integrity.js';
import { politeFetch, cacheSummary } from './lib/catalog-cache.js';
import { parseSitemapPrograms }      from './lib/catalog-programs.js';
import { parseRequirements, parseTotalCredits, findLeakedMarkers,
         normalizeConcentrationHref,
         GRAD_PROFILE as PROFILE } from './lib/catalog-program-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_ROOT  = join(ROOT, 'src/data/grad-majors');
const CHANGE_LOG     = join(ROOT, 'public/northeastern/change-log.json');
const CHANGE_LOG_MAX = 600;
const BASE      = 'https://catalog.northeastern.edu';
// /azindex/ is Disallow'd in the catalog's robots.txt; the sitemap is not.
const SITEMAP_URL = `${BASE}/sitemap.xml`;
const DELAY_MS  = parseInt(process.env.GRAD_DELAY_MS ?? '600', 10);
const YEAR      = parseInt(process.env.GRAD_YEAR ?? String(new Date().getFullYear()), 10);

const WRITE   = process.argv.includes('--write');
const DRY_RUN = process.argv.includes('--dry-run');
const URL_ARG = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : null; })();

// ── Utilities ─────────────────────────────────────────────────────────────────

// Every request goes through politeFetch, which owns the rate limit globally —
// so extra fetches inside a program (concentration pages) can't outpace the
// configured delay. Set CATALOG_HTML_CACHE to reuse pages across local runs.
const fetchPage = url => politeFetch(url, { delayMs: DELAY_MS });

/** "Computer Science, MS" → "computer_science_ms" */
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
  const programs = parseSitemapPrograms(xml, { pathPrefix: '/graduate/', minSegments: 3 });
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
          tablesPresent, tablesConsumed } = await parseRequirementsResolvingExternals(root);

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

        if (WRITE) {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, JSON.stringify(data, null, 2));
          written++;
        }
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

  console.log(`\nResults: ${done} scraped, ${written} written, ${skipped} skipped, ${failed} failed`);
  if (!WRITE && !DRY_RUN && done > 0) console.log('Run with --write to save output files.');

  if (WRITE) {
    let changeLog = { runs: [] };
    if (existsSync(CHANGE_LOG)) {
      try { changeLog = JSON.parse(readFileSync(CHANGE_LOG, 'utf8')); } catch {}
    }
    changeLog.runs = changeLog.runs ?? [];
    changeLog.runs.unshift({
      type:      'grad-majors',
      subject:   '🎓 Graduate Program Requirements',
      timestamp: new Date().toISOString(),
      done, written, skipped, failed,
    });
    if (changeLog.runs.length > CHANGE_LOG_MAX) changeLog.runs = changeLog.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(changeLog, null, 2) + '\n', 'utf8');
    console.log(`Wrote ${CHANGE_LOG}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });

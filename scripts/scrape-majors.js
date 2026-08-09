#!/usr/bin/env node
/**
 * scrape-majors.js
 *
 * Scrapes undergraduate degree requirements from catalog.northeastern.edu
 * and outputs requirements.json files in the Major2 schema used by
 * the graduation requirement panel.
 *
 * This is a ground-up replacement for the stale external/graduatenu data.
 * ~45% of combined/joint major programs were missing writing requirements
 * and other sections because the old graduatenu scraper was removed in 2023.
 *
 * Output: data/northeastern/programs/undergraduate/{year}/{college}/{slug}/requirements.json
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

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname, sep }       from 'path';
import { fileURLToPath }            from 'url';
import { parse as parseHTML }       from 'node-html-parser';
import { markSharedSections }       from './lib/major-integrity.js';
import { politeFetch, cacheSummary } from './lib/catalog-cache.js';
import { parseSitemapPrograms }      from './lib/catalog-programs.js';
import { checkScrapeRails, checkPlanRail } from './lib/scrape-rails.js';
import { extractPlanGrid, verifyPlanGrid, planGridCourseKeys } from './lib/plan-grid.js';
import { parseEditionArg, editionBasePath, assertEdition,
         isFatalScrapeError }        from './lib/catalog-edition.js';
import { parseRequirements, parseTotalCredits, findLeakedMarkers,
         extractPlanOfStudyCourses,
         normalizeConcentrationHref, parseCatalogEdition,
         UNDERGRAD_PROFILE as PROFILE } from './lib/catalog-program-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_ROOT    = join(ROOT, 'data/northeastern/programs/undergraduate');
const CHANGE_LOG  = join(ROOT, 'public/northeastern/change-log.json');
const CHANGE_LOG_MAX = 600;
const ARCHIVE_ROOT = join(ROOT, 'data/northeastern/programs/archive/undergraduate');
// One index across every archived edition, written by BOTH scrapers under
// their own key. It is what tells a reader (and later the loader) which
// editions exist without opening ~12 MB of bundles to find out, and it is
// the at-a-glance health check across a dozen unattended backfill runs.
const ARCHIVE_MANIFEST = join(ROOT, 'data/northeastern/programs/archive/manifest.json');
const TREE = 'undergraduate';
const CATALOG   = 'https://catalog.northeastern.edu';
// A past edition is the same catalog nested under /archive/{label}/, with its
// own sitemap and the same markup. See scripts/lib/catalog-edition.js.
const EDITION   = parseEditionArg(process.argv);
const BASE_PATH = editionBasePath(EDITION);
const BASE      = CATALOG + BASE_PATH;
// /azindex/ is Disallow'd in the catalog's robots.txt; the sitemap is not.
const SITEMAP_URL = `${BASE}/sitemap.xml`;
const DELAY_MS  = parseInt(process.env.MAJORS_DELAY_MS ?? '600', 10);
// The catalog EDITION year, resolved from the first page fetched (see
// parseCatalogEdition) — never the system clock. The clock is wrong in
// both directions: a January run would invent a phantom year, and a run
// after NEU rolls the edition would overwrite the previous year's frozen
// snapshot, destroying the requirements older cohorts follow. The env var
// still forces it for backfills; the clock is only a last resort.
const YEAR_OVERRIDE = process.env.MAJORS_YEAR ? parseInt(process.env.MAJORS_YEAR, 10) : null;
let YEAR = EDITION?.year ?? YEAR_OVERRIDE ?? new Date().getFullYear();
let YEAR_RESOLVED = EDITION != null || YEAR_OVERRIDE != null;

/**
 * Live: latch the edition year from the first page, once, before any write.
 * Archive: the flag is the authority and EVERY page is checked against it —
 * see catalog-edition.js for why a mismatch aborts rather than skips.
 */
function resolveYearFrom(root, url) {
  if (EDITION) { assertEdition(parseCatalogEdition(root), EDITION, url); return; }
  if (YEAR_RESOLVED) return;
  const y = parseCatalogEdition(root);
  if (y != null) {
    if (y !== YEAR) console.log(`  Catalog edition: ${y} (clock said ${YEAR}) — writing to ${y}/`);
    YEAR = y;
  } else {
    console.warn(`  ⚠  No edition label found; falling back to ${YEAR}/`);
  }
  YEAR_RESOLVED = true;
}

const WRITE   = process.argv.includes('--write');
const DRY_RUN = process.argv.includes('--dry-run');
const URL_ARG = (() => { const i = process.argv.indexOf('--url'); return i >= 0 ? process.argv[i + 1] : null; })();

/**
 * Reject anything unrecognised instead of ignoring it.
 *
 * A bare URL used to be accepted silently and then discarded, so
 * `node scripts/scrape-majors.js <url>` fetched the sitemap and walked all 658
 * program pages while looking like a single-page run. For a script that hits a
 * university's catalog that is a footgun worth removing: an argument nobody
 * reads is a request nobody meant to make.
 */
(() => {
  // Flags that take a value are listed separately so their argument is not
  // itself mistaken for an unrecognised one.
  const flags = new Set(['--write', '--dry-run']);
  const valued = new Set(['--url', '--edition']);
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a, i) => a.startsWith('--')
    ? !flags.has(a) && !valued.has(a)
    : !valued.has(argv[i - 1]));
  if (unknown.length) {
    console.error(`Unrecognised argument: ${unknown.join(' ')}`);
    console.error('Usage: [--url <program-url>] [--edition YYYY-YYYY] [--dry-run] [--write]');
    process.exit(2);
  }
})();

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
  const programs = parseSitemapPrograms(xml, { pathPrefix: '/undergraduate/', minSegments: 3, urlBase: EDITION ? BASE : '' });
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
  return join(OUT_ROOT, String(YEAR), college, slug, 'requirements.json');
}

/**
 * The department's Sample Plan of Study, as a SIBLING file rather than a key
 * inside requirements.json.
 *
 * Two reasons, both about not making everyone pay for one feature. The grid is
 * 3-18 KB against a ~14 KB program file, so inlining it would roughly double
 * what every student downloads when they pick a major — to carry something
 * only the ones who ask for a sample plan will ever open. And keeping it out
 * leaves the requirement tree exactly the shape verify-majors, the equivalence
 * builder and the integrity check already walk.
 *
 * It sits in the same directory as the program it belongs to, so the existing
 * year/college/folder path scheme addresses it with no new mapping: the loader
 * globs the same tree for a different filename.
 */
function planPath(college, slug) {
  return join(OUT_ROOT, String(YEAR), college, slug, 'plan.json');
}

/**
 * Where a FROZEN past edition is stored: one bundle per college, not one file
 * per program.
 *
 * Two constraints decide this, and they point the same way. Cloudflare Pages
 * caps a deployment at 20,000 files and dist/ already holds ~15.4k, so seven
 * archive editions at ~1,000 programs each would blow the cap outright. And
 * the live tree is addressed by `import.meta.glob('../../data/northeastern/programs/undergraduate/**\/requirements.json')`
 * — dropping archive programs into it would triple the program picker and
 * break the cohort dedupe, which is a UI regression for every student in
 * exchange for a feature only past cohorts need.
 *
 * A separate root with a coarser grain makes both impossible rather than
 * merely unlikely: ~13 files per edition, and no glob overlap to reason about.
 * The cost is that opening one 2023 program pulls its whole college (the
 * largest, social sciences, is ~2 MB pretty-printed and far less over the
 * wire), paid once, lazily, and only by students who set a past cohort.
 */
function archiveBundlePath(college, year = YEAR) {
  return join(ARCHIVE_ROOT, String(year), `${college}.json`);
}

/**
 * Committed archive programs for one edition, keyed by the SAME synthetic path
 * the live tree uses, so the write rails compare like with like without
 * knowing which storage form they are looking at.
 */
function readArchiveEdition(year = YEAR) {
  const out = new Map();
  const dir = join(ARCHIVE_ROOT, String(year));
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const college = file.replace(/\.json$/, '');
    let bundle;
    try { bundle = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
    for (const [slug, program] of Object.entries(bundle)) {
      out.set(outPath(college, slug), program);
    }
  }
  return out;
}

/**
 * Record this edition in the shared archive manifest.
 *
 * Merged rather than rewritten: the undergrad and graduate scrapers each own
 * their own key for the same edition and run separately, so a write that
 * replaced the file would silently drop whichever ran first.
 */
function writeArchiveManifest(programs, colleges) {
  let manifest = { editions: {} };
  if (existsSync(ARCHIVE_MANIFEST)) {
    try { manifest = JSON.parse(readFileSync(ARCHIVE_MANIFEST, 'utf8')); } catch {}
  }
  manifest.editions ??= {};
  const key = String(YEAR);
  manifest.editions[key] ??= { label: EDITION.label };
  manifest.editions[key].label = EDITION.label;
  manifest.editions[key][TREE] = {
    programs: programs.length,
    colleges,
    sections: programs.reduce((n, p) => n + (p.requirementSections?.length ?? 0), 0),
    concentrations: programs.reduce((n, p) => n + (p.concentrations?.concentrationOptions?.length ?? 0), 0),
    plans: programs.filter(p => p.planGrid).length,
    // Counting plans only ever proved they arrived, never that they were read.
    // The catalog states each term's total beside it, so the grid checks its
    // own arithmetic — the plan side's first content-level guard, matching what
    // verify-majors and the scrape rails already give the requirement side.
    // Baseline is 9,485 of 9,492 terms; a drop means row parsing has broken.
    ...planGates(programs),
    scrapedAt: new Date().toISOString().slice(0, 10),
  };
  // Newest first, so the file reads the way the editions are used.
  manifest.editions = Object.fromEntries(
    Object.entries(manifest.editions).sort((a, b) => Number(b[0]) - Number(a[0])));
  mkdirSync(dirname(ARCHIVE_MANIFEST), { recursive: true });
  writeFileSync(ARCHIVE_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Plan-grid health for one run, as counters the rails can act on.
 *
 * `planGridWitnessGap` wires up a check that was written and never called:
 * planGridCourseKeys' own docstring said it cross-checked the structured parse
 * against the flattened plan-of-study witness, and it had zero callers — so the
 * file read as guarded when it was not. The two readings of one pane are parsed
 * separately on purpose, and nothing but this notices when they diverge.
 *
 * `planCellsAmbiguous` counts cells mixing `and` with `or`, whose grouping is
 * best-effort. It is information, not a failure: the goal is that it never
 * grows silently.
 */
function planGates(programs) {
  let agree = 0, disagree = 0, unstated = 0, ambiguous = 0, gap = 0;
  for (const p of programs) {
    if (!p.planGrid) continue;
    const r = verifyPlanGrid(p.planGrid);
    agree += r.agree; disagree += r.disagree;
    unstated += r.unstated; ambiguous += r.ambiguous;
    const witness = new Set(p.metadata?.planOfStudyCourses ?? []);
    if (witness.size) gap += planGridCourseKeys(p.planGrid).filter(k => !witness.has(k)).length;
  }
  return {
    planTermsAgree: agree,
    planTermsDisagree: disagree,
    planTermsUnstated: unstated,
    planCellsAmbiguous: ambiguous,
    planGridWitnessGap: gap,
  };
}

/** Every committed sample plan in one edition — what the plan rail counts. */
function listCommittedPlans(year = YEAR) {
  const out = [];
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === 'plan.json') out.push(p);
    }
  };
  walk(join(OUT_ROOT, String(year)));
  return out;
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
  resolveYearFrom(root, url);   // edition year, before any outPath() call

  const name = root.querySelector('#page-title h1, h1.page-title, h1')
    ?.text?.trim()
    ?.replace(/\s+/g, ' ')
    ?? '';

  const { value: totalCreditsRequired, source: totalCreditsSource } = parseTotalCredits(root, PROFILE);
  const { requirementSections, concentrations, generalElectiveSH, gpaConstraints,
          footnotes,
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
      // The catalog page this was read from. Stored so the UI can send an
      // advisor straight to the source — the whole point of saying "we copied
      // the catalog" is that they can go check the catalog.
      sourceUrl: url,
      ...(unconsumedHeadings?.length ? { unconsumedHeadings } : {}),
      // Courses the department's own sample plan names. A one-directional
      // witness: anything here that matches no requirement means we dropped
      // something. Never the reverse — the plan picks one branch per choice.
      planOfStudyCourses: extractPlanOfStudyCourses(root),
    },
    // The same pane read as STRUCTURE — years, terms, entries — so the plan can
    // be offered to a student rather than only counted against. Split into
    // plan.json at write time and never stored here; see planPath().
    // Null for the many programs that publish no plan, which is normal.
    planGrid: extractPlanGrid(root),
    totalCreditsRequired,
    // Which phrasing produced the number — 'stated-total' and friends come
    // from what the page says is required; 'plan-grid' means we fell back to
    // the sample plan and the value may exceed the true minimum.
    ...(totalCreditsSource ? { totalCreditsSource } : {}),
    yearVersion: YEAR,
    requirementSections,
    // GPA rules are constraints over grades, not satisfiable requirements —
    // they render as info in the graduation panel and are evaluated only
    // against grades the user chose to enter (src/core/gradeSystem.js).
    ...(gpaConstraints?.length ? { gpaRequirements: gpaConstraints } : {}),
    // Only footnotes that state something machine-readable are kept — the ones
    // carrying a substitution, or naming courses a reader may want to check.
    // The rest is prose we would store and never use.
    ...(footnotes?.some(f => f.substitution)
        ? { footnotes: footnotes.filter(f => f.substitution) }
        : {}),
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
/**
 * Committed programs for ONE catalog edition (defaults to the edition this
 * run writes). Editions are frozen, so the rails must compare this year
 * against ITSELF: walking every year made the first scrape of a new edition
 * see all ~1,000 previous-edition files as "vanished", which would trip the
 * rails and refuse to write — blocking the roll entirely.
 */
function listCommittedPrograms(year = YEAR) {
  const out = [];
  const walk = dir => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e === 'requirements.json') out.push(p);
    }
  };
  walk(join(OUT_ROOT, String(year)));
  return out;
}

/** Program count of the newest OTHER edition — the discovery-floor baseline
 *  when this edition is brand new and has nothing committed yet. */
function priorEditionCount() {
  // Archive backfill: baseline against the NEAREST committed edition, not the
  // live one. The catalog grows — 2019 really does publish fewer programs than
  // 2026 — so measuring a seven-year-old edition against today's count would
  // fire the discovery floor on a perfectly good run and block the backfill it
  // exists to protect. One year apart, a shortfall means something.
  //
  // Backfilling newest-first therefore gives every run a one-year baseline.
  if (EDITION && existsSync(ARCHIVE_ROOT)) {
    const nearest = readdirSync(ARCHIVE_ROOT)
      .filter(n => /^\d{4}$/.test(n) && Number(n) !== YEAR)
      .map(Number)
      .sort((a, b) => Math.abs(a - YEAR) - Math.abs(b - YEAR))[0];
    if (nearest != null) {
      const n = readArchiveEdition(nearest).size;
      if (n > 0) return n;
    }
  }
  if (!existsSync(OUT_ROOT)) return 0;
  const years = readdirSync(OUT_ROOT)
    .filter(n => /^\d{4}$/.test(n) && Number(n) !== YEAR)
    .map(Number).sort((a, b) => b - a);
  return years.length ? listCommittedPrograms(years[0]).length : 0;
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
  let plansWritten = 0, plansRemoved = 0;
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
      // An edition mismatch is evidence about the ARCHIVE, not about this
      // program, so it must not be absorbed into the fetch-failure count —
      // that rail tolerates 2%, which would let a handful of wrong-edition
      // pages land while the run reported itself healthy.
      if (isFatalScrapeError(err)) {
        console.log('FAIL');
        console.error(`\n❌  ${err.message}\n\n    Nothing was written.\n`);
        process.exit(1);
      }
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
    // What this edition looked like before the run. An archive edition is
    // frozen upstream, so a re-scrape SHOULD reproduce it exactly and the
    // rails are how a parser regression shows up instead of quietly landing.
    const previous = EDITION ? readArchiveEdition() : new Map();
    if (!EDITION) {
      for (const p of pending.keys()) {
        if (existsSync(p)) { try { previous.set(p, JSON.parse(readFileSync(p, 'utf8'))); } catch {} }
      }
      for (const p of listCommittedPrograms()) {
        if (!previous.has(p)) { try { previous.set(p, JSON.parse(readFileSync(p, 'utf8'))); } catch {} }
      }
    }
    const { ok, failures, stats } = checkScrapeRails({
      discovered: programs.length, failed, results: pending, previous,
      baselineCount: priorEditionCount(),
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
    // Sample plans are written as siblings, and a program that stopped
    // publishing one must LOSE its file: a plan left behind would place courses
    // from a previous edition into a student's plan as though this edition's
    // department had asked for them. But a fleet-wide loss is held rather than
    // applied — see checkPlanRail for why this one warns instead of failing.
    const nowPlans  = [...pending.values()].filter(d => d.planGrid).length;
    // A frozen edition has no plans to lose: it is written whole every time,
    // so nothing is ever left behind to delete.
    const prevPlans = EDITION ? 0 : listCommittedPlans().length;
    const { deleteOk, reason } = checkPlanRail(nowPlans, prevPlans);
    if (!deleteOk) console.warn(`\n⚠  ${reason}\n`);

    if (EDITION) {
      // A frozen edition is written whole, grouped into college bundles. The
      // plan stays INSIDE the entry here rather than beside it: the split
      // exists to keep the live per-program download small, and a bundle is
      // already one request either way.
      const byCollege = new Map();
      for (const [p, data] of pending) {
        const parts = p.split(sep);
        const slug = parts[parts.length - 2], college = parts[parts.length - 3];
        if (!byCollege.has(college)) byCollege.set(college, {});
        byCollege.get(college)[slug] = data.planGrid ? data : (({ planGrid, ...rest }) => rest)(data);
        written++;
        if (data.planGrid) plansWritten++;
      }
      for (const [college, bundle] of byCollege) {
        const out = archiveBundlePath(college);
        mkdirSync(dirname(out), { recursive: true });
        // Sorted keys so a re-scrape of a frozen edition produces a diff that
        // is about the catalog, not about iteration order.
        const sorted = Object.fromEntries(Object.keys(bundle).sort().map(k => [k, bundle[k]]));
        // Minified, unlike the live tree. Pretty-printing exists so the monthly
        // diff is readable, which is how a bad scrape gets noticed — but a
        // frozen edition is written once and never diffed, so the indentation
        // buys nothing and costs 64%. Across seven editions that is the
        // difference between ~26 MB and ~72 MB in a public repo where every
        // clone pays, and it makes the eventual lazy load 2.5x smaller too.
        writeFileSync(out, JSON.stringify(sorted) + '\n');
      }
      console.log(`Archive ${EDITION.label}: ${written} programs in ${byCollege.size} college bundles, ` +
                  `${plansWritten} with a sample plan.`);
      writeArchiveManifest([...pending.values()], byCollege.size);
    } else {
      for (const [p, data] of pending) {
        const { planGrid, ...program } = data;
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, JSON.stringify(program, null, 2));
        written++;

        const pp = join(dirname(p), 'plan.json');
        if (planGrid) { writeFileSync(pp, JSON.stringify(planGrid, null, 2)); plansWritten++; }
        else if (existsSync(pp) && deleteOk) { rmSync(pp); plansRemoved++; }
      }
      console.log(`Sample plans: ${plansWritten} written, ${plansRemoved} removed ` +
                  `(${prevPlans} committed before this run).`);
    }
  }

  console.log(`\nResults: ${done} scraped, ${written} written, ${skipped} skipped, ${failed} failed`);
  if (!WRITE && !DRY_RUN && done > 0) console.log('Run with --write to save output files.');

  // The change log is the user-facing "what updated" feed, so it tracks the
  // LIVE catalog. A backfill of seven frozen editions would push seven
  // identical rows into it describing nothing that changed.
  if (WRITE && !EDITION) {
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

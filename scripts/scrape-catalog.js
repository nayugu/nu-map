#!/usr/bin/env node
/**
 * scrape-catalog.js
 *
 * Scrapes course data from catalog.northeastern.edu — the canonical,
 * faculty-maintained source for titles, descriptions, NUPath designations,
 * and credit hours.
 *
 * Output:  public/northeastern/catalog-courses.json    (standalone catalog snapshot)
 *
 * Merge:   Pass --merge to overlay catalog fields (title, description,
 *          credits, nuPath) onto the existing all-courses.json while
 *          preserving sections/terms data from the SearchNEU snapshot.
 *
 * Usage:
 *   node scripts/scrape-catalog.js                    # scrape → catalog-courses.json
 *   node scripts/scrape-catalog.js --subject CS       # single subject only
 *   node scripts/scrape-catalog.js --merge            # scrape + merge → all-courses.json
 *   node scripts/scrape-catalog.js --merge --write    # merge + overwrite all-courses.json
 *   node scripts/scrape-catalog.js --dry-run          # scrape first 3 subjects only
 *   node scripts/scrape-catalog.js --rotate --write   # scrape one subject (rotating), partial-merge
 *
 * Archive editions (writes ONLY to data/northeastern/catalog/editions/<year>/,
 * never to any live artifact — see runEdition):
 *   node scripts/scrape-catalog.js --edition 2024-2025 --dry-run
 *   node scripts/scrape-catalog.js --edition 2024-2025 --write
 *   CATALOG_HTML_CACHE=.cache/catalog node scripts/scrape-catalog.js --edition 2024-2025 --write
 *
 * Rate limiting: 400 ms between requests (respectful of the server).
 * Set CATALOG_DELAY_MS env variable to override.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseHTML } from "node-html-parser";
// Only the NUPath RECONCILIATION stays here — it is a merge decision about two
// sources, not markup reading. Everything the course-block reader needed
// (repeatability, prereq/coreq text, description-stated prereqs and GPA gates,
// attribute lines) moved with it into lib/catalog-course-parser.js.
import { reconcileNuPath, SOURCE_POLICY } from "./lib/nupath.js";
import { courseKeysOf } from "./lib/major-verify.js";
import { activeCourseCount, applyEditionRetention } from "./lib/course-retention.js";
// The course-block reader lives in lib/ because a second caller now exists (an
// archive-edition scrape reads the same markup). See catalog-course-parser.js.
import { parseSubjectPage as parseSubjectPageLib } from "./lib/catalog-course-parser.js";
// ── The archive-edition path ────────────────────────────────────────────────
// `--edition 2024-2025` scrapes a FROZEN past edition out of
// catalog.northeastern.edu/archive/ and writes it to
// data/northeastern/catalog/editions/<year>/. It shares every rule in
// catalog-edition.js with the program scrapers, above all the per-page
// provenance assertion: the flag is the authority and the page is the thing
// being checked, so a redirect that quietly serves live content aborts the run
// instead of writing today's courses into a folder labelled 2023.
import {
  parseEditionArg, editionBasePath, assertEdition, isFatalScrapeError,
} from "./lib/catalog-edition.js";
import { fidelityOfEdition, FIRST_FULL_FIDELITY_EDITION } from "./lib/catalog-fidelity.js";
import { parseCatalogEdition } from "./lib/catalog-program-parser.js";
// politeFetch rather than the bare fetchPage below, and that is not a
// preference. catalog-cache.js says it outright: a transient error on a
// MONTHLY run gets another go in four weeks, but an archive edition is scraped
// once and frozen, so a dropped socket writes a snapshot permanently missing a
// subject. Seven pages were lost that way on the first 2024-2025 program run.
import { politeFetch, cacheSummary, cacheEnabled } from "./lib/catalog-cache.js";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "..");
const ALL_COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const CATALOG_OUT    = resolve(ROOT, "public/northeastern/catalog-courses.json");
const META_SRC_PATH  = resolve(ROOT, "src/core/dataMeta.json");
const META_PUB_PATH  = resolve(ROOT, "public/data-meta.json");
const STATE_PATH      = resolve(ROOT, "data/northeastern/scrape-state.json");
const PUBLIC_STATE_PATH = resolve(ROOT, "public/northeastern/scrape-state.json"); // served to dev portal
const CHANGE_LOG_PATH = resolve(ROOT, "public/northeastern/change-log.json");
const SUBJECTS_OUT    = resolve(ROOT, "public/northeastern/subjects.json"); // code → display name
// The shipped program trees, read to decide which retired courses an audit we
// still publish cannot be performed without. See lib/course-retention.js.
const PROGRAM_ROOTS   = [
  resolve(ROOT, "data/northeastern/programs/undergraduate"),
  resolve(ROOT, "data/northeastern/programs/graduate"),
];
const CHANGE_LOG_MAX  = 600; // keep last 600 run entries
const BASE_URL      = "https://catalog.northeastern.edu";
const INDEX_URL     = `${BASE_URL}/course-descriptions/`;
const DELAY_MS      = parseInt(process.env.CATALOG_DELAY_MS ?? "400", 10);

const MERGE    = process.argv.includes("--merge");
const WRITE    = process.argv.includes("--write");
const DRY_RUN  = process.argv.includes("--dry-run");
const ROTATE   = process.argv.includes("--rotate");
// The documented way past the 2% shrink floor, for a catalog EDITION ROLL.
// See the refusal at the bottom of this file for why it exists and what it
// still refuses. Deliberately not set by any workflow: a roll is the one event
// that should have a person looking at it.
const ACCEPT_SHRINK = process.argv.includes("--accept-shrink");
// `--edition 2024-2025` → {label, year: 2025}, or null for a live scrape.
// Throws on a malformed label, which is the right moment to fail: everything
// this flag controls writes into a directory named after the year.
const EDITION = parseEditionArg(process.argv);
const SUBJECT  = (() => {
  const i = process.argv.indexOf("--subject");
  return i !== -1 ? process.argv[i + 1]?.toUpperCase() : null;
})();
// --subjects PHYS,EECE,MATH  — scrape multiple subjects in merge mode (like --rotate per subject)
const SUBJECTS = (() => {
  const i = process.argv.indexOf("--subjects");
  return i !== -1 ? process.argv[i + 1]?.toUpperCase().split(",").map(s => s.trim()).filter(Boolean) : null;
})();

// ── NUPATH ────────────────────────────────────────────────────────────────────
// The code map, the WF derivation and the WF drift check all live in
// scripts/lib/nupath.js, shared with fetch-nupath.js so the two paths can't
// disagree about what the catalog's attribute wording means.

// ── Prereq/coreq text parsing ─────────────────────────────────────────────────
// Lives in scripts/lib/prereq-parse.js (pure text, importable by tests — a
// mirrored inline copy would drift, the nupath.js lesson). That's also where
// minimum-grade capture happens: refs carry `minGrade`, evaluated only
// against user-entered grades. See docs/grades-design.md.

// ── HTML fetch with basic error handling ─────────────────────────────────────
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "NU-Map-DataBot/1.0 (academic degree planner; contact nayugu@github; respects robots.txt)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Parse individual subject page ─────────────────────────────────────────────
// The reader itself now lives in ./lib/catalog-course-parser.js, because the
// archive-edition scrape is a second caller of the very same markup and a
// byte-identical second copy is how a data fix lands in one path and not the
// other (the lesson catalog-program-parser.js already paid for). This wrapper
// exists only to keep passing the module-level --subject filter, which used to
// be read as a closure variable from inside the loop.
function parseSubjectPage(html, subjectCode) {
  return parseSubjectPageLib(html, subjectCode, { subjectFilter: SUBJECT });
}

// ── Get subject URL list from the index page ──────────────────────────────────
async function getSubjectURLs() {
  console.log(`Fetching subject index: ${INDEX_URL}`);
  const html  = await fetchPage(INDEX_URL);
  const root  = parseHTML(html);

  // Strategy 1: links under /course-descriptions/XX/
  const links = root.querySelectorAll("a[href]");
  const urls  = new Map(); // code → url

  for (const a of links) {
    const href = a.getAttribute("href") || "";
    const m    = href.match(/\/course-descriptions\/([a-z0-9-]+)\/?$/i);
    if (!m) continue;
    const slug = m[1].toUpperCase().replace(/-/g, " ");
    const url  = href.startsWith("http") ? href : BASE_URL + href;
    if (!urls.has(slug)) urls.set(slug, url);
  }

  if (urls.size === 0) {
    throw new Error(
      "Could not extract subject links from index page. " +
      "The catalog HTML structure may have changed — inspect " + INDEX_URL
    );
  }

  // Subject display names ride the same anchors — "Accounting (ACCT)",
  // "Biology -​CPS (BIO)" — so capture them for zero extra requests.
  // The "- CPS" suffix is the catalog's own disambiguation (BIOL Biology
  // vs BIO Biology - CPS) and is kept verbatim. Rail: refuse to overwrite
  // a good file from a suspiciously small parse.
  const names = {};
  for (const a of links) {
    const href = a.getAttribute("href") || "";
    if (!/\/course-descriptions\/[a-z0-9-]+\/?$/i.test(href)) continue;
    const m = a.text.replace(/​/g, "").trim().replace(/\s+/g, " ")
      .match(/^(.*\S)\s*\(([A-Z]{2,6})\)$/);
    if (m) names[m[2]] = m[1].replace(/\s*-\s*CPS$/, " - CPS");
  }
  if (!DRY_RUN && Object.keys(names).length >= 150) {
    writeFileSync(SUBJECTS_OUT,
      JSON.stringify(Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b))), null, 1) + "\n",
      "utf8");
  }

  return [...urls.entries()]; // [[slug, url], ...]
}

// ── Field-level diff between two course objects ───────────────────────────────────
const DIFF_FIELDS = ["title", "credits", "creditsMax", "scheduleType", "description", "nuPath", "prereqs", "coreqs", "repeatable", "repeatMax", "repeatMaxSH", "minGPA"];

function diffCourse(prev, next) {
  const changes = [];
  for (const field of DIFF_FIELDS) {
    const before = JSON.stringify(prev[field] ?? null);
    const after  = JSON.stringify(next[field] ?? null);
    if (before !== after) {
      changes.push({ field, before: prev[field] ?? null, after: next[field] ?? null });
    }
  }
  return changes;
}

// ── Rotate: scrape one subject per run, cycling through all subjects ──────────
//
// State is persisted in data/scrape-state.json so the rotation is stable:
//   { nextIndex, subjects: [[slug,url],...], lastRun, lastScraped: {slug: isoDate} }
// Each run: pick subjects[nextIndex], scrape it, partial-merge, advance index.

async function runRotate() {
  console.log("\nNU Catalog Scraper — ROTATE MODE");
  console.log("=".repeat(50));

  // ── Load or initialise state ─────────────────────────────────────────────
  let state = { nextIndex: 0, subjects: [], lastRun: null, lastScraped: {} };
  if (existsSync(STATE_PATH)) {
    try { state = JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch {}
  }

  // ── Refresh subject list if empty or stale (>90 days) ────────────────────
  const listAge = state.listFetched
    ? (Date.now() - new Date(state.listFetched).getTime()) / 86400000
    : Infinity;
  if (!state.subjects.length || listAge > 90) {
    console.log("  Fetching fresh subject index (list empty or >90 days old)…");
    state.subjects = await getSubjectURLs();
    state.listFetched = new Date().toISOString();
    // Reset index only if subject count changed significantly
    if (state.nextIndex >= state.subjects.length) state.nextIndex = 0;
    console.log(`  Found ${state.subjects.length} subjects.`);
  }

  if (!state.subjects.length) {
    console.error("  ❌  No subjects found — aborting.");
    process.exit(1);
  }

  // ── Pick this run's subject ───────────────────────────────────────────────
  const idx = state.nextIndex % state.subjects.length;
  const [slug, url] = state.subjects[idx];
  const subjectCode = slug.replace(/\s.*/, ""); // "CS" from "CS Courses"
  console.log(`  Subject ${idx + 1}/${state.subjects.length}: ${slug}`);
  console.log(`  URL: ${url}`);

  // ── Scrape ───────────────────────────────────────────────────────────────
  let freshCourses = [];
  try {
    const html = await fetchPage(url);
    freshCourses = parseSubjectPage(html, subjectCode);
    console.log(`  Scraped: ${freshCourses.length} courses`);
  } catch (err) {
    console.error(`  ❌  Scrape failed: ${err.message}`);
    process.exit(1);
  }

  // ── Verified-merge into catalog-courses.json ─────────────────────────────
  // Strategy:
  //   - Existing course in catalog   → overlay catalog fields, diff
  //   - New course only in catalog   → add
  //   - Course in our data but gone from catalog → flag in log, KEEP in data (don't silently delete)
  if (!existsSync(CATALOG_OUT)) {
    console.error("  ❌  catalog-courses.json not found — run scrape-catalog.js --write first.");
    process.exit(1);
  }

  const existing = JSON.parse(readFileSync(CATALOG_OUT, "utf8"));
  const existingForSubject = new Map(
    existing.filter(c => c.subject === subjectCode).map(c => [`${c.subject} ${c.number}`, c])
  );
  const existingOther = existing.filter(c => c.subject !== subjectCode);
  const catMap = new Map(freshCourses.map(c => [`${c.subject} ${c.number}`, c]));

  const addedCodes      = [];
  const modifiedCourses = [];
  const removedCodes    = [];
  let   unchangedCount  = 0;
  const mergedSubject   = [];

  for (const [key, cat] of catMap) {
    const prev = existingForSubject.get(key);
    if (!prev) {
      // New course — catalog has it, we don't
      mergedSubject.push(cat);
      addedCodes.push(key);
    } else {
      // Existing course — overlay catalog fields, preserve sections/terms
      const merged = {
        ...prev,
        // A course the catalog just listed is in the CURRENT catalog, so a
        // retirement marker spread in from `prev` is stale — and a stale one
        // is not cosmetic: `activeCourseCount` excludes retired courses, so a
        // revived course badged as gone under-counts the shrink rail as well
        // as lying to every other reader. Spreading `undefined` clears the
        // keys on write, the same trick repeatability uses below.
        retired: undefined, retiredSince: undefined,
        title:        cat.title        || prev.title,
        credits:      cat.credits != null ? cat.credits : prev.credits,
        // creditsMax: set when catalog shows a range, clear when fixed-credit, preserve existing if cat has no data
        ...(cat.creditsMax !== undefined
          ? { creditsMax: cat.creditsMax }
          : cat.credits != null
            ? {} // catalog confirms fixed credit — drop any stale creditsMax
            : prev.creditsMax !== undefined ? { creditsMax: prev.creditsMax } : {}),
        scheduleType: cat.scheduleType || prev.scheduleType,
        description:  cat.description  || prev.description,
        nuPath:       reconcileNuPath(prev.nuPath ?? [], cat.nuPath ?? [], SOURCE_POLICY.catalog),
        // Always trust catalog prereqs/coreqs when they exist (even empty = confirmed no prereqs).
        // Only fall back to prev when catalog had no record for this course (cat field is undefined).
        prereqs: Array.isArray(cat.prereqs) ? cat.prereqs : (prev.prereqs ?? []),
        coreqs:  Array.isArray(cat.coreqs)  ? cat.coreqs  : (prev.coreqs  ?? []),
        // Repeatability rides the description: when the catalog gave us one,
        // its parse result is authoritative — spreading `undefined` clears
        // stale fields (JSON.stringify drops the keys on write).
        ...(cat.description ? { repeatable: cat.repeatable, repeatMax: cat.repeatMax, repeatMaxSH: cat.repeatMaxSH } : {}),
      };
      const changes = diffCourse(prev, merged);
      if (changes.length > 0) {
        modifiedCourses.push({ code: key, changes });
      } else {
        unchangedCount++;
      }
      mergedSubject.push(merged);
      existingForSubject.delete(key);
    }
  }

  // Courses in our data but no longer listed in the catalog — keep, flag in log
  for (const [key, c] of existingForSubject) {
    removedCodes.push(key);
    mergedSubject.push(c); // keep it — developer decides via PR whether to remove
  }

  const updated = [...existingOther, ...mergedSubject];

  console.log(`  Added:    ${addedCodes.length}`);
  console.log(`  Modified: ${modifiedCourses.length}`);
  console.log(`  Dropped from catalog (kept): ${removedCodes.length}`);
  console.log(`  Unchanged: ${unchangedCount}`);
  if (modifiedCourses.length) {
    console.log("  Changes:");
    for (const { code, changes } of modifiedCourses) {
      for (const { field, before, after } of changes) {
        const b = JSON.stringify(before)?.slice(0, 60);
        const a = JSON.stringify(after)?.slice(0, 60);
        console.log(`    ${code}  ${field}: ${b} → ${a}`);
      }
    }
  }

  // ── Advance state ─────────────────────────────────────────────────────────
  const now = new Date();
  state.nextIndex   = (idx + 1) % state.subjects.length;
  state.lastRun     = now.toISOString();
  state.lastScraped = state.lastScraped ?? {};
  state.lastScraped[subjectCode] = now.toISOString();

  if (!WRITE) {
    console.log("\n📋  DRY RUN — pass --write to save changes.");
    console.log(`  Would advance nextIndex → ${state.nextIndex} (${state.subjects[state.nextIndex]?.[0] ?? "wrap"})`);
    return;
  }

  // ── Write course data ───────────────────────────────────────────────────────────
  writeFileSync(CATALOG_OUT, JSON.stringify(updated, null, 0), "utf8");
  console.log(`  ✅  Saved ${updated.length} courses → public/northeastern/catalog-courses.json`);

  // ── Write change log (public/change-log.json) ───────────────────────────
  let changeLog = { runs: [] };
  if (existsSync(CHANGE_LOG_PATH)) {
    try { changeLog = JSON.parse(readFileSync(CHANGE_LOG_PATH, "utf8")); } catch {}
  }
  changeLog.runs = changeLog.runs ?? [];
  changeLog.runs.unshift({
    timestamp: now.toISOString(),
    subject:   subjectCode,
    added:     addedCodes,
    modified:  modifiedCourses,
    removedFromCatalog: removedCodes,
    unchanged: unchangedCount,
  });
  if (changeLog.runs.length > CHANGE_LOG_MAX) changeLog.runs = changeLog.runs.slice(0, CHANGE_LOG_MAX);
  writeFileSync(CHANGE_LOG_PATH, JSON.stringify(changeLog, null, 2) + "\n", "utf8");
  console.log(`  ✅  Change log written → public/change-log.json`);

  // ── Write rotation state ─────────────────────────────────────────────────────
  mkdirSync(resolve(ROOT, "data/northeastern"), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`  ✅  State saved → data/northeastern/scrape-state.json (nextIndex: ${state.nextIndex})`);

  // Write a public copy (no secrets — URLs are all catalog.northeastern.edu)
  writeFileSync(PUBLIC_STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`  ✅  Public state → public/scrape-state.json`);

  // Update dataMeta
  const label = now.toLocaleString("en-US", { month: "short", year: "numeric" });
  const metaPayload = { lastUpdated: label, courseCount: updated.length };
  writeFileSync(META_SRC_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
  writeFileSync(META_PUB_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
  console.log(`  ✅  dataMeta updated → lastUpdated: "${label}"`);
  console.log(`\n  Next run will scrape: ${state.subjects[state.nextIndex]?.[0] ?? "(wrap to start)"}\n`);
}

// ── Multi-subject merge: scrape a provided list of subjects, merging each ──────
// Like running --rotate --write once per subject but without advancing state.
async function runSubjects(subjectCodes) {
  console.log(`\nNU Catalog Scraper — SUBJECTS MODE (${subjectCodes.length} subjects)`);
  console.log("=".repeat(50));
  if (!existsSync(CATALOG_OUT)) {
    console.error("  ❌  catalog-courses.json not found — run scrape-catalog.js --write first.");
    process.exit(1);
  }

  for (let si = 0; si < subjectCodes.length; si++) {
    const subjectCode = subjectCodes[si];
    const url = `${INDEX_URL}${subjectCode.toLowerCase()}/`;
    console.log(`\n  [${si + 1}/${subjectCodes.length}]  ${subjectCode}`);
    console.log(`  URL: ${url}`);

    let freshCourses = [];
    try {
      const html = await fetchPage(url);
      freshCourses = parseSubjectPage(html, subjectCode);
      console.log(`  Scraped: ${freshCourses.length} courses`);
    } catch (err) {
      console.error(`  ❌  Scrape failed: ${err.message} — skipping`);
      if (si < subjectCodes.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const existing = JSON.parse(readFileSync(CATALOG_OUT, "utf8"));
    const existingForSubject = new Map(
      existing.filter(c => c.subject === subjectCode).map(c => [`${c.subject} ${c.number}`, c])
    );
    const existingOther = existing.filter(c => c.subject !== subjectCode);
    const catMap = new Map(freshCourses.map(c => [`${c.subject} ${c.number}`, c]));

    const addedCodes = [], modifiedCourses = [], removedCodes = [];
    let unchangedCount = 0;
    const mergedSubject = [];

    for (const [key, cat] of catMap) {
      const prev = existingForSubject.get(key);
      if (!prev) {
        mergedSubject.push(cat);
        addedCodes.push(key);
      } else {
        const merged = {
          ...prev,
          // Stale retirement marker — see the identical note in runRotate.
          // (These two merges are near-duplicates and have been since before
          // this change; a fix has to land in both, which is exactly the
          // hazard CLAUDE.md names for the two scrapeProgram copies.)
          retired: undefined, retiredSince: undefined,
          title:        cat.title        || prev.title,
          credits:      cat.credits != null ? cat.credits : prev.credits,
          ...(cat.creditsMax !== undefined
            ? { creditsMax: cat.creditsMax }
            : cat.credits != null ? {} : prev.creditsMax !== undefined ? { creditsMax: prev.creditsMax } : {}),
          scheduleType: cat.scheduleType || prev.scheduleType,
          description:  cat.description  || prev.description,
          nuPath:       reconcileNuPath(prev.nuPath ?? [], cat.nuPath ?? [], SOURCE_POLICY.catalog),
          prereqs: Array.isArray(cat.prereqs) ? cat.prereqs : (prev.prereqs ?? []),
          coreqs:  Array.isArray(cat.coreqs)  ? cat.coreqs  : (prev.coreqs  ?? []),
          // Repeatability rides the description (see rotate merge above).
          ...(cat.description ? { repeatable: cat.repeatable, repeatMax: cat.repeatMax, repeatMaxSH: cat.repeatMaxSH } : {}),
        };
        const changes = diffCourse(prev, merged);
        if (changes.length > 0) modifiedCourses.push({ code: key, changes });
        else unchangedCount++;
        mergedSubject.push(merged);
        existingForSubject.delete(key);
      }
    }
    for (const [key, c] of existingForSubject) { removedCodes.push(key); mergedSubject.push(c); }

    console.log(`  Added: ${addedCodes.length}  Modified: ${modifiedCourses.length}  Unchanged: ${unchangedCount}`);
    if (modifiedCourses.length) {
      for (const { code, changes } of modifiedCourses) {
        for (const { field, before, after } of changes) {
          const b = JSON.stringify(before)?.slice(0, 60);
          const a = JSON.stringify(after)?.slice(0, 60);
          console.log(`    ${code}  ${field}: ${b} → ${a}`);
        }
      }
    }

    if (!WRITE) {
      console.log("  📋  DRY RUN — pass --write to save");
    } else {
      const updated = [...existingOther, ...mergedSubject];
      writeFileSync(CATALOG_OUT, JSON.stringify(updated, null, 0), "utf8");
      console.log(`  ✅  Saved ${updated.length} courses → catalog-courses.json`);
    }

    if (si < subjectCodes.length - 1) await sleep(DELAY_MS);
  }
  console.log("\n✅  Done.");
}

// ── Main ─────────────────────────────────────────────────────────────────────

// ── Archive-edition mode ──────────────────────────────────────────────────────
/**
 * Scrape one FROZEN past edition into data/northeastern/catalog/editions/<year>/.
 *
 * ## Why this is a separate path rather than a flag threaded through the live one
 *
 * Almost everything the live scrape does after parsing is WRONG for an archive
 * edition, and each one fails silently:
 *
 *   - the keep-if-fresh-is-empty merge reconciles nuPath against the LIVE
 *     catalog, which would stamp 2026's designations onto a 2023 record;
 *   - `applyEditionRetention` unions in courses a current program tree needs,
 *     which are by definition not part of the edition being captured
 *     (freeze-edition.js refuses them for the same reason);
 *   - the 2% shrink floor is tuned for month-to-month drift inside ONE
 *     edition, and a three-year-old catalog is legitimately smaller;
 *   - data-meta, change-log, scrape-state and subjects.json all describe the
 *     live scrape and must not move.
 *
 * Threading a boolean through all of that means one missed branch writes live
 * data into a folder labelled with a past year — the precise failure
 * catalog-edition.js exists to prevent, and one nothing downstream can detect.
 * So this short-circuits before any of it, exactly as --rotate and --subjects
 * already do, and it can reach only ONE output path.
 *
 * ## What "efficient" actually means here, measured
 *
 * The obvious optimisation is to skip courses already in the catalog, since
 * only the retired ones are new information. **It saves nothing**, and the
 * reason is the requests-per-entity ratio CLAUDE.md says to establish before
 * designing anything: the catalog is a BULK FEED — one request returns a whole
 * subject, ~35 courses — so a course is already paid for by the time we can
 * see its code. Measured 2026-09-03: 222 / 227 / 230 subject pages for
 * editions 2023 / 2024 / 2025, i.e. 679 requests for ~24,000 course records.
 * Skipping known codes removes zero of them.
 *
 * The savings that are real:
 *   - CATALOG_HTML_CACHE turns a parser fix from a re-fetch into a re-parse,
 *     which is the highest-value rule in the scraping section;
 *   - storage is a non-issue and that was measured too, not assumed: the
 *     4.9 MB 2026 snapshot is 182 KB packed in git, and these files delta
 *     against each other, so three editions cost well under a megabyte of
 *     repo. `data/` is source material and never ships to the browser.
 * So the snapshot stays FULL and self-contained, per the README in that tree.
 * A delta-chained store would save ~400 KB and cost the property that lets a
 * snapshot's provenance be checked in isolation.
 */
async function runEdition(edition) {
  const outDir  = resolve(ROOT, "data/northeastern/catalog/editions", String(edition.year));
  const outFile = resolve(outDir, "catalog-courses.json");
  const base    = `${BASE_URL}${editionBasePath(edition)}`;

  console.log(`\nNU Catalog Scraper — ARCHIVE EDITION ${edition.label} (${edition.year})`);
  console.log("=".repeat(60));
  console.log(`  Source: ${base}/course-descriptions/`);
  console.log(`  Target: ${outFile}`);
  if (cacheEnabled()) console.log(`  ⚠  HTML cache ON — never set CATALOG_HTML_CACHE in CI`);

  // Frozen means frozen — the same rule freeze-edition.js enforces, and for
  // the same reason. Deleting a snapshot by hand is a deliberate act that
  // leaves a trace in git; a --force flag is one nobody reads.
  if (existsSync(outFile)) {
    console.error(`\n  ❌  ${outFile} already exists.`);
    console.error(`      Frozen editions are never regenerated. Delete it by hand if it is wrong.`);
    process.exit(1);
  }

  // The descriptive era (< 2022) publishes no prereqs, no coreqs and no
  // Attribute lines, AND its title line omits the parenthesised credit form
  // the parser matches — so those pages yield ZERO courses rather than
  // partial ones. Writing that would be a snapshot claiming an edition had no
  // courses. Refuse until an era-aware reader exists (design doc §8 step 11).
  if (fidelityOfEdition(edition.year) !== "full") {
    console.error(`\n  ❌  Edition ${edition.year} predates ${FIRST_FULL_FIDELITY_EDITION} and is 'descriptive' fidelity.`);
    console.error(`      Its pages carry no prereq/coreq/attribute lines and its title format`);
    console.error(`      does not match the parser, so a run would write an EMPTY snapshot.`);
    console.error(`      See docs/catalog-editions-design.md §4 and §8 step 11.`);
    process.exit(1);
  }

  const fetchOpts = { delayMs: DELAY_MS, userAgent: "NU-Map-DataBot/1.0 (academic degree planner; contact nayugu@github; respects robots.txt)" };

  // ── Index, and its own provenance check ────────────────────────────────
  const indexURL = `${base}/course-descriptions/`;
  const indexHTML = await politeFetch(indexURL, fetchOpts);
  const indexRoot = parseHTML(indexHTML);
  assertEdition(parseCatalogEdition(indexRoot), edition, indexURL);

  const slugs = new Set();
  for (const a of indexRoot.querySelectorAll("a[href]")) {
    const m = (a.getAttribute("href") || "").match(/\/course-descriptions\/([a-z0-9-]+)\/?$/i);
    if (m) slugs.add(m[1].toLowerCase());
  }
  if (!slugs.size) {
    console.error(`\n  ❌  No subject links on ${indexURL} — the archive markup may differ.`);
    process.exit(1);
  }
  let subjects = [...slugs].sort();
  // --dry-run is how you check the archive markup still parses without paying
  // for 230 pages. It cannot write, and it skips the floor rail below, since
  // three subjects are legitimately far under it.
  if (DRY_RUN) subjects = subjects.slice(0, 3);
  console.log(`\n  ${subjects.length} subjects${DRY_RUN ? "  (DRY RUN — first 3)" : ""}\n`);

  // ── Fetch every subject page ───────────────────────────────────────────
  const allCourses = [];
  const emptySubjects = [];
  for (let i = 0; i < subjects.length; i++) {
    const slug = subjects[i];
    const url  = `${base}/course-descriptions/${slug}/`;
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${subjects.length}]  ${slug.padEnd(12)}`);

    let html;
    try {
      html = await politeFetch(url, fetchOpts);
    } catch (err) {
      // Unlike the monthly scrape, there is no next run to paper over this:
      // the snapshot is written once and frozen. And the slug came from this
      // edition's OWN index, so a failure here is an anomaly rather than a
      // subject that went away. Re-running with a warm cache is nearly free,
      // which is what makes stopping the cheap choice — the same argument
      // backfill-archive.sh makes for halting on the first bad edition.
      process.stdout.write(`  ERROR: ${err.message}\n`);
      console.error(`\n  ❌  ${slug} failed after retries. Refusing to freeze a partial edition.`);
      console.error(`      Re-run; with CATALOG_HTML_CACHE set, the pages already fetched are free.`);
      process.exit(1);
    }

    const root = parseHTML(html);
    try {
      assertEdition(parseCatalogEdition(root), edition, url);
    } catch (err) {
      if (isFatalScrapeError(err)) {
        process.stdout.write(`  EDITION MISMATCH\n`);
        console.error(`\n  ❌  ${err.message}`);
        process.exit(1);
      }
      throw err;
    }

    const courses = parseSubjectPageLib(html, slug.toUpperCase().replace(/-/g, " ").split(" ")[0], {});
    allCourses.push(...courses);
    // A 200 carrying zero course blocks is indistinguishable from broken
    // markup, so it is COUNTED and reported rather than passed over. It is
    // not fatal on its own — a subject page really can be empty — but a wave
    // of them is what a markup change looks like, and the floor rail below
    // is what turns that into a refusal.
    if (!courses.length) emptySubjects.push(slug);
    process.stdout.write(`  ${courses.length} courses\n`);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Scraped: ${allCourses.length} courses from ${subjects.length} subjects`);
  console.log(`  ${cacheSummary()}`);
  if (emptySubjects.length) {
    console.log(`  Empty pages (${emptySubjects.length}): ${emptySubjects.join(" ")}`);
  }

  // ── Floor rail, measured against the NEAREST committed edition ─────────
  // Not against the live catalog: that file has retired courses unioned back
  // into it by course-retention, so it is a superset of its own edition and
  // would make every archive run look short. Frozen snapshots are
  // edition-pure, which is exactly what makes them the right baseline.
  // Nearest, not newest. The first version of this comment said "because the
  // catalog GROWS", and the backfill disproved it on its first outing:
  // measured 2026-09-03, editions 2023/2024/2025/2026 hold
  // 7,449 / 7,654 / 7,561 / 7,966 courses — up, DOWN, then up. So the argument
  // is not a trend, it is that drift accumulates with distance in either
  // direction, and the nearest edition is the tightest honest baseline
  // available. Same reason backfill-archive.sh walks newest-first.
  const neighbours = existsSync(resolve(ROOT, "data/northeastern/catalog/editions"))
    ? readdirSync(resolve(ROOT, "data/northeastern/catalog/editions"))
        .filter(d => /^\d{4}$/.test(d))
        .map(d => ({ year: +d, file: resolve(ROOT, "data/northeastern/catalog/editions", d, "catalog-courses.json") }))
        .filter(n => existsSync(n.file))
        .sort((a, b) => Math.abs(a.year - edition.year) - Math.abs(b.year - edition.year))
    : [];

  if (DRY_RUN) {
    console.log(`  Baseline: skipped (dry run covers 3 subjects, legitimately under any floor)`);
  } else if (neighbours.length) {
    const near  = neighbours[0];
    const count = JSON.parse(readFileSync(near.file, "utf8")).length;
    const floor = Math.round(count * 0.9);
    console.log(`  Baseline: edition ${near.year} has ${count} courses → floor ${floor} (90%)`);
    if (allCourses.length < floor) {
      console.error(`\n  ❌  ${allCourses.length} courses is below the floor of ${floor}.`);
      console.error(`      Either the archive markup differs from the live catalog or pages`);
      console.error(`      returned 200 with no course blocks. Refusing to freeze this.`);
      process.exit(1);
    }
  } else {
    console.log(`  Baseline: none on disk — no floor rail applied.`);
  }

  // ── What this edition actually contributes ─────────────────────────────
  // The number the backfill is FOR: courses this edition published that the
  // current catalog no longer carries. Reported, never used to filter the
  // snapshot — the union is derived by derive-retired-union.js against the
  // live file at the time it runs, and a snapshot pre-filtered against
  // today's catalog would silently lose every course that retires later.
  if (existsSync(CATALOG_OUT)) {
    const live = new Set(
      JSON.parse(readFileSync(CATALOG_OUT, "utf8")).map(c => `${c.subject} ${c.number}`)
    );
    const gone = allCourses.filter(c => !live.has(`${c.subject} ${c.number}`));
    console.log(`  Retired yield: ${gone.length} of ${allCourses.length} are absent from the current catalog`);
  }

  if (!WRITE) {
    console.log(`\n  (dry run — pass --write to freeze this edition)`);
    return;
  }

  allCourses.sort((a, b) =>
    a.subject === b.subject ? String(a.number).localeCompare(String(b.number))
                            : a.subject.localeCompare(b.subject));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(allCourses, null, 2));
  console.log(`\n  ✅  Wrote ${allCourses.length} courses → ${outFile}`);
  console.log(`      Add an entry to data/northeastern/catalog/editions/manifest.json —`);
  console.log(`      a snapshot on disk but absent from the manifest is unexplained data.`);
}

console.log("\nNU Catalog Scraper");
console.log("=".repeat(50));
if (DRY_RUN) console.log("  ⚠  DRY RUN — only first 3 subjects");
if (MERGE)   console.log("  MODE: merge into all-courses.json");

// Archive-edition mode: short-circuits FIRST, and before every other mode, so
// no combination of flags can route an edition run through a live write path.
if (EDITION) {
  if (MERGE || ROTATE || SUBJECTS) {
    console.error("  ❌  --edition cannot be combined with --merge, --rotate or --subjects.");
    console.error("      Those modes all write live artifacts; an edition run may reach");
    console.error("      only data/northeastern/catalog/editions/<year>/.");
    process.exit(1);
  }
  await runEdition(EDITION);
  process.exit(0);
}

// Rotate mode: short-circuit into dedicated single-subject handler
if (ROTATE) {
  await runRotate();
  process.exit(0);
}

// Multi-subject merge mode
if (SUBJECTS) {
  await runSubjects(SUBJECTS);
  process.exit(0);
}

let subjects;
if (SUBJECT) {
  // Single-subject mode: construct URL directly without fetching index
  subjects = [[SUBJECT, `${INDEX_URL}${SUBJECT.toLowerCase()}/`]];
} else {
  subjects = await getSubjectURLs();
}

if (DRY_RUN) subjects = subjects.slice(0, 3);

console.log(`\nScraping ${subjects.length} subject(s)…\n`);

const allCourses = [];
const errors     = [];
// Subjects whose page didn't load. Their previously-known courses are carried
// forward rather than deleted — see the write guard below.
const failedSubjects = new Set();

for (let i = 0; i < subjects.length; i++) {
  const [slug, url] = subjects[i];
  process.stdout.write(`  [${String(i + 1).padStart(3)}/${subjects.length}]  ${slug.padEnd(12)}`);

  try {
    const html = await fetchPage(url);
    const courses = parseSubjectPage(html, slug.replace(/\s.*/, ""));
    allCourses.push(...courses);
    process.stdout.write(`  ${courses.length} courses\n`);
  } catch (err) {
    process.stdout.write(`  ERROR: ${err.message}\n`);
    errors.push(`${slug}: ${err.message}`);
    failedSubjects.add(slug.replace(/\s.*/, ""));
  }

  if (i < subjects.length - 1) await sleep(DELAY_MS);
}

console.log(`\n${"─".repeat(50)}`);
console.log(`  Scraped: ${allCourses.length} courses from ${subjects.length} subjects`);
if (errors.length > 0) {
  console.log(`  Errors:  ${errors.length}`);
  errors.forEach(e => console.log(`    ✗ ${e}`));
}

// ── Write catalog snapshot ────────────────────────────────────────────────────
// Preserve fields that the catalog scraper may return empty when the website
// changes its HTML (nuPath is the canonical example: selector stops matching →
// every course gets [] → silent data loss on the next full re-scrape).
// Apply the same "keep-if-fresh-is-empty" logic used by --rotate and --subjects.

let toWrite = allCourses;
if (existsSync(CATALOG_OUT)) {
  try {
    const prevMap = new Map(
      JSON.parse(readFileSync(CATALOG_OUT, "utf8"))
        .map(c => [`${c.subject} ${c.number}`, c])
    );
    toWrite = allCourses.map(c => {
      const prev = prevMap.get(`${c.subject} ${c.number}`);
      if (!prev) return c;
      return {
        ...c,
        nuPath: reconcileNuPath(prev.nuPath ?? [], c.nuPath ?? [], SOURCE_POLICY.catalog),
      };
    });
    const rescued = toWrite.filter((c, i) =>
      !allCourses[i].nuPath?.length && c.nuPath?.length
    ).length;
    if (rescued > 0) console.log(`  Preserved nuPath for ${rescued} courses from previous snapshot`);
  } catch {
    // Existing file unreadable — proceed with raw scrape result
  }
}

// ── Write guard ───────────────────────────────────────────────────────────
//
// This file is REPLACED, not merged, so anything absent from `toWrite` is
// deleted. Two ways that silently destroyed data:
//
//   1. A partial run. --dry-run does 3 subjects and --subject does one; both
//      used to write, replacing ~7,900 courses with a stub. (Observed: a
//      `--subject SOC` run left the catalog with 14 courses.)
//   2. A transient per-subject fetch failure on a FULL run. Every course in
//      that subject vanished with no warning — two consecutive runs dropped
//      14 SOC courses and 44 RGA/CMMN courses respectively, purely from
//      whichever page happened to time out.
//
// So: partial runs never write, failed subjects keep their committed courses,
// and a run that would still shrink the catalog materially is refused.
const PARTIAL = DRY_RUN || SUBJECT || SUBJECTS;

if (PARTIAL) {
  console.log(`\n📋  Partial run (${toWrite.length} courses from a subset) — catalog-courses.json left untouched.`);
  console.log(`    Use --merge, or run without --subject/--dry-run, to update it.`);
} else {
  let out = toWrite;

  if (failedSubjects.size && existsSync(CATALOG_OUT)) {
    try {
      const prev = JSON.parse(readFileSync(CATALOG_OUT, "utf8"));
      const rescued = prev.filter(c => failedSubjects.has(c.subject));
      if (rescued.length) {
        out = [...toWrite, ...rescued];
        console.warn(`\n  ⚠  ${failedSubjects.size} subject(s) failed to load: ${[...failedSubjects].join(", ")}`);
        console.warn(`     Carried ${rescued.length} previously-known courses forward rather than deleting them.`);
      }
    } catch { /* unreadable previous snapshot — fall through to the rail */ }
  }

  // Last line of defence: a full run that still loses a meaningful share of
  // the catalog is upstream breakage, not an update.
  //
  // ── Except once a year, when it is neither ──────────────────────────────
  //
  // The 2% floor is tuned for month-to-month drift inside one catalog edition.
  // An EDITION ROLL is a different distribution: NEU retires subjects outright
  // and adds others. Measured on the live 2027 roll (2026-09-02): 7,762 vs
  // 7,966, a 2.6% net loss made of 90 subjects shrinking by 492 and 70 growing
  // by 288 — DGTR, EAI and HLS gone entirely, SUST and NAVY appearing from
  // nothing, THTR up 58. Two-sided churn like that is what a roll looks like;
  // upstream breakage looks like a uniform collapse.
  //
  // So the floor stays where it is and the refusal names the way through,
  // rather than being quietly lowered to fit the once-a-year case. No workflow
  // passes `--accept-shrink`: an unattended run must still stop, because from
  // inside a single run "the edition rolled" and "the markup changed" are
  // indistinguishable, and only one of them should land. What the flag buys is
  // that the operator does not have to edit this file or delete data to get
  // past it — which is what people do when a hard stop has no documented exit.
  //
  // It is bounded, not a switch-off: below 90% it refuses regardless, because
  // no roll loses a tenth of the catalog and a habit is not a decision.
  //
  // ── And it counts the CURRENT catalog on both sides ─────────────────────
  //
  // Retention (below) unions retired courses an older program edition still
  // requires into this file, so the committed snapshot is a superset of the
  // catalog it was scraped from. Counting those on the committed side makes
  // the rail unsatisfiable: next month's identical 7,762-course scrape reads
  // as a ~700-course shrink and the run refuses, every month, for a catalog
  // that never changed. `activeCourseCount` excludes them on both sides —
  // applied to `out` as well, where it is a no-op today only because
  // retention runs after this guard.
  if (existsSync(CATALOG_OUT)) {
    try {
      const prevCount = activeCourseCount(JSON.parse(readFileSync(CATALOG_OUT, "utf8")));
      const floor = Math.floor(prevCount * 0.98);
      const hardFloor = Math.floor(prevCount * 0.90);
      const liveCount = activeCourseCount(out);
      if (prevCount > 0 && liveCount < floor) {
        if (ACCEPT_SHRINK && liveCount >= hardFloor) {
          console.warn(`\n⚠  ${liveCount} courses vs ${prevCount} committed (floor ${floor}) — `
            + `accepted because --accept-shrink was passed.`);
          console.warn(`    Writing a catalog ${prevCount - liveCount} courses smaller than the `
            + `committed one. This is only correct if you have checked that the drop is real.\n`);
        } else {
          console.error(`\n❌  Refusing to write: ${liveCount} courses vs ${prevCount} committed (floor ${floor}).`);
          console.error(`    The catalog is likely unreachable or its markup changed — nothing was written.`);
          if (ACCEPT_SHRINK) {
            console.error(`    --accept-shrink was passed and is NOT enough: this run is below the `
              + `hard floor of ${hardFloor} (90%), which no edition roll reaches.`);
          } else {
            console.error(`\n    If a catalog EDITION has rolled, this is expected — a roll retires`);
            console.error(`    whole subjects and adds others. Check the per-subject counts in the log`);
            console.error(`    above: two-sided churn is a roll, a uniform collapse is breakage. Once`);
            console.error(`    you have checked, re-run with --accept-shrink.`);
          }
          console.error('');
          process.exit(1);
        }
      }
    } catch { /* ignore */ }
  }

  // ── Retain retired courses an older program edition still requires ──────
  //
  // Strictly AFTER the rail above, and that order is load-bearing in both
  // directions — see the rail's own note, and lib/course-retention.js for why
  // this exists at all (3,660 dangling references across 579 of 651 programs
  // on the 2027 roll, each one a requirement row a student can never tick).
  //
  // Everything here degrades to "write what we scraped", never to a refusal:
  // this is a data-quality improvement, and it must not become a new way for
  // an unattended monthly job to write nothing.
  // Orchestration lives in the module, with injected io, because inline here it
  // was reachable ONLY by a full network scrape — every partial mode skips this
  // branch — so its failure branches could not be exercised in under 29
  // minutes. See applyEditionRetention's docblock.
  {
    const { courses, lines } = applyEditionRetention({
      scraped: out,
      catalogPath: CATALOG_OUT,
      programRoots: PROGRAM_ROOTS,
      failedSubjects,
      io: {
        exists: existsSync,
        readdir: p => readdirSync(p, { withFileTypes: true }),
        readFile: p => readFileSync(p, "utf8"),
        courseKeysOf,
      },
      now: new Date().toISOString().slice(0, 10),
    });
    out = courses;
    if (lines.length) console.log("");
    for (const line of lines) console.log(`  ${line}`);
  }

  writeFileSync(CATALOG_OUT, JSON.stringify(out, null, 0), "utf8");
  console.log(`\n✅  Wrote catalog snapshot (${out.length} courses) → public/catalog-courses.json`);
}

if (WRITE && !MERGE) {
  const now   = new Date();
  const label = now.toLocaleString("en-US", { month: "short", year: "numeric" });
  const metaPayload = { lastUpdated: label, courseCount: allCourses.length };
  writeFileSync(META_SRC_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
  writeFileSync(META_PUB_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
  console.log(`✅  dataMeta updated → lastUpdated: "${label}"`);
}

// ── Merge mode ────────────────────────────────────────────────────────────────

if (MERGE) {
  if (!existsSync(ALL_COURSES)) {
    console.error("\n❌  all-courses.json not found — run data:fetch first.");
    process.exit(1);
  }

  const existing  = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
  const catMap    = new Map(allCourses.map(c => [`${c.subject} ${c.number}`, c]));
  const existMap  = new Map(existing.map(c  => [`${c.subject} ${c.number}`, c]));

  const merged = existing.map(c => {
    const k   = `${c.subject} ${c.number}`;
    const cat = catMap.get(k);
    if (!cat) return c;
    // Overlay catalog fields; preserve sections/terms from enrollment data
    return {
      ...c,
      title:        cat.title        || c.title,
      credits:      cat.credits != null ? cat.credits : c.credits,
      ...(cat.creditsMax !== undefined
        ? { creditsMax: cat.creditsMax }
        : cat.credits != null ? {} : c.creditsMax !== undefined ? { creditsMax: c.creditsMax } : {}),
      scheduleType: cat.scheduleType || c.scheduleType,
      description:  cat.description  || c.description,
      nuPath:       reconcileNuPath(c.nuPath ?? [], cat.nuPath ?? [], SOURCE_POLICY.catalog),
      prereqs:      Array.isArray(cat.prereqs) ? cat.prereqs : c.prereqs,
      coreqs:       Array.isArray(cat.coreqs)  ? cat.coreqs  : c.coreqs,
      // Repeatability rides the description (see rotate merge above).
      ...(cat.description ? { repeatable: cat.repeatable, repeatMax: cat.repeatMax, repeatMaxSH: cat.repeatMaxSH } : {}),
    };
  });

  // Catalog-only courses (not in SearchNEU) — add without sections
  let catalogOnly = 0;
  for (const [k, cat] of catMap) {
    if (!existMap.has(k)) {
      merged.push(cat);
      catalogOnly++;
    }
  }

  console.log(`\nMerge summary:`);
  console.log(`  Base:          ${existing.length} courses`);
  console.log(`  Catalog match: ${allCourses.length - catalogOnly} courses updated`);
  console.log(`  Catalog-only:  ${catalogOnly} courses added`);
  console.log(`  Total:         ${merged.length} courses`);

  if (!WRITE) {
    console.log(`\n📋  DRY RUN — use --write to save.\n`);
  } else {
    writeFileSync(ALL_COURSES, JSON.stringify(merged, null, 0), "utf8");

    // Update dataMeta
    const now   = new Date();
    const label = now.toLocaleString("en-US", { month: "short", year: "numeric" });
    const metaPayload = { lastUpdated: label, courseCount: merged.length };
    writeFileSync(META_SRC_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
    writeFileSync(META_PUB_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");

    console.log(`\n✅  Saved merged data → public/all-courses.json`);
    console.log(`✅  Updated src/core/dataMeta.json → lastUpdated: "${label}"\n`);
  }
}

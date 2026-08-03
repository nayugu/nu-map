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
 * Rate limiting: 400 ms between requests (respectful of the server).
 * Set CATALOG_DELAY_MS env variable to override.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseHTML } from "node-html-parser";
import { parseRepeatability } from "../src/adapters/northeastern/repeatability.js";
import { parseNUPath, findAttributeText, reconcileNuPath, SOURCE_POLICY } from "./lib/nupath.js";
import { extractConcurrentCourses, parsePrereqText, parseCoreqText } from "./lib/prereq-parse.js";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "..");
const ALL_COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const CATALOG_OUT    = resolve(ROOT, "public/northeastern/catalog-courses.json");
const META_SRC_PATH  = resolve(ROOT, "src/core/dataMeta.json");
const META_PUB_PATH  = resolve(ROOT, "public/data-meta.json");
const STATE_PATH      = resolve(ROOT, "data/northeastern/scrape-state.json");
const PUBLIC_STATE_PATH = resolve(ROOT, "public/northeastern/scrape-state.json"); // served to dev portal
const CHANGE_LOG_PATH = resolve(ROOT, "public/northeastern/change-log.json");
const CHANGE_LOG_MAX  = 600; // keep last 600 run entries
const BASE_URL      = "https://catalog.northeastern.edu";
const INDEX_URL     = `${BASE_URL}/course-descriptions/`;
const DELAY_MS      = parseInt(process.env.CATALOG_DELAY_MS ?? "400", 10);

const MERGE    = process.argv.includes("--merge");
const WRITE    = process.argv.includes("--write");
const DRY_RUN  = process.argv.includes("--dry-run");
const ROTATE   = process.argv.includes("--rotate");
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
function parseSubjectPage(html, subjectCode) {
  const root   = parseHTML(html);
  const blocks = root.querySelectorAll(".courseblock, [class*='courseblock']");
  if (!blocks.length) return [];

  const courses = [];

  for (const block of blocks) {
    // ── Title line: e.g. "CS 1800. Discrete Structures. (4 Hours)"  ──
    const titleEl = block.querySelector(
      ".courseblocktitle, .cb_title, .course-title, h3"
    );
    if (!titleEl) continue;
    const rawTitle = titleEl.textContent.replace(/\u00a0/g, " ").trim();

    // Parse "SUBJ 1234. Title. (N Hours)"  or  "SUBJ 1234 Title N SH"
    // Credit hours come in four shapes, and only two were accepted:
    //   (4 Hours)      fixed
    //   (1-4 Hours)    a range
    //   (2.5 Hours)    fractional — pharmacy labs and similar
    //   (1,2 Hours)    a discrete choice between values
    // The last two were rejected outright, silently dropping 106 courses from
    // the catalog — including CS 4991, which several programs require. Found
    // because verify-majors flagged those programs as requiring a course we
    // had no record of.
    const titleMatch = rawTitle.match(
      /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\.\s+(.+?)\.\s*\((\d+(?:\.\d+)?(?:\s*[-–,]\s*\d+(?:\.\d+)?)*)\s+[Hh]ours?\)/
    ) || rawTitle.match(
      /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\s+(.+?)\s+(\d+(?:\.\d+)?)\s+SH/i
    );

    if (!titleMatch) continue;

    const [, subject, number, title, credStr] = titleMatch;
    if (SUBJECT && subject !== SUBJECT) continue;

    // Parse credits — preserve ranges: store min in `credits` (matching SearchNEU convention)
    // and `creditsMax` only when different (variable-credit course, e.g. "1-4 Hours").
    // Take the low and high of whatever the page listed: "1-4" and "1,2" and
    // "2.5" all reduce to a min and a max. parseFloat, not parseInt — half-
    // credit labs are real and truncating them to 0 would be worse than
    // dropping the course.
    const parts = credStr.split(/[-–,]/).map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
    const cMin = parts.length ? Math.min(...parts) : 0;
    const cMax = parts.length ? Math.max(...parts) : 0;
    const credits    = cMin;
    const creditsMax = cMax !== cMin ? cMax : undefined;

    // ── Description ──
    // NOTE: do NOT fall back to bare 'p' — the first <p> in the block is the
    // courseblocktitle, not the description. Stick to specific class selectors.
    const descEl = block.querySelector(
      ".courseblockdesc, .cb_desc, .course-description, .courseblock-desc"
    );
    const description = descEl
      ? descEl.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
      : "";

    // ── NUPath ──
    // Fallback source only: the catalog prints 11 of the 13 codes as
    // Attribute(s) lines and never WF or WD. Tableau is authoritative, and the
    // merge below keeps a previous non-empty nuPath rather than letting an
    // empty catalog read overwrite it.
    //
    // The line is a plain .courseblockextra with no distinguishing class, so
    // it has to be found by its label text — see findAttributeText().
    const nuPath = parseNUPath(findAttributeText(
      block.querySelectorAll(".courseblockextra, p").map(el => el.textContent)
    ));

    // ── Prereqs / coreqs (text extraction) ──
    const extraEls = block.querySelectorAll('.courseblockextra, p');
    let prereqText = '';
    let coreqText = '';

    for (const el of extraEls) {
      const text = el.textContent.replace(/\u00a0/g, ' ').trim();
      if (/prerequisite\(s\)\s*:/i.test(text)) {
        prereqText = text.replace(/.*prerequisite\(s\)\s*:\s*/i, '').trim();
      }
      if (/corequisite\(s\)\s*:/i.test(text)) {
        coreqText = text.replace(/.*corequisite\(s\)\s*:\s*/i, '').trim();
      }
    }

    // ── Extract concurrent courses from prereq text before parsing ──
    const { cleaned: cleanedPrereq, concurrent } = extractConcurrentCourses(prereqText);

    // ── Schedule type: explicit element → number suffix → title heuristic ──
    const scheduleType = (() => {
      const schedEl = block.querySelector('[class*="schedule"]');
      if (schedEl?.textContent.trim()) return schedEl.textContent.trim();
      if (/L$/i.test(number)) return "Lab";
      const t = rawTitle.toLowerCase();
      if (t.includes("lab")) return "Lab";
      if (t.includes("seminar")) return "Seminar";
      if (t.includes("studio")) return "Studio";
      if (t.includes("independent") || t.includes("directed study")) return "Individual Instruction";
      return "Lecture";
    })();

    // ── Repeatability: "May be repeated …" lives inside cb_desc (verified
    // against live pages — never a separate courseblockextra), so the
    // description text is its canonical source.
    const repeat = parseRepeatability(description);

    courses.push({
      subject,
      number,
      title,
      scheduleType,
      credits,
      ...(creditsMax !== undefined ? { creditsMax } : {}),
      ...(repeat ? {
        repeatable: true,
        ...(repeat.max   != null ? { repeatMax:   repeat.max }   : {}),
        ...(repeat.maxSH != null ? { repeatMaxSH: repeat.maxSH } : {}),
      } : {}),
      nuPath,
      sections: [],      // catalog has no section/term data
      description,
      coreqs:  [...(coreqText ? parseCoreqText(coreqText) : []), ...concurrent],
      // Only parse cleanedPrereq if it still contains course references after concurrent extraction
      prereqs: (cleanedPrereq && /[A-Z]{2,6}\s+\d{4}/.test(cleanedPrereq)) ? parsePrereqText(cleanedPrereq) : [],
    });
  }

  return courses;
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

  return [...urls.entries()]; // [[slug, url], ...]
}

// ── Field-level diff between two course objects ───────────────────────────────────
const DIFF_FIELDS = ["title", "credits", "creditsMax", "scheduleType", "description", "nuPath", "prereqs", "coreqs", "repeatable", "repeatMax", "repeatMaxSH"];

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

console.log("\nNU Catalog Scraper");
console.log("=".repeat(50));
if (DRY_RUN) console.log("  ⚠  DRY RUN — only first 3 subjects");
if (MERGE)   console.log("  MODE: merge into all-courses.json");

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
  if (existsSync(CATALOG_OUT)) {
    try {
      const prevCount = JSON.parse(readFileSync(CATALOG_OUT, "utf8")).length;
      const floor = Math.floor(prevCount * 0.98);
      if (prevCount > 0 && out.length < floor) {
        console.error(`\n❌  Refusing to write: ${out.length} courses vs ${prevCount} committed (floor ${floor}).`);
        console.error(`    The catalog is likely unreachable or its markup changed — nothing was written.\n`);
        process.exit(1);
      }
    } catch { /* ignore */ }
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

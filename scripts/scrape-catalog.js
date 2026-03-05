#!/usr/bin/env node
/**
 * scrape-catalog.js
 *
 * Scrapes course data from catalog.northeastern.edu — the canonical,
 * faculty-maintained source for titles, descriptions, NUPath designations,
 * and credit hours.
 *
 * Output:  public/catalog-courses.json    (standalone catalog snapshot)
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

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "..");
const ALL_COURSES    = resolve(ROOT, "public/all-courses.json");
const CATALOG_OUT    = resolve(ROOT, "public/catalog-courses.json");
const META_SRC_PATH  = resolve(ROOT, "src/core/dataMeta.json");
const META_PUB_PATH  = resolve(ROOT, "public/data-meta.json");
const STATE_PATH      = resolve(ROOT, "data/scrape-state.json");
const PUBLIC_STATE_PATH = resolve(ROOT, "public/scrape-state.json"); // served to dev portal
const CHANGE_LOG_PATH = resolve(ROOT, "public/change-log.json");
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

// ── NUPATH code map ───────────────────────────────────────────────────────────
// Maps catalog Attribute(s) text fragments → internal NUPath codes.
// Codes must match NUPATH_LABELS in src/core/constants.js exactly.
// The catalog uses slash-notation, e.g. "NUpath Natural/Designed World".
// Keep both slash and legacy "and" forms for resilience.
const NUPATH_MAP = {
  // ND — Natural/Designed World
  "natural/designed world":       "ND",
  "natural and designed world":   "ND",
  // FQ — Formal/Quant Reasoning
  "formal/quant":                 "FQ",
  "formal and quantitative":      "FQ",
  // SI — Societies/Institutions
  "societies/institutions":       "SI",
  "societies and institutions":   "SI",
  // IC — Interpreting Culture
  "interpreting culture":         "IC",
  "intellectual life":            "IC",   // legacy
  // EI — Creative Express/Innov
  "creative express":             "EI",
  "creative expression":          "EI",
  // ER — Ethical Reasoning
  "ethical reasoning":            "ER",
  "ethics and social justice":    "ER",
  // DD — Difference/Diversity
  "difference/diversity":         "DD",
  "differences and diversity":    "DD",
  // AD — Analyzing/Using Data  (NOT "advanced writing")
  "analyzing/using data":         "AD",
  "analyzing and using data":     "AD",
  // WF — 1st Yr Writing
  "1st yr writing":               "WF",
  "first.year writing":           "WF",
  // WD — Advanced Writing in the Disciplines
  "adv writing":                  "WD",
  "advanced writing in":          "WD",
  // WI — Writing Intensive
  "writing intensive":            "WI",
  // CE — Capstone Experience
  "capstone experience":          "CE",
  // EX — Integration/Experiential
  "integration experience":       "EX",
  "experiential learning":        "EX",
};

function parseNUPath(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [fragment, code] of Object.entries(NUPATH_MAP)) {
    if (lower.includes(fragment) && !found.includes(code)) found.push(code);
  }
  // Sort for stable output — order is irrelevant in the app but avoids noisy diffs
  return found.sort();
}

// ── Prerequisite text → structured array (best-effort) ───────────────────────
function parsePrereqText(text) {
  if (!text) return [];
  // Return the raw text wrapped so the UI can display it.
  // Full structured parsing mirrors all-courses.json prereq arrays and is
  // complex; for now return a single-element array with the raw string so
  // existing prereq UI still gets populated.
  return [text.trim()];
}

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
    const titleMatch = rawTitle.match(
      /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\.\s+(.+?)\.\s*\((\d+(?:[-–]\d+)?)\s+[Hh]ours?\)/
    ) || rawTitle.match(
      /^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\s+(.+?)\s+(\d+)\s+SH/i
    );

    if (!titleMatch) continue;

    const [, subject, number, title, credStr] = titleMatch;
    if (SUBJECT && subject !== SUBJECT) continue;

    // Parse credits — preserve ranges: store min in `credits` (matching SearchNEU convention)
    // and `creditsMax` only when different (variable-credit course, e.g. "1-4 Hours").
    const [cMin, cMax] = (credStr.includes("-") || credStr.includes("–"))
      ? credStr.split(/[-–]/).map(n => parseInt(n, 10))
      : [parseInt(credStr, 10), parseInt(credStr, 10)];
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
    const nuPathEl = block.querySelector(
      "[class*='nupath'], [class*='NUpath'], [class*='attribute']"
    );
    const nuPath = nuPathEl
      ? parseNUPath(nuPathEl.textContent)
      : parseNUPath(description);

    // ── Prereqs / coreqs (text extraction) ──
    let prereqText = "";
    let coreqText  = "";

    const extras = block.querySelectorAll(".courseblockextra, .cb_extra, .course-extras, p");
    for (const el of extras) {
      const t = el.textContent.toLowerCase();
      if (t.includes("prerequisite"))  prereqText = el.textContent.replace(/prerequisite[s]?(?:\(s\))?:?\s*/i, "").trim();
      if (t.includes("corequisite"))   coreqText  = el.textContent.replace(/corequisite[s]?(?:\(s\))?:?\s*/i,  "").trim();
    }

    // ── Schedule type heuristic ──
    const scheduleType = (() => {
      const t = description.toLowerCase() + rawTitle.toLowerCase();
      if (t.includes("lab")) return "Lab";
      if (t.includes("seminar")) return "Seminar";
      if (t.includes("studio")) return "Studio";
      if (t.includes("independent") || t.includes("directed study")) return "Individual Instruction";
      return "Lecture";
    })();

    courses.push({
      subject,
      number,
      title,
      scheduleType,
      credits,
      ...(creditsMax !== undefined ? { creditsMax } : {}),
      nuPath,
      sections: [],      // catalog has no section/term data
      description,
      coreqs:  coreqText  ? parsePrereqText(coreqText)  : [],
      prereqs: prereqText ? parsePrereqText(prereqText) : [],
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
const DIFF_FIELDS = ["title", "credits", "creditsMax", "scheduleType", "description", "nuPath", "prereqs", "coreqs"];

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

  // ── Verified-merge into all-courses.json ─────────────────────────────────
  // Strategy:
  //   - Existing course in catalog   → overlay catalog fields, preserve sections/terms, diff
  //   - New course only in catalog   → add with no sections (catalog stub)
  //   - Course in our data but gone from catalog → flag in log, KEEP in data (don't silently delete)
  if (!existsSync(ALL_COURSES)) {
    console.error("  ❌  all-courses.json not found — run data:fetch first.");
    process.exit(1);
  }

  const existing = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
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
        credits:      cat.credits      || prev.credits,
        // creditsMax: set when catalog shows a range, clear when fixed-credit, preserve existing if cat has no data
        ...(cat.creditsMax !== undefined
          ? { creditsMax: cat.creditsMax }
          : cat.credits != null
            ? {} // catalog confirms fixed credit — drop any stale creditsMax
            : prev.creditsMax !== undefined ? { creditsMax: prev.creditsMax } : {}),
        scheduleType: cat.scheduleType || prev.scheduleType,
        description:  cat.description  || prev.description,
        nuPath:       cat.nuPath?.length  ? cat.nuPath  : prev.nuPath,
        prereqs:      cat.prereqs?.length ? cat.prereqs : prev.prereqs,
        coreqs:       cat.coreqs?.length  ? cat.coreqs  : prev.coreqs,
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
  writeFileSync(ALL_COURSES, JSON.stringify(updated, null, 0), "utf8");
  console.log(`  ✅  Saved ${updated.length} courses → public/all-courses.json`);

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
  mkdirSync(resolve(ROOT, "data"), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
  console.log(`  ✅  State saved → data/scrape-state.json (nextIndex: ${state.nextIndex})`);

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

writeFileSync(CATALOG_OUT, JSON.stringify(allCourses, null, 0), "utf8");
console.log(`\n✅  Wrote catalog snapshot → public/catalog-courses.json`);

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
      credits:      cat.credits      || c.credits,
      ...(cat.creditsMax !== undefined
        ? { creditsMax: cat.creditsMax }
        : cat.credits != null ? {} : c.creditsMax !== undefined ? { creditsMax: c.creditsMax } : {}),
      scheduleType: cat.scheduleType || c.scheduleType,
      description:  cat.description  || c.description,
      nuPath:       cat.nuPath?.length ? cat.nuPath : c.nuPath,
      prereqs:      cat.prereqs?.length ? cat.prereqs : c.prereqs,
      coreqs:       cat.coreqs?.length  ? cat.coreqs  : c.coreqs,
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

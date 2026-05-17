#!/usr/bin/env node
/**
 * scrape-availability.js
 *
 * Queries Northeastern's official Banner SSB system (nubanner.neu.edu) for the
 * last two academic years (~8 terms) to build a per-course offering history.
 *
 * Output: public/northeastern/term-history.json
 *   {
 *     "CS3500": { "202510": true, "202530": false, "202610": true, ... },
 *     ...
 *   }
 *
 * Keys are Banner term codes (YYYY = AY end year; 10=Fall, 30=Spring,
 * 40=Summer 1, 60=Summer 2).  true = offered, false = not offered that term.
 *
 * Usage:
 *   node scripts/scrape-availability.js           # dry run — prints summary
 *   node scripts/scrape-availability.js --write   # write term-history.json
 *
 * Rate limiting: 500 ms between page requests by default.
 * Override: BANNER_DELAY_MS=200 node scripts/scrape-availability.js --write
 *
 * The session flow required by Banner SSB:
 *   1. GET /classSearch/getTerms  →  seed session cookies
 *   2. POST /term/search?mode=search  →  activate session for a specific term
 *   3. POST /classSearch/resetDataForm  →  clear prior search state
 *   4. GET /searchResults/searchResults  →  paginated course sections
 *   Repeat steps 2-4 for each term.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname }                         from "path";
import { fileURLToPath }                            from "url";

const __dirname      = dirname(fileURLToPath(import.meta.url));
const ROOT           = resolve(__dirname, "..");
const ALL_COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const HISTORY_OUT    = resolve(ROOT, "public/northeastern/term-history.json");

const BASE      = "https://nubanner.neu.edu/StudentRegistrationSsb/ssb";
const PAGE_SIZE = 500;
const DELAY_MS  = parseInt(process.env.BANNER_DELAY_MS || "500", 10);

// ── Term code logic ──────────────────────────────────────────────
// Banner YYYY = AY end year.  Suffixes: 10=Fall, 30=Spring, 40=Sum1, 60=Sum2.
// Fall of AY 2024-25 → code 202510  (YYYY=2025, suffix=10)
// Spring of AY 2024-25 → code 202530 (YYYY=2025, suffix=30)

const STANDARD_SUFFIXES = ["10", "30", "40", "60"];

/**
 * Return Banner term codes for the last `yearsBack` academic years,
 * sorted chronologically (ascending).
 * Today = May 2026 → currentAYEndYear = 2026
 * Returns terms from AY ending 2024 through AY ending 2026.
 */
function recentTermCodes(yearsBack = 2) {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const calYear = now.getFullYear();
  // AY end year: Sep-Dec → next calendar year; Jan-Aug → this calendar year
  const currentAYEnd = month >= 9 ? calYear + 1 : calYear;

  const codes = [];
  for (let ayEnd = currentAYEnd - yearsBack; ayEnd <= currentAYEnd; ayEnd++) {
    for (const suffix of STANDARD_SUFFIXES) {
      codes.push(`${ayEnd}${suffix}`);
    }
  }
  return codes.sort(); // lexicographic = chronological for Banner codes
}

// ── Cookie jar ───────────────────────────────────────────────────

let jar = {};

function parseCookies(raw) {
  if (!raw) return {};
  const headers = Array.isArray(raw) ? raw : [raw];
  const out = {};
  for (const h of headers) {
    const [pair] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const val  = pair.slice(eq + 1).trim();
    if (name) out[name] = val;
  }
  return out;
}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function updateJar(res) {
  const raw = res.headers.get("set-cookie");
  if (raw) Object.assign(jar, parseCookies(raw));
}

// ── Banner SSB requests ──────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTermList(max = 30) {
  const url = `${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=${max}`;
  const res = await fetch(url);
  updateJar(res);
  if (!res.ok) throw new Error(`getTerms HTTP ${res.status}`);
  return await res.json(); // [{ code, description }, ...]
}

async function activateTerm(termCode) {
  const res = await fetch(`${BASE}/term/search?mode=search`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader() },
    body:    `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  updateJar(res);
  if (!res.ok) throw new Error(`term/search HTTP ${res.status} for ${termCode}`);
}

async function resetForm() {
  const res = await fetch(`${BASE}/classSearch/resetDataForm`, {
    method:  "POST",
    headers: { "Cookie": cookieHeader() },
  });
  updateJar(res);
}

async function fetchPage(termCode, offset) {
  const url = `${BASE}/searchResults/searchResults` +
    `?txt_term=${termCode}&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}` +
    `&sortColumn=subjectDescription&sortDirection=asc`;
  const res = await fetch(url, { headers: { "Cookie": cookieHeader() } });
  updateJar(res);
  if (!res.ok) throw new Error(`searchResults HTTP ${res.status}`);
  return await res.json();
}

/**
 * Fetch all course IDs (subject+number) offered in a given term.
 * Returns a Set<string> of courseIds like "CS3500".
 */
async function fetchTermOfferings(termCode) {
  await activateTerm(termCode);
  await sleep(DELAY_MS);
  await resetForm();
  await sleep(DELAY_MS);

  const offered = new Set();
  let offset = 0;
  let totalCount = null;

  while (true) {
    let data;
    try {
      data = await fetchPage(termCode, offset);
    } catch (err) {
      console.warn(`  Page fetch failed at offset ${offset}: ${err.message} — stopping`);
      break;
    }

    if (!data.success) {
      console.warn(`  Banner returned success:false for ${termCode} at offset ${offset}`);
      break;
    }

    const sections = data.data ?? [];
    for (const s of sections) {
      const subject = (s.subject || "").toUpperCase().trim();
      const number  = (s.courseNumber || "").trim();
      if (subject && number) offered.add(`${subject}${number}`);
    }

    if (totalCount === null) totalCount = data.totalCount ?? 0;
    const fetched = data.sectionsFetchedCount ?? sections.length;
    if (fetched === 0 || offset + fetched >= totalCount) break;
    offset += PAGE_SIZE;
    await sleep(DELAY_MS);
  }

  return offered;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const doWrite = process.argv.includes("--write");

  // Load catalog so we only track courses the app knows about
  if (!existsSync(ALL_COURSES)) {
    console.error(`Catalog not found: ${ALL_COURSES}`);
    process.exit(1);
  }
  const catalog = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
  const catalogIds = new Set(
    catalog
      .filter(c => c.subject && c.number)
      .map(c => `${c.subject.toUpperCase().trim()}${c.number.trim()}`)
  );
  console.log(`Catalog: ${catalogIds.size} courses`);

  // Seed session cookies + fetch real term list from Banner
  console.log("\nFetching term list from Banner...");
  const termList = await getTermList(40);
  const bannerTermCodes = new Set(termList.map(t => t.code));
  console.log(`Banner has ${bannerTermCodes.size} terms available`);

  // Determine which standard terms to query (last 2 AYs, standard suffixes only)
  const desired = recentTermCodes(2);
  const toQuery = desired.filter(code => bannerTermCodes.has(code));

  if (toQuery.length === 0) {
    console.error("No matching terms found in Banner. Check term code logic.");
    process.exit(1);
  }

  console.log(`\nQuerying ${toQuery.length} terms:`);
  for (const code of toQuery) {
    const meta = termList.find(t => t.code === code);
    console.log(`  ${code}  ${meta?.description ?? "(no description)"}`);
  }

  // Query each term
  const termResults = {}; // termCode → Set<courseId>
  for (const termCode of toQuery) {
    const meta = termList.find(t => t.code === termCode);
    process.stdout.write(`\n[${termCode}] ${meta?.description ?? ""} — `);
    try {
      const offered = await fetchTermOfferings(termCode);
      termResults[termCode] = offered;
      console.log(`${offered.size} courses`);
    } catch (err) {
      console.warn(`FAILED: ${err.message}`);
      termResults[termCode] = new Set();
    }
    await sleep(DELAY_MS);
  }

  // Build term-history: only for courses in our catalog
  const termHistory = {};
  for (const courseId of catalogIds) {
    const hist = {};
    for (const termCode of toQuery) {
      hist[termCode] = termResults[termCode]?.has(courseId) ?? false;
    }
    // Only store if the course appeared in at least one queried term
    if (Object.values(hist).some(Boolean)) {
      termHistory[courseId] = hist;
    }
  }

  // Summary
  const covered = Object.keys(termHistory).length;
  const total   = catalogIds.size;
  const uncovered = total - covered;
  console.log(`\n── Summary ──────────────────────────────────────`);
  console.log(`Terms queried: ${toQuery.length}`);
  console.log(`Courses with history: ${covered} / ${total}`);
  if (uncovered > 0) {
    console.log(`Courses with no Banner history (catalog-only): ${uncovered}`);
  }

  // Per-term offering counts
  for (const termCode of toQuery) {
    const meta    = termList.find(t => t.code === termCode);
    const count   = termResults[termCode]?.size ?? 0;
    const matched = Object.values(termHistory).filter(h => h[termCode]).length;
    console.log(`  ${termCode}  ${(meta?.description ?? "").padEnd(28)}  ${count} Banner sections  /  ${matched} in catalog`);
  }

  if (doWrite) {
    writeFileSync(HISTORY_OUT, JSON.stringify(termHistory, null, 2));
    console.log(`\nWrote ${HISTORY_OUT}`);
  } else {
    console.log("\nDry run — pass --write to save term-history.json");
  }
}

main().catch(err => { console.error(err); process.exit(1); });

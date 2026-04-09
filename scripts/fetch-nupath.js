#!/usr/bin/env node
/**
 * fetch-nupath.js
 *
 * Updates the nuPath field for every course in public/northeastern/all-courses.json by
 * pulling from the official NUpath source.
 *
 * Strategy (tried in order):
 *   1. Tableau CSV download — the official NUpath Attributes dashboard run by
 *      the Registrar at tableau.northeastern.edu.  Returns a CSV mapping each
 *      CRN/course to its NUpath attribute(s).  Works without auth when the
 *      view is public; sets the nuPath array authoritatively.
 *
 *   2. Catalog HTML scrape — falls back to catalog.northeastern.edu, which is
 *      the primary source that the Registrar's Tableau dashboard is itself
 *      built from.  Scrapes all subjects in parallel (concurrency-limited) and
 *      re-uses the same NUPATH_MAP logic as scrape-catalog.js.
 *
 * Usage:
 *   node scripts/fetch-nupath.js               # dry run — shows diff
 *   node scripts/fetch-nupath.js --write        # write public/northeastern/all-courses.json
 *   node scripts/fetch-nupath.js --catalog      # force catalog strategy
 *   node scripts/fetch-nupath.js --tableau      # force Tableau strategy (errors if unavailable)
 *   node scripts/fetch-nupath.js --concurrency 8  # catalog parallel workers (default 6)
 *
 * After writing, run apply-patches.js to re-apply any manual corrections.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseHTML } from "node-html-parser";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "..");
const COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const CHANGE_LOG = resolve(ROOT, "public/northeastern/change-log.json");

const CHANGE_LOG_MAX = 600;

function appendLogEntry(entry) {
  try {
    const log = existsSync(CHANGE_LOG)
      ? JSON.parse(readFileSync(CHANGE_LOG, "utf8"))
      : { runs: [] };
    if (!Array.isArray(log.runs)) log.runs = [];
    log.runs.unshift(entry);
    if (log.runs.length > CHANGE_LOG_MAX) log.runs = log.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(log, null, 2) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

const WRITE        = process.argv.includes("--write");
const FORCE_CAT    = process.argv.includes("--catalog");
const FORCE_TAB    = process.argv.includes("--tableau");
const USE_PLAYWRIGHT = !FORCE_CAT; // use Playwright when not forced to catalog-only
const CONC_IDX     = process.argv.indexOf("--concurrency");
const CONCURRENCY  = CONC_IDX !== -1 ? parseInt(process.argv[CONC_IDX + 1], 10) : 6;
const DELAY_MS     = parseInt(process.env.NUPATH_DELAY_MS ?? "300", 10);

const TABLEAU_BASE  = "https://tableau.northeastern.edu";
const TABLEAU_SITE  = "Registrar";
const TABLEAU_WB    = "NUpathAttributes";
const TABLEAU_VIEW  = "NUpathAttribute";
const CATALOG_BASE  = "https://catalog.northeastern.edu";
const CATALOG_INDEX = `${CATALOG_BASE}/course-descriptions/`;

// ── NUPath code map (kept in sync with scrape-catalog.js / constants.js) ─────
const NUPATH_MAP = {
  "natural/designed world":       "ND",
  "natural and designed world":   "ND",
  "formal/quant":                 "FQ",
  "formal and quantitative":      "FQ",
  "societies/institutions":       "SI",
  "societies and institutions":   "SI",
  "interpreting culture":         "IC",
  "intellectual life":            "IC",
  "creative express":             "EI",
  "creative expression":          "EI",
  "ethical reasoning":            "ER",
  "ethics and social justice":    "ER",
  "difference/diversity":         "DD",
  "differences and diversity":    "DD",
  "analyzing/using data":         "AD",
  "analyzing and using data":     "AD",
  "1st yr writing":               "WF",
  "first.year writing":           "WF",
  "adv writing":                  "WD",
  "advanced writing in":          "WD",
  "writing intensive":            "WI",
  "capstone experience":          "CE",
  "integration experience":       "EX",
  "experiential learning":        "EX",
};

function parseNUPath(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [fragment, code] of Object.entries(NUPATH_MAP)) {
    if (lower.includes(fragment) && !found.includes(code)) found.push(code);
  }
  return found.sort();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchText(url, headers = {}) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "NU-Map-NUpathBot/1.0 (academic degree planner; contact nayugu@github)",
      Accept: "text/html,text/csv,application/csv,*/*",
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

// ── Strategy 1a: Tableau REST API (guest auth) ───────────────────────────────
//
// Tableau Server exposes a REST API. For public sites, guest auth (empty
// credentials) returns a token that can download view data as CSV.
// Site ID sourced from the official embed snippet on the Registrar page.

const TABLEAU_SITE_ID = "fa2c3643-d73c-40e1-b43c-06e38c98065d";
const TABLEAU_API     = `${TABLEAU_BASE}/api/3.20`;

async function fetchTableauRestApi() {
  const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // Step 1: authenticate as guest
  console.log("  Trying Tableau REST API (guest auth)…");
  let token, siteId;
  try {
    const authRes = await fetch(`${TABLEAU_API}/auth/signin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": BROWSER_UA },
      body: JSON.stringify({ credentials: { name: "", password: "", site: { contentUrl: TABLEAU_SITE } } }),
    });
    if (!authRes.ok) { console.log(`    ↳ Guest auth failed: HTTP ${authRes.status}`); return null; }
    const data = await authRes.json();
    token  = data.credentials?.token;
    siteId = data.credentials?.site?.id ?? TABLEAU_SITE_ID;
    if (!token) { console.log("    ↳ No token in auth response"); return null; }
    console.log(`    ↳ Authenticated (token length ${token.length})`);
  } catch (err) {
    console.log(`    ↳ Auth request failed: ${err.message}`);
    return null;
  }

  const authHeaders = { "X-Tableau-Auth": token, "User-Agent": BROWSER_UA };

  // Step 2: find the view LUID
  let viewId;
  try {
    const viewsRes = await fetch(
      `${TABLEAU_API}/sites/${siteId}/views?filter=name:eq:${TABLEAU_VIEW}`,
      { headers: { ...authHeaders, Accept: "application/json" } },
    );
    if (!viewsRes.ok) { console.log(`    ↳ Views query failed: HTTP ${viewsRes.status}`); return null; }
    const data = await viewsRes.json();
    viewId = data.views?.view?.[0]?.id;
    if (!viewId) { console.log(`    ↳ View '${TABLEAU_VIEW}' not found in site`); return null; }
    console.log(`    ↳ Found view: ${viewId}`);
  } catch (err) {
    console.log(`    ↳ Views query error: ${err.message}`);
    return null;
  }

  // Step 3: download view data as CSV
  try {
    const dataRes = await fetch(`${TABLEAU_API}/sites/${siteId}/views/${viewId}/data`, {
      headers: { ...authHeaders, Accept: "text/csv" },
    });
    if (!dataRes.ok) { console.log(`    ↳ Data download failed: HTTP ${dataRes.status}`); return null; }
    const csv = await dataRes.text();
    const result = parseTableauCsv(csv);
    if (result.size === 0) { console.log("    ↳ Downloaded CSV but parsed 0 mappings"); return null; }
    console.log(`    ↳ ✅ Got ${result.size} mappings via REST API`);
    return result;
  } catch (err) {
    console.log(`    ↳ Data download error: ${err.message}`);
    return null;
  }
}

// ── Strategy 1b: Tableau CSV direct download (with session cookie) ────────────
//
// Some Tableau Server deployments serve public CSVs at the .csv URL.
// We first load the embed URL to acquire a guest session cookie.

async function fetchTableauCsvDirect() {
  const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // Acquire session cookie from embed URL
  let sessionCookie = "";
  try {
    const embedUrl = `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}?:embed=y&:isGuestRedirectFromVizportal=y`;
    const sessRes  = await fetch(embedUrl, { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" });
    const raw = sessRes.headers.get("set-cookie") ?? "";
    // Extract all name=value pairs
    sessionCookie = raw.split(",")
      .map(s => s.trim().split(";")[0])
      .filter(Boolean)
      .join("; ");
  } catch { /* session cookie optional */ }

  const headers = {
    "User-Agent": BROWSER_UA,
    Accept: "text/csv,application/csv,*/*",
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
  };

  const urls = [
    `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}.csv?:size=1920,1080`,
    `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}.csv`,
    `${TABLEAU_BASE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}.csv`,
  ];

  for (const url of urls) {
    try {
      console.log(`  Trying direct CSV: ${url.replace(TABLEAU_BASE, "")}`);
      const res = await fetch(url, { headers });
      if (!res.ok) { console.log(`    ↳ HTTP ${res.status}`); continue; }
      const csv = await res.text();
      if (!csv.includes(",") || csv.trim().split("\n").length < 2) {
        console.log("    ↳ Response doesn't look like CSV"); continue;
      }
      const result = parseTableauCsv(csv);
      if (result.size === 0) { console.log("    ↳ Parsed 0 mappings"); continue; }
      console.log(`    ↳ ✅ Got ${result.size} mappings via direct CSV`);
      return result;
    } catch (err) {
      console.log(`    ↳ Failed: ${err.message}`);
    }
  }
  return null;
}

/**
 * Parse Tableau CSV export into a Map of "SUBJECT NUMBER" → string[]
 *
 * The Tableau NUpath dashboard uses a WIDE format:
 *   "Advanced Writing Ind.", "Analyzing/Using Data Ind.", …, "Course ID ", "Subject Code", …
 *
 * Each row is one course; indicator columns are Y or N.
 * "Course ID " already contains the "SUBJ NUM" key (e.g. "ACCT 2301").
 *
 * We detect indicator columns dynamically by their " Ind." suffix and map
 * each column name through NUPATH_MAP to get the 2-letter code.
 */

// Maps fragments of indicator column names → NUpath codes
// (subset of NUPATH_MAP, tuned to the exact Tableau column names)
const INDICATOR_FRAGMENT_MAP = {
  "advanced writing":      "WD",
  "adv writing":           "WD",
  "analyzing/using data":  "AD",
  "analyzing and using":   "AD",
  "capstone":              "CE",
  "creative express":      "EI",
  "difference/diversity":  "DD",
  "ethical reasoning":     "ER",
  "formal/quant":          "FQ",
  "integration experience":"EX",
  "interpreting culture":  "IC",
  "natural/designed world":"ND",
  "societies/institutions":"SI",
  "writing intensive":     "WI",
  "1st yr writing":        "WF",
  "first year writing":    "WF",
  "first.year writing":    "WF",
};

function indicatorColToCode(colName) {
  const lower = colName.toLowerCase().replace(/ ind\.?\s*$/, "").trim();
  for (const [frag, code] of Object.entries(INDICATOR_FRAGMENT_MAP)) {
    if (lower.includes(frag)) return code;
  }
  return null;
}

function parseTableauCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();

  const header = parseCsvLine(lines[0]).map((h) => h.trim());

  // Find "Course ID" column (already formatted as "SUBJ NUM")
  const courseIdCol = header.findIndex((h) => h.toLowerCase().startsWith("course id"));

  if (courseIdCol === -1) {
    console.log(`    ↳ Could not find 'Course ID' column.`);
    console.log(`       Headers: ${header.join(" | ")}`);
    return new Map();
  }

  // Detect indicator columns and map them to NUpath codes
  const indicatorCols = []; // { index, code }
  for (let i = 0; i < header.length; i++) {
    if (!header[i].toLowerCase().endsWith("ind.") && !header[i].toLowerCase().endsWith("ind")) continue;
    const code = indicatorColToCode(header[i]);
    if (code) indicatorCols.push({ index: i, code });
  }

  if (indicatorCols.length === 0) {
    console.log(`    ↳ Found no indicator columns (expected columns ending in 'Ind.')`);
    return new Map();
  }
  console.log(`    ↳ Detected ${indicatorCols.length} indicator columns: ${indicatorCols.map(c => c.code).join(", ")}`);

  // Build map — OR across multiple rows for the same Course ID
  const grouped = new Map(); // "SUBJ NUM" → Set<code>

  for (let i = 1; i < lines.length; i++) {
    const cols    = parseCsvLine(lines[i]);
    const courseId = cols[courseIdCol]?.trim().toUpperCase();
    if (!courseId) continue;

    if (!grouped.has(courseId)) grouped.set(courseId, new Set());
    const codeSet = grouped.get(courseId);
    for (const { index, code } of indicatorCols) {
      if (cols[index]?.trim().toUpperCase() === "Y") codeSet.add(code);
    }
  }

  const result = new Map();
  for (const [key, codeSet] of grouped) {
    result.set(key, [...codeSet].sort());
  }
  return result;
}

function findCol(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex((h) => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseCsvLine(line) {
  // Handle quoted fields with commas inside
  const result = [];
  let cur = "";
  let inQ  = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

// ── Strategy 1c: Playwright + Tableau Embedding API v3 ───────────────────────
//
// Uses the same official SDK as the Registrar's embed code:
//   <script src="tableau.embedding.3.latest.min.js">
//   <tableau-viz src="…/NUpathAttributes/NUpathAttribute">
//
// After firstinteractive fires we call getSummaryDataAsync({ maxRows: 0 })
// which returns all rows as structured columns + values — no button-clicking
// or DOM scraping needed.
//
// Playwright is an optional dependency; returns null if not installed.

async function fetchTableauWithPlaywright() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null; // Playwright not installed — skip
  }

  const EMBED_SDK = `${TABLEAU_BASE}/javascripts/api/tableau.embedding.3.latest.min.js`;
  const VIZ_SRC   = `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}`;

  console.log(`  Playwright: loading Tableau Embedding API v3…`);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext();
    const page    = await context.newPage();

    // Build a minimal host page that loads the official SDK and the viz
    const html = `<!DOCTYPE html>
<html>
<head>
  <script type="module" src="${EMBED_SDK}"></script>
</head>
<body>
  <tableau-viz
    id="viz"
    src="${VIZ_SRC}"
    hide-tabs
    toolbar="hidden"
  ></tableau-viz>
  <script type="module">
    const viz = document.getElementById('viz');

    async function extractSheet(ws) {
      const dt = await ws.getSummaryDataAsync({ maxRows: 0, ignoreAliases: false });
      return {
        name:    ws.name,
        columns: dt.columns.map(c => c.fieldName),
        rows:    dt.data.map(row => row.map(v => v.formattedValue)),
      };
    }

    viz.addEventListener('firstinteractive', async () => {
      try {
        const sheet = viz.workbook.activeSheet;
        const sheets = sheet.sheetType === 'dashboard'
          ? sheet.worksheets
          : [sheet];
        const results = [];
        for (const ws of sheets) {
          results.push(await extractSheet(ws));
        }
        window._tableau_result = results;
      } catch (e) {
        window._tableau_error = e.message;
      }
    });
  </script>
</body>
</html>`;

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    console.log("    ↳ Waiting for firstinteractive (up to 120s)…");
    await page.waitForFunction(
      () => window._tableau_result !== undefined || window._tableau_error !== undefined,
      { timeout: 120_000, polling: 2_000 },
    );

    const { result, error } = await page.evaluate(() => ({
      result: window._tableau_result,
      error:  window._tableau_error,
    }));

    await browser.close();

    if (error) {
      console.log(`    ↳ Tableau API error: ${error}`);
      return null;
    }
    if (!result?.length) {
      console.log("    ↳ No data returned");
      return null;
    }

    // Find the sheet with recognizable NUpath columns
    for (const sheet of result) {
      const colsLower = sheet.columns.map(c => c.toLowerCase());
      const subjIdx   = findCol(colsLower, ["subject", "subj"]);
      const numIdx    = findCol(colsLower, ["catalog number", "course number", "catalog nbr", "crse nmbr", "number", "nbr"]);
      const attrIdx   = findCol(colsLower, ["attribute description", "attribute", "nupath", "np attribute", "crse attr description"]);

      console.log(`    ↳ Sheet "${sheet.name}": ${sheet.rows.length} rows | cols: ${sheet.columns.slice(0, 6).join(", ")}`);

      if (subjIdx === -1 || numIdx === -1 || attrIdx === -1) {
        console.log(`    ↳ Skipping — could not identify subject/number/attribute columns`);
        continue;
      }

      const grouped = new Map();
      for (const row of sheet.rows) {
        const subj = row[subjIdx]?.toUpperCase()?.trim();
        const num  = row[numIdx]?.trim();
        const attr = row[attrIdx]?.trim() ?? "";
        if (!subj || !num) continue;
        const key = `${subj} ${num}`;
        const codes = parseNUPath(attr);
        if (!grouped.has(key)) grouped.set(key, new Set());
        codes.forEach(c => grouped.get(key).add(c));
      }

      const mapped = new Map();
      for (const [key, codeSet] of grouped) mapped.set(key, [...codeSet].sort());

      if (mapped.size > 0) {
        console.log(`    ↳ ✅ Got ${mapped.size} mappings from sheet "${sheet.name}"`);
        return mapped;
      }
    }

    console.log("    ↳ No sheets had recognizable NUpath data");
    return null;
  } catch (err) {
    await browser.close().catch(() => {});
    console.log(`    ↳ Playwright error: ${err.message}`);
    return null;
  }
}

// ── Strategy 2: Catalog HTML scrape ──────────────────────────────────────────

async function getSubjectURLs() {
  const html = await fetchText(CATALOG_INDEX);
  const root = parseHTML(html);
  const urls = new Map();

  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    const m    = href.match(/\/course-descriptions\/([a-z0-9-]+)\/?$/i);
    if (!m) continue;
    const slug = m[1].toUpperCase().replace(/-/g, " ");
    const url  = href.startsWith("http") ? href : CATALOG_BASE + href;
    if (!urls.has(slug)) urls.set(slug, url);
  }

  if (urls.size === 0) throw new Error("No subject links found in catalog index.");
  return [...urls.entries()];
}

function extractNuPathFromPage(html, subjectCode) {
  const root   = parseHTML(html);
  const blocks = root.querySelectorAll(".courseblock, [class*='courseblock']");
  const result = new Map(); // "SUBJ NUM" → string[]

  for (const block of blocks) {
    const titleEl = block.querySelector(".courseblocktitle, .cb_title, .course-title, h3");
    if (!titleEl) continue;
    const rawTitle = titleEl.textContent.replace(/\u00a0/g, " ").trim();
    const m = rawTitle.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)[\.\s]/);
    if (!m) continue;
    const [, subject, number] = m;
    if (subjectCode && subject !== subjectCode) continue;

    // NUPath: try dedicated attribute element first, fall back to description
    const nuPathEl  = block.querySelector("[class*='nupath'], [class*='NUpath'], [class*='attribute']");
    const descEl    = block.querySelector(".courseblockdesc, .cb_desc, .course-description, .courseblock-desc");
    const attrText  = nuPathEl?.textContent ?? descEl?.textContent ?? "";
    const nuPath    = parseNUPath(attrText);

    result.set(`${subject} ${number}`, nuPath);
  }
  return result;
}

async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length).fill(null);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
      await sleep(DELAY_MS);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchCatalogData() {
  console.log(`  Fetching subject list from ${CATALOG_INDEX}…`);
  let subjectURLs;
  try {
    subjectURLs = await getSubjectURLs();
  } catch (err) {
    throw new Error(`Cannot reach catalog: ${err.message}`);
  }
  console.log(`  Found ${subjectURLs.length} subjects — scraping with concurrency ${CONCURRENCY}…`);

  const allNuPaths = new Map(); // "SUBJ NUM" → string[]

  // Track progress
  let done = 0;
  const total = subjectURLs.length;
  const TICK = Math.max(1, Math.floor(total / 20)); // log every ~5%

  const tasks = subjectURLs.map(([slug, url]) => async () => {
    const subjectCode = slug.split(/\s/)[0];
    try {
      const html   = await fetchText(url);
      const parsed = extractNuPathFromPage(html, subjectCode);
      for (const [key, codes] of parsed) allNuPaths.set(key, codes);
    } catch (err) {
      console.warn(`    ⚠ ${slug}: ${err.message}`);
    }
    done++;
    if (done % TICK === 0 || done === total) {
      process.stdout.write(`\r  Progress: ${done}/${total} subjects`);
    }
  });

  await runConcurrent(tasks, CONCURRENCY);
  process.stdout.write("\n");
  return allNuPaths;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\nNU-Map NUpath Updater");
console.log("=".repeat(50));

if (!existsSync(COURSES)) {
  console.error("❌  public/all-courses.json not found — run  npm run data:fetch  first.");
  process.exit(1);
}

const courses = JSON.parse(readFileSync(COURSES, "utf8"));
console.log(`Loaded ${courses.length.toLocaleString()} courses from all-courses.json`);

// ── Acquire NUpath data ───────────────────────────────────────────────────────

let nuPathSource;
let nuPathMap; // Map<"SUBJ NUM", string[]>

if (!FORCE_CAT) {
  // ── Try 1: Tableau REST API (guest auth → view LUID → CSV download) ──────
  console.log("\n[1] Trying Tableau REST API (guest auth)…");
  nuPathMap = await fetchTableauRestApi();
  if (nuPathMap) nuPathSource = "Tableau REST API";

  // ── Try 2: Tableau direct CSV download (with session cookie) ─────────────
  if (!nuPathMap) {
    console.log("\n[2] Trying Tableau direct CSV download…");
    nuPathMap = await fetchTableauCsvDirect();
    if (nuPathMap) nuPathSource = "Tableau CSV (direct)";
  }

  // ── Try 3: Playwright + Tableau Embedding API v3 ──────────────────────────
  if (!nuPathMap && USE_PLAYWRIGHT) {
    console.log("\n[3] Trying Playwright + Tableau Embedding API v3…");
    nuPathMap = await fetchTableauWithPlaywright();
    if (nuPathMap) {
      nuPathSource = "Tableau (Embedding API v3)";
    } else {
      console.log("  ↳ All Tableau strategies exhausted.");
    }
  }
}

if (!nuPathMap) {
  if (FORCE_TAB) {
    console.error("❌  --tableau specified but Tableau could not be reached via any method.");
    process.exit(1);
  }
  console.log("\n[3] Falling back to catalog.northeastern.edu HTML scrape…");
  nuPathMap = await fetchCatalogData();
  nuPathSource = "catalog.northeastern.edu";
}

console.log(`\nSource: ${nuPathSource}`);
console.log(`NUpath mappings fetched: ${nuPathMap.size.toLocaleString()}`);

// ── Merge NUpath into courses ─────────────────────────────────────────────────

const courseKey = (c) => `${c.subject} ${c.number}`;

let changed    = 0;
let cleared    = 0; // had nuPath, now catalog says none
let unchanged  = 0;
let notInMap   = 0;

// Collect discrepancies for change-log (mirrors catalog-check-server format)
const discrepancies = []; // { subject, number, oldNuPath, newNuPath, added, removed }

const updated = courses.map((c) => {
  const key      = courseKey(c);
  const freshNP  = nuPathMap.get(key);

  if (freshNP === undefined) {
    notInMap++;
    return c; // not covered by source — leave as-is
  }

  const oldArr   = c.nuPath ?? [];
  const oldNP    = JSON.stringify(oldArr);
  const newNP    = JSON.stringify(freshNP);

  if (oldNP === newNP) {
    unchanged++;
    return c;
  }

  if (oldArr.length > 0 && freshNP.length === 0) cleared++;
  changed++;

  const added   = freshNP.filter((x) => !oldArr.includes(x));
  const removed = oldArr.filter((x) => !freshNP.includes(x));
  discrepancies.push({ subject: c.subject, number: c.number, oldNuPath: oldArr, newNuPath: freshNP, added, removed });

  return { ...c, nuPath: freshNP };
});

// ── Report ────────────────────────────────────────────────────────────────────

const sep = "─".repeat(50);
console.log(`\n${sep}`);
console.log("  NUPATH DIFF SUMMARY");
console.log(sep);
console.log(`  ~ Changed   : ${changed}`);
console.log(`    (cleared) : ${cleared}  ← had nuPath, catalog now says none`);
console.log(`  = Unchanged : ${unchanged}`);
console.log(`  ? Not in map: ${notInMap}  ← source didn't include this course`);
console.log(sep);

// Show first 30 changes
if (changed > 0) {
  console.log("\nSample changes (first 30):");
  let shown = 0;
  for (let i = 0; i < courses.length && shown < 30; i++) {
    const c   = courses[i];
    const key = courseKey(c);
    const fp  = nuPathMap.get(key);
    if (fp === undefined) continue;
    if (JSON.stringify(c.nuPath ?? []) === JSON.stringify(fp)) continue;
    const from = JSON.stringify(c.nuPath ?? []);
    const to   = JSON.stringify(fp);
    console.log(`  ${key.padEnd(14)}  ${from.padEnd(20)} → ${to}`);
    shown++;
  }
  if (changed > 30) console.log(`  … and ${changed - 30} more changes`);
}

// ── Write ─────────────────────────────────────────────────────────────────────

if (!WRITE) {
  console.log(`\n📋  DRY RUN — no files written.`);
  console.log(`    Re-run with --write to save.\n`);
  console.log(`    Next step after writing:\n    node scripts/apply-patches.js --write\n`);
} else {
  writeFileSync(COURSES, JSON.stringify(updated, null, 0), "utf8");
  console.log(`\n✅  Saved ${updated.length.toLocaleString()} courses → public/all-courses.json`);
  console.log(`    (${changed} nuPath values updated from ${nuPathSource})`);
  console.log(`    Next step: node scripts/apply-patches.js --write\n`);

  // ── Log to change-log.json (read by dev portal; also committed by GHA) ───
  appendLogEntry({
    type:      "nupath-auto-update",
    subject:   "🤖 NUpath Auto-Update",
    timestamp: new Date().toISOString(),
    source:    nuPathSource,
    triggeredBy: process.env.GITHUB_ACTOR ?? "local",
    runId:     process.env.GITHUB_RUN_ID  ?? null,
    stats: {
      scanned:    nuPathMap.size,
      changed,
      cleared,
      unchanged,
      notInMap,
      gained:     discrepancies.reduce((s, x) => s + x.added.length,   0),
      lost:       discrepancies.reduce((s, x) => s + x.removed.length, 0),
      gainedOnly: discrepancies.filter((x) => x.added.length  > 0 && x.removed.length === 0).length,
      lostOnly:   discrepancies.filter((x) => x.removed.length > 0 && x.added.length  === 0).length,
      mixed:      discrepancies.filter((x) => x.added.length  > 0 && x.removed.length > 0).length,
    },
    discrepancies: discrepancies.slice(0, 200), // cap to avoid bloating log
  });
  console.log(`    Logged nupath-auto-update entry to change-log.json`);
}

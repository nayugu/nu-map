#!/usr/bin/env node
/**
 * fetch-nupath.js
 *
 * Updates the nuPath field for every course in public/all-courses.json by
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
 *   node scripts/fetch-nupath.js --write        # write public/all-courses.json
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
const COURSES    = resolve(ROOT, "public/all-courses.json");
const CHANGE_LOG = resolve(ROOT, "public/change-log.json");

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

// ── Strategy 1: Tableau CSV download ─────────────────────────────────────────
//
// Tableau Server exposes CSV downloads for public views at:
//   /t/{site}/views/{workbook}/{view}.csv
//
// The dashboard shows columns like:
//   Subject, Course Number, Course Name, NUpath Attribute
//
// We try two URL patterns (with and without the site prefix) and also attempt
// to bootstrap a guest session first (some TS deployments need a cookie).

async function fetchTableauData() {
  const urls = [
    `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}.csv`,
    `${TABLEAU_BASE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}.csv`,
  ];

  // Try to get a guest session cookie from the embed URL
  let sessionCookie = "";
  try {
    const embedUrl = `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}?:embed=y&:isGuestRedirectFromVizportal=y`;
    const sessRes = await fetch(embedUrl, {
      headers: { "User-Agent": "NU-Map-NUpathBot/1.0" },
      redirect: "follow",
    });
    const setCookie = sessRes.headers.get("set-cookie");
    if (setCookie) sessionCookie = setCookie.split(";")[0];
  } catch {
    // ignore — session cookie is optional
  }

  const extraHeaders = sessionCookie ? { Cookie: sessionCookie } : {};

  for (const url of urls) {
    try {
      console.log(`  Trying Tableau CSV: ${url}`);
      const csv = await fetchText(url, extraHeaders);

      // Validate: should look like CSV with at least a header row
      if (!csv.includes(",") || csv.trim().split("\n").length < 2) {
        console.log("    ↳ Response doesn't look like valid CSV — skipping");
        continue;
      }

      const nuPathMap = parseTableauCsv(csv);
      if (nuPathMap.size === 0) {
        console.log("    ↳ Parsed 0 course→NUpath mappings — skipping");
        continue;
      }

      console.log(`    ↳ ✅ Got ${nuPathMap.size} course NUpath mappings from Tableau`);
      return nuPathMap;
    } catch (err) {
      console.log(`    ↳ Failed: ${err.message}`);
    }
  }

  return null; // signal failure
}

/**
 * Parse Tableau CSV export into a Map of "SUBJECT NUMBER" → string[]
 *
 * The Tableau NUpath dashboard typically has columns like:
 *   "Subject", "Catalog Number", "Long Title", "Attribute Description"
 * or similar.  We detect column positions by header names.
 */
function parseTableauCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());

  // Find subject and course-number columns (flexible naming)
  const subjectCol  = findCol(header, ["subject", "subj"]);
  const numberCol   = findCol(header, ["catalog number", "course number", "catalog nbr", "number", "nbr"]);
  const attrCol     = findCol(header, ["attribute description", "attribute", "nupath", "np attribute"]);

  if (subjectCol === -1 || numberCol === -1 || attrCol === -1) {
    console.log(`    ↳ Could not identify required columns.`);
    console.log(`       Headers found: ${header.join(" | ")}`);
    return new Map();
  }

  // Group rows by course key — one row per attribute per course
  const grouped = new Map(); // "SUBJ NUM" → Set<code>

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const subj = cols[subjectCol]?.trim().toUpperCase();
    const num  = cols[numberCol]?.trim();
    const attr = cols[attrCol]?.trim() ?? "";
    if (!subj || !num) continue;

    const key   = `${subj} ${num}`;
    const codes = parseNUPath(attr);
    if (!grouped.has(key)) grouped.set(key, new Set());
    codes.forEach((c) => grouped.get(key).add(c));
  }

  // Convert to sorted arrays
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

// ── Strategy 1b: Tableau via Playwright (browser automation) ─────────────────
//
// Used when the plain CSV download requires authentication.  Launches a headless
// Chromium browser, loads the Tableau dashboard, and either:
//   (a) triggers the built-in download button to get a CSV, or
//   (b) reads the rendered HTML table from the DOM.
//
// Playwright is an optional dependency — if not installed the function returns
// null and the catalog HTML strategy is used instead.

async function fetchTableauWithPlaywright() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null; // Playwright not installed — skip
  }

  const TABLEAU_URL =
    `${TABLEAU_BASE}/t/${TABLEAU_SITE}/views/${TABLEAU_WB}/${TABLEAU_VIEW}` +
    `?:embed=y&:isGuestRedirectFromVizportal=y`;

  console.log(`  Playwright: loading ${TABLEAU_URL}`);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page    = await context.newPage();

    // ── Intercept Tableau bootstrap to grab session cookie ────────────────
    let sessionCookie = "";
    page.on("response", async (res) => {
      if (res.url().includes("bootstrapSession") && res.status() === 200) {
        const cookies = await context.cookies();
        sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      }
    });

    // ── Navigate and wait for Tableau to render ───────────────────────────
    await page.goto(TABLEAU_URL, { waitUntil: "networkidle", timeout: 90_000 });
    // Extra buffer — Tableau renders asynchronously after network idle
    await page.waitForTimeout(8_000);

    // ── Attempt 1: click the Download button to get CSV ───────────────────
    const downloadSelectors = [
      '[data-tb-test-id="Download-Button"]',
      'button[title="Download"]',
      'button[aria-label="Download"]',
      ".tab-icon-download",
    ];
    let downloadBtn = null;
    for (const sel of downloadSelectors) {
      downloadBtn = await page.$(sel);
      if (downloadBtn) break;
    }

    if (downloadBtn) {
      await downloadBtn.click();
      await page.waitForTimeout(1_000);

      // Click the "Data" sub-option
      const dataSelectors = [
        '[data-tb-test-id="DownloadData-Button"]',
        '[aria-label*="Data"]',
        'a:has-text("Data")',
        'li:has-text("Data")',
      ];
      for (const sel of dataSelectors) {
        const dataBtn = await page.$(sel);
        if (dataBtn) {
          const [dl] = await Promise.all([
            page.waitForEvent("download", { timeout: 20_000 }),
            dataBtn.click(),
          ]);
          const path = dl.suggestedFilename().endsWith(".csv") || true
            ? await dl.path()
            : null;
          if (path) {
            const { readFileSync: rf } = await import("fs");
            const csv = rf(path, "utf8");
            await browser.close();
            console.log("    ↳ Got CSV via Playwright download button");
            return parseTableauCsv(csv);
          }
          break;
        }
      }
    }

    // ── Attempt 2: read table text from rendered DOM ──────────────────────
    // Tableau renders either HTML <table> cells or SVG <text> nodes.
    const tableData = await page.evaluate(() => {
      // Try HTML table first
      const rows = document.querySelectorAll("table tr");
      if (rows.length > 1) {
        return Array.from(rows)
          .map((r) => Array.from(r.querySelectorAll("td, th")).map((c) => c.textContent.trim()).join(","))
          .join("\n");
      }
      // Fall back: extract all text marks (SVG-based Tableau views)
      const texts = document.querySelectorAll(
        ".tab-widget text, .tabCanvas text, .VIZText text, [class*='label'] text"
      );
      if (texts.length > 0) {
        return Array.from(texts).map((t) => t.textContent.trim()).join("\n");
      }
      return "";
    });

    await browser.close();

    if (tableData && tableData.includes(",")) {
      const nuPathMap = parseTableauCsv(tableData);
      if (nuPathMap.size > 0) {
        console.log(`    ↳ Got ${nuPathMap.size} mappings via Playwright DOM extraction`);
        return nuPathMap;
      }
    }

    console.log("    ↳ Playwright loaded page but could not extract structured data");
    return null;
  } catch (err) {
    await browser.close();
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
  // ── Try 1: Tableau CSV (plain HTTP — works for public views) ─────────────
  console.log("\n[1] Trying Tableau CSV download (plain HTTP)…");
  try {
    nuPathMap = await fetchTableauData();
  } catch (err) {
    console.log(`  ↳ Tableau HTTP error: ${err.message}`);
  }
  if (nuPathMap) {
    nuPathSource = "Tableau (HTTP CSV)";
  }

  // ── Try 2: Tableau via Playwright browser automation ─────────────────────
  if (!nuPathMap && USE_PLAYWRIGHT) {
    console.log("\n[2] Trying Tableau via Playwright (browser automation)…");
    try {
      nuPathMap = await fetchTableauWithPlaywright();
    } catch (err) {
      console.log(`  ↳ Playwright error: ${err.message}`);
    }
    if (nuPathMap) {
      nuPathSource = "Tableau (Playwright)";
    } else {
      console.log("  ↳ Playwright strategy unavailable or returned no data.");
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

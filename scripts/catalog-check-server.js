#!/usr/bin/env node
/**
 * catalog-check-server.js
 *
 * Tiny HTTP server that runs a full catalog check against all-courses.json and
 * streams live progress to the NU Map dev portal via Server-Sent Events (SSE).
 *
 * Usage:
 *   node scripts/catalog-check-server.js           # port 3333 (default)
 *   node scripts/catalog-check-server.js --port 4000
 *
 * From the dev portal, open the "Catalog Check" tab and click "Run Check".
 * The portal connects to http://localhost:3333/run (or your chosen port).
 */

import { createServer }         from "http";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname }     from "path";
import { fileURLToPath }        from "url";
import { execSync }             from "child_process";
import { parse as parseHTML }   from "node-html-parser";

const __dirname     = dirname(fileURLToPath(import.meta.url));
const ROOT          = resolve(__dirname, "..");
const ALL_COURSES   = resolve(ROOT, "public/northeastern/all-courses.json");
const META_SRC_PATH = resolve(ROOT, "src/core/dataMeta.json");
const META_PUB_PATH = resolve(ROOT, "public/data-meta.json");
const CHANGE_LOG    = resolve(ROOT, "public/northeastern/change-log.json");
const NUPATH_WORKFLOW   = resolve(ROOT, ".github/workflows/update-nupath.yml");
const NUPATH_MAP_PATH   = resolve(ROOT, "data/northeastern/nupath-map.json");
const NUPATH_SCHEDULE_COMMENT = `  # schedule:\n  #   - cron: "0 5 1 1,5,9 *"   # 05:00 UTC on the 1st of Jan, May, Sep`;
const NUPATH_SCHEDULE_ACTIVE  = `  schedule:\n    - cron: "0 5 1 1,5,9 *"   # 05:00 UTC on the 1st of Jan, May, Sep`;
const TABLEAU_EMBED_URL = "https://tableau.northeastern.edu/t/Registrar/views/NUpathAttributes/NUpathAttribute?%3Aembed=y&%3AisGuestRedirectFromVizportal=y";

const BASE_URL      = "https://catalog.northeastern.edu";
const INDEX_URL     = `${BASE_URL}/course-descriptions/`;
const DELAY_MS      = parseInt(process.env.CATALOG_DELAY_MS ?? "350", 10);
const PORT          = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : 3333;
})();

const sleep = ms => new Promise(r => setTimeout(r, ms));

const CHANGE_LOG_MAX = 600;

// ── Prereq/coreq parsing helpers (identical to scrape-catalog.js) ──
function parsePrereqText(text) {
  if (!text) return [];
  // Remove "may be taken concurrently" and grade requirements
  let cleaned = text
    .replace(/\(may be taken concurrently\)/gi, '')
    .replace(/with a minimum grade of [A-Z][+-]?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip trailing period if present
  cleaned = cleaned.replace(/\.\s*$/, '');
  // Tokenize: split on "and"/"or" while preserving them, and handle parens
  const coursePattern = /([A-Z]{2,6})\s+(\d{4}[A-Z]?)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  while ((match = coursePattern.exec(cleaned)) !== null) {
    // Check text between last match and this match for operators and parens
    const between = cleaned.slice(lastIndex, match.index);
    extractOperators(between, parts);
    parts.push({ subject: match[1], number: match[2] });
    lastIndex = coursePattern.lastIndex;
  }
  // Check for trailing operators after last course ref
  if (lastIndex < cleaned.length) {
    extractOperators(cleaned.slice(lastIndex), parts);
  }
  // Post-process: insert implicit "And" between adjacent ) and ( with no operator
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(parts[i]);
    if (i < parts.length - 1) {
      const cur  = parts[i];
      const next = parts[i + 1];
      const curIsEnd  = cur === ')' || (typeof cur === 'object' && cur.subject);
      const nextIsStart = next === '(' || (typeof next === 'object' && next.subject);
      if (curIsEnd && nextIsStart) {
        result.push('And');
      }
    }
  }
  return result;
}

function extractOperators(text, parts) {
  // Remove commas and semicolons, treat as whitespace
  const normalized = text.replace(/[,;]/g, ' ').trim();
  if (!normalized) return;
  const opPattern = /(\(|\)|(?:^|\s)(and|or)(?:\s|$))/gi;
  let m;
  while ((m = opPattern.exec(normalized)) !== null) {
    const token = (m[2] || m[1]).trim();
    if (token === '(') parts.push('(');
    else if (token === ')') parts.push(')');
    else if (/^or$/i.test(token)) parts.push('Or');
    else if (/^and$/i.test(token)) parts.push('And');
  }
}

function parseCoreqText(text) {
  if (!text) return [];
  const refs = [];
  const coursePattern = /([A-Z]{2,6})\s+(\d{4}[A-Z]?)/g;
  let match;
  while ((match = coursePattern.exec(text)) !== null) {
    refs.push({ subject: match[1], number: match[2] });
  }
  return refs;
}

function appendLogEntry(entry) {
  try {
    const log = existsSync(CHANGE_LOG) ? JSON.parse(readFileSync(CHANGE_LOG, "utf8")) : { runs: [] };
    if (!Array.isArray(log.runs)) log.runs = [];
    log.runs.unshift(entry); // prepend — newest first
    if (log.runs.length > CHANGE_LOG_MAX) log.runs = log.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(log, null, 2) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

function patchLastLogEntry(fields) {
  try {
    const log = existsSync(CHANGE_LOG) ? JSON.parse(readFileSync(CHANGE_LOG, "utf8")) : { runs: [] };
    if (log.runs?.length) Object.assign(log.runs[0], fields);
    writeFileSync(CHANGE_LOG, JSON.stringify(log, null, 2) + "\n", "utf8");
  } catch { /* non-fatal */ }
}

// ── NUPath map (mirrors scrape-catalog.js) ───────────────────────────────────
const NUPATH_MAP = {
  "natural/designed world": "ND", "natural and designed world": "ND",
  "formal/quant": "FQ", "formal and quantitative": "FQ",
  "societies/institutions": "SI", "societies and institutions": "SI",
  "interpreting culture": "IC", "intellectual life": "IC",
  "creative express": "EI", "creative expression": "EI",
  "ethical reasoning": "ER", "ethics and social justice": "ER",
  "difference/diversity": "DD", "differences and diversity": "DD",
  "analyzing/using data": "AD", "analyzing and using data": "AD",
  "1st yr writing": "WF", "first.year writing": "WF",
  "adv writing": "WD", "advanced writing in": "WD",
  "writing intensive": "WI",
  "capstone experience": "CE",
  "integration experience": "EX", "experiential learning": "EX",
};

function parseNUPath(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [frag, code] of Object.entries(NUPATH_MAP)) {
    if (lower.includes(frag) && !found.includes(code)) found.push(code);
  }
  return found.sort();
}

// ── Tableau CSV helpers ───────────────────────────────────────────────────────

function parseCsvLine(line) {
  const result = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (ch === "," && !inQ) { result.push(cur); cur = ""; }
    else cur += ch;
  }
  result.push(cur);
  return result;
}

function findCol(headers, candidates) {
  for (const c of candidates) {
    const i = headers.findIndex(h => h.includes(c));
    if (i !== -1) return i;
  }
  return -1;
}

// Maps fragments of indicator column names → NUpath codes
const INDICATOR_FRAGMENT_MAP = {
  "advanced writing":       "WD",
  "adv writing":            "WD",
  "analyzing/using data":   "AD",
  "analyzing and using":    "AD",
  "capstone":               "CE",
  "creative express":       "EI",
  "difference/diversity":   "DD",
  "ethical reasoning":      "ER",
  "formal/quant":           "FQ",
  "integration experience": "EX",
  "interpreting culture":   "IC",
  "natural/designed world": "ND",
  "societies/institutions": "SI",
  "writing intensive":      "WI",
  "1st yr writing":         "WF",
  "first year writing":     "WF",
  "first.year writing":     "WF",
};

function indicatorColToCode(colName) {
  const lower = colName.toLowerCase().replace(/ ind\.?\s*$/, "").trim();
  for (const [frag, code] of Object.entries(INDICATOR_FRAGMENT_MAP)) {
    if (lower.includes(frag)) return code;
  }
  return null;
}

// Parse Tableau CSV (wide format) into Map<"SUBJ NUM", string[]>
// Each row is one course; columns ending in "Ind." are Y/N NUpath indicators.
// "Course ID " column already contains the "SUBJ NUM" key.
function parseTableauCsvNuPaths(csv) {
  const lines  = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return new Map();
  const header = parseCsvLine(lines[0]).map(h => h.trim());

  // Find "Course ID" column
  const courseIdCol = header.findIndex(h => h.toLowerCase().startsWith("course id"));
  if (courseIdCol === -1) return new Map();

  // Detect all indicator columns dynamically
  const indicatorCols = [];
  for (let i = 0; i < header.length; i++) {
    const lower = header[i].toLowerCase();
    if (!lower.endsWith("ind.") && !lower.endsWith("ind")) continue;
    const code = indicatorColToCode(header[i]);
    if (code) indicatorCols.push({ index: i, code });
  }
  if (indicatorCols.length === 0) return new Map();

  const grouped = new Map();
  for (let i = 1; i < lines.length; i++) {
    const cols     = parseCsvLine(lines[i]);
    const courseId = cols[courseIdCol]?.trim().toUpperCase();
    if (!courseId) continue;
    if (!grouped.has(courseId)) grouped.set(courseId, new Set());
    const codeSet = grouped.get(courseId);
    for (const { index, code } of indicatorCols) {
      if (cols[index]?.trim().toUpperCase() === "Y") codeSet.add(code);
    }
  }

  const result = new Map();
  for (const [key, codeSet] of grouped) result.set(key, [...codeSet].sort());
  return result;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "NU-Map-DataBot/1.0 (academic degree planner; contact nayugu@github; respects robots.txt)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function parseSubjectPage(html, subjectCode) {
  const root   = parseHTML(html);
  const blocks = root.querySelectorAll(".courseblock, [class*='courseblock']");
  const courses = [];

  for (const block of blocks) {
    const titleEl = block.querySelector(".courseblocktitle, .cb_title, .course-title, h3");
    if (!titleEl) continue;
    const rawTitle = titleEl.textContent.replace(/\u00a0/g, " ").trim();

    const tm = rawTitle.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\.\s+(.+?)\.\s*\((\d+(?:[-–]\d+)?)\s+[Hh]ours?\)/)
            || rawTitle.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\s+(.+?)\s+(\d+)\s+SH/i);
    if (!tm) continue;

    const [, subject, number, title, credStr] = tm;
    // Parse credits — preserve ranges (min in `credits`, max in `creditsMax` when different)
    const [cMin, cMax] = (credStr.includes("-") || credStr.includes("–"))
      ? credStr.split(/[-–]/).map(n => parseInt(n, 10))
      : [parseInt(credStr, 10), parseInt(credStr, 10)];
    const creditsMin = cMin;
    const creditsMax = cMax;

    const descEl = block.querySelector(".courseblockdesc, .cb_desc, .course-description, .courseblock-desc");
    const description = descEl
      ? descEl.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
      : "";

    const nuPathEl = block.querySelector("[class*='nupath'], [class*='NUpath'], [class*='attribute']");
    const nuPath = nuPathEl ? parseNUPath(nuPathEl.textContent) : parseNUPath(description);

    // ── Extract prereqs and coreqs from courseblockextra paragraphs ──
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

    const prereqs = prereqText ? parsePrereqText(prereqText) : [];
    const coreqs = coreqText ? parseCoreqText(coreqText) : [];

    courses.push({ subject, number, title, creditsMin, creditsMax, nuPath, description, prereqs, coreqs });
  }
  return courses;
}

async function getSubjectURLs() {
  const html  = await fetchPage(INDEX_URL);
  const root  = parseHTML(html);
  const links = root.querySelectorAll("a[href]");
  const urls  = new Map();

  for (const a of links) {
    const href = a.getAttribute("href") || "";
    const m    = href.match(/\/course-descriptions\/([a-z0-9-]+)\/?$/i);
    if (!m) continue;
    const slug = m[1].toUpperCase().replace(/-/g, " ");
    const url  = href.startsWith("http") ? href : BASE_URL + href;
    if (!urls.has(slug)) urls.set(slug, url);
  }
  return [...urls.entries()];
}

// ── Check fields that the catalog provides ────────────────────────────────
// Credits handled separately with range-awareness; title + nuPath use strict equality.
const CHECK_FIELDS = ["title", "nuPath"];

function fieldsDiffer(prev, cat) {
  const diffs = [];

  // Generic equality check for title and nuPath
  for (const f of CHECK_FIELDS) {
    if (JSON.stringify(prev[f] ?? null) !== JSON.stringify(cat[f] ?? null)) {
      diffs.push({ field: f, was: prev[f] ?? null, now: cat[f] ?? null });
    }
  }

  // Credits — range-aware comparison.
  // Our data: credits = min (from SearchNEU), creditsMax = max (only set when range).
  // Catalog: creditsMin + creditsMax (equal when fixed count).
  const prevMin = prev.credits    ?? null;
  const prevMax = prev.creditsMax ?? prev.credits ?? null;
  const catMin  = cat.creditsMin  ?? null;
  const catMax  = cat.creditsMax  ?? null;
  if (prevMin !== catMin || prevMax !== catMax) {
    const wasStr = (prevMax != null && prevMax !== prevMin)
      ? `${prevMin}\u2013${prevMax}` : prevMin;
    const nowStr = (catMax  != null && catMax  !== catMin)
      ? `${catMin}\u2013${catMax}`  : catMin;
    // isRangeOnly = true when the catalog shows a range (variable-credit course).
    // The values differ only because we weren't storing the range, not because the
    // course fundamentally changed — low priority, no PR needed.
    const isRangeOnly = catMin !== catMax;
    diffs.push({ field: "credits", was: wasStr, now: nowStr, isRangeOnly });
  }

  // Compare prereq course references (not exact structure, just referenced courses)
  function extractCourseRefs(prereqs) {
    const refs = new Set();
    function walk(node) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'object' && node.subject && node.number) {
        refs.add(`${node.subject} ${node.number}`);
      }
    }
    walk(prereqs);
    return [...refs].sort();
  }

  // Prereqs
  const prevRefs = extractCourseRefs(prev.prereqs);
  const catRefs = extractCourseRefs(cat.prereqs);
  if (catRefs.length > 0 && JSON.stringify(prevRefs) !== JSON.stringify(catRefs)) {
    diffs.push({ field: 'prereqs', was: prev.prereqs ?? [], now: cat.prereqs });
  }

  // Coreqs (same logic)
  const prevCoreqRefs = extractCourseRefs(prev.coreqs);
  const catCoreqRefs = extractCourseRefs(cat.coreqs);
  if (catCoreqRefs.length > 0 && JSON.stringify(prevCoreqRefs) !== JSON.stringify(catCoreqRefs)) {
    diffs.push({ field: 'coreqs', was: prev.coreqs ?? [], now: cat.coreqs });
  }

  return diffs;
}

// ── Main check runner — sends SSE payloads to the response stream ─────────
async function runCheck(send) {
  send("status", { msg: "Loading all-courses.json…" });

  if (!existsSync(ALL_COURSES)) {
    send("error", { msg: "public/northeastern/all-courses.json not found. Run npm run data:fetch first." });
    return;
  }

  const existing = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
  const existMap = new Map(existing.map(c => [`${c.subject} ${c.number}`, c]));

  send("status", { msg: `Loaded ${existing.length} courses. Fetching subject index…` });

  let subjects;
  try {
    subjects = await getSubjectURLs();
  } catch (e) {
    send("error", { msg: `Failed to fetch subject index: ${e.message}` });
    return;
  }

  send("start", { total: subjects.length, courses_in_db: existing.length });

  // Running totals
  const stats = {
    subjects_done: 0,
    courses_read:  0,
    matched:       0,   // in both catalog and our data, no field changes
    changed:       0,   // in both, but real content field(s) differ
    range_only:    0,   // in both, but only credits-range discrepancy (soft diff)
    added:         0,   // in catalog but not in our data
    missing:       0,   // in our data (for this subject) but not in catalog
    errors:        0,
  };

  for (let i = 0; i < subjects.length; i++) {
    const [slug, url] = subjects[i];
    const subjectCode = slug.replace(/\s.*/, "");

    send("subject_start", { index: i, slug, url, total: subjects.length });

    let catCourses = [];
    try {
      const html = await fetchPage(url);
      catCourses = parseSubjectPage(html, subjectCode);
    } catch (e) {
      stats.errors++;
      send("subject_done", {
        index: i, slug, error: e.message,
        subject_courses_read: 0, subject_matched: 0,
        subject_changed: 0, subject_added: 0, subject_missing: 0,
        changes: [], ...stats,
      });
      if (i < subjects.length - 1) await sleep(DELAY_MS);
      continue;
    }

    // Per-subject stats
    let subRead = 0, subMatched = 0, subChanged = 0, subRangeOnly = 0, subAdded = 0, subMissing = 0;
    const subjectChanges = []; // [{code, diffs:[]}] — includes both changed + range-only
    const addedKeys    = []; // course codes new in catalog, not in our data
    const missingKeys  = []; // course codes in our data, not in catalog

    const seenKeys = new Set();
    for (const cat of catCourses) {
      const key = `${cat.subject} ${cat.number}`;
      seenKeys.add(key);
      subRead++;
      stats.courses_read++;

      const prev = existMap.get(key);
      if (!prev) {
        subAdded++;
        stats.added++;
        addedKeys.push({ code: key, catalogData: cat }); // include full data so /fix can insert it
      } else {
        const diffs = fieldsDiffer(prev, cat);
        if (diffs.length === 0) {
          subMatched++;
          stats.matched++;
        } else {
          const allRangeOnly = diffs.every(d => d.isRangeOnly);
          subjectChanges.push({ code: key, diffs });
          if (allRangeOnly) {
            subRangeOnly++;
            stats.range_only++;
          } else {
            subChanged++;
            stats.changed++;
          }
        }
      }
    }

    // Courses in our data for this subject but not seen in catalog
    for (const [key, c] of existMap) {
      if (c.subject === subjectCode && !seenKeys.has(key)) {
        subMissing++;
        stats.missing++;
        missingKeys.push(key);
      }
    }

    stats.subjects_done++;

    send("subject_done", {
      index: i, slug,
      subject_courses_read: subRead,
      subject_matched:    subMatched,
      subject_changed:    subChanged,
      subject_range_only: subRangeOnly,
      subject_added:      subAdded,
      subject_missing:    subMissing,
      changes:            subjectChanges,
      added_courses:      addedKeys,
      missing_courses:    missingKeys,
      ...stats,
    });

    if (i < subjects.length - 1) await sleep(DELAY_MS);
  }

  send("done", { ...stats });
  return stats;
}

// ── HTTP server with SSE ──────────────────────────────────────────────────────
const server = createServer((req, res) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/run") {
    res.writeHead(200, {
      ...corsHeaders,
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    });
    res.flushHeaders?.();

    const send = (type, data) => {
      const payload = JSON.stringify({ type, ...data });
      res.write(`data: ${payload}\n\n`);
    };

    send("hello", { msg: "Catalog check server ready — starting…" });

    appendLogEntry({
      type:      "catalog-check",
      subject:   "🔍 Catalog Check",
      timestamp: new Date().toISOString(),
    });

    runCheck(send)
      .then(stats => {
        if (stats) {
          patchLastLogEntry({
            stats: {
              correct:      stats.matched,
              needPR:       stats.changed,
              rangeDiff:    stats.range_only,
              newCourses:   stats.added,
              notInCatalog: stats.missing,
              totalScanned: stats.courses_read,
              subjectsDone: stats.subjects_done,
            },
          });
        }
        send("end", {});
        res.end();
      })
      .catch(err => {
        send("error", { msg: err.message });
        res.end();
      });

    req.on("close", () => { /* client disconnected */ });
    return;
  }

  // ── POST /fix — apply catalog discrepancies directly to all-courses.json ────────
  if (req.method === "POST" && url.pathname === "/fix") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const items = JSON.parse(body); // [{code, type:'changed'|'range'|'added'|'missing', diffs, catalogData?}]
        if (!existsSync(ALL_COURSES)) {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "all-courses.json not found" }));
          return;
        }
        const courses = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
        const courseMap = new Map(courses.map(c => [`${c.subject} ${c.number}`, c]));

        // Stream SSE progress so the client can show a live progress bar
        res.writeHead(200, { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
        res.flushHeaders?.();
        const sendFix = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

        const fixable   = items.filter(i => i.type === "changed" || i.type === "range");
        const addable   = items.filter(i => i.type === "added");
        const removable = items.filter(i => i.type === "missing");
        const totalOps  = fixable.length + addable.length + removable.length;
        let opIdx = 0;
        let fixed = 0, nChanged = 0, nRange = 0, nAdded = 0, nRemoved = 0;

        // ── Overwrite changed/range courses ───────────────────────────────
        for (const item of fixable) {
          opIdx++;
          const course = courseMap.get(item.code);
          if (!course) continue;
          for (const { field, now } of (item.diffs ?? [])) {
            if (field === "credits") {
              if (typeof now === "string" && now.includes("–")) {
                const [cMin, cMax] = now.split("–").map(Number);
                course.credits    = cMin;
                course.creditsMax = cMax;
              } else {
                course.credits = typeof now === "number" ? now : parseInt(now, 10);
                delete course.creditsMax;
              }
            } else {
              course[field] = now;
            }
          }
          fixed++;
          if (item.type === "changed") nChanged++; else nRange++;
          sendFix("fixed", { code: item.code, itemType: item.type, index: opIdx, total: totalOps });
        }

        // ── Insert new courses from catalog ────────────────────────────────
        for (const item of addable) {
          opIdx++;
          const cd = item.catalogData;
          if (!cd) { sendFix("skipped", { code: item.code, reason: "no catalog data" }); continue; }
          const cMin = cd.creditsMin ?? 1;
          const cMax = cd.creditsMax ?? cMin;
          const newCourse = {
            subject:     cd.subject,
            number:      cd.number,
            title:       cd.title,
            credits:     cMin,
            ...(cMax !== cMin ? { creditsMax: cMax } : {}),
            nuPath:      cd.nuPath ?? [],
            description: cd.description ?? "",
            prereqs:     cd.prereqs ?? [],
            coreqs:      cd.coreqs ?? [],
          };
          courseMap.set(item.code, newCourse);
          nAdded++;
          fixed++;
          sendFix("fixed", { code: item.code, itemType: "added", index: opIdx, total: totalOps });
        }

        // ── Remove courses dropped from catalog ────────────────────────────
        for (const item of removable) {
          opIdx++;
          courseMap.delete(item.code);
          nRemoved++;
          fixed++;
          sendFix("fixed", { code: item.code, itemType: "missing", index: opIdx, total: totalOps });
        }

        writeFileSync(ALL_COURSES, JSON.stringify([...courseMap.values()], null, 0), "utf8");

        // Update dataMeta with current month/year and new course count
        const nowTs = new Date();
        const label = nowTs.toLocaleString("en-US", { month: "short", year: "numeric" });
        const meta  = { lastUpdated: label, courseCount: courseMap.size };
        try { writeFileSync(META_SRC_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8"); } catch {}
        try { writeFileSync(META_PUB_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8"); } catch {}

        appendLogEntry({
          type:      "nuclear-fix",
          subject:   "☢ Nuclear Fix Applied",
          timestamp: new Date().toISOString(),
          fixed, nChanged, nRange, nAdded, nRemoved, label,
        });

        sendFix("done", { ok: true, fixed, nChanged, nRange, nAdded, nRemoved, label, total: totalOps });
        res.end();
      } catch (e) {
        // If headers not yet sent, send JSON error; otherwise nothing we can do
        try { res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" }); } catch {}
        try { res.end(JSON.stringify({ ok: false, error: e.message })); } catch {}
      }
    });
    return;
  }

  // ── GET /git-status — diff of data files against HEAD ───────────────────────
  if (req.method === "GET" && url.pathname === "/git-status") {
    const GIT_FILES = [
      "public/northeastern/change-log.json",
      "public/northeastern/all-courses.json",
      "public/data-meta.json",
      "src/core/dataMeta.json",
    ];
    try {
      const opts = { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 };
      const statusOut = execSync(`git status --short -- ${GIT_FILES.join(" ")}`, opts).toString().trim();
      const dirty = statusOut.length > 0;
      let diff = "";
      if (dirty) {
        // Use --stat to avoid blowing the buffer on large files like all-courses.json
        diff = execSync(`git diff --stat -- ${GIT_FILES.join(" ")}`, opts).toString().trim();
      }
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, dirty, status: statusOut, diff }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── POST /git-push — commit changed data files and push ──────────────────────
  if (req.method === "POST" && url.pathname === "/git-push") {
    const GIT_FILES = [
      "public/northeastern/change-log.json",
      "public/northeastern/all-courses.json",
      "public/data-meta.json",
      "src/core/dataMeta.json",
    ];
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const opts = { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 };
        const statusOut = execSync(`git status --short -- ${GIT_FILES.join(" ")}`, opts).toString().trim();
        if (!statusOut) {
          res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, msg: "Nothing to commit — already up to date." }));
          return;
        }
        const date = new Date().toISOString().substring(0, 10);
        execSync(`git add ${GIT_FILES.join(" ")}`, opts);
        execSync(`git commit -m "catalog: update data files ${date}"`, opts);
        const pushOut = execSync("git push", { ...opts, encoding: "utf8" });
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, msg: "Pushed successfully.", output: pushOut.trim() }));
      } catch (e) {
        res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── GET /nupath-schedule — return current auto/manual mode ──────────────────
  if (req.method === "GET" && url.pathname === "/nupath-schedule") {
    try {
      const content = readFileSync(NUPATH_WORKFLOW, "utf8");
      const isAuto  = content.includes("  schedule:\n    - cron:");
      res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: isAuto ? "auto" : "manual" }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  // ── POST /nupath-schedule — toggle auto/manual mode in the workflow file ─────
  if (req.method === "POST" && url.pathname === "/nupath-schedule") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const { mode } = JSON.parse(body);
        let content = readFileSync(NUPATH_WORKFLOW, "utf8");
        if (mode === "auto") {
          content = content.replace(NUPATH_SCHEDULE_COMMENT, NUPATH_SCHEDULE_ACTIVE);
        } else {
          content = content.replace(NUPATH_SCHEDULE_ACTIVE, NUPATH_SCHEDULE_COMMENT);
        }
        writeFileSync(NUPATH_WORKFLOW, content, "utf8");
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, mode }));
      } catch (e) {
        res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── GET /nupath-scan — SSE: fetch NUpath from Tableau → diff → return results ─
  // Does NOT write to disk. Sends progress events then a final "done" with discrepancies.
  if (req.method === "GET" && url.pathname === "/nupath-scan") {
    res.writeHead(200, { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.flushHeaders?.();
    const send = (type, data) => { try { res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`); } catch {} };
    let aborted = false;
    req.on("close", () => { aborted = true; });

    (async () => {
      if (!existsSync(ALL_COURSES)) {
        send("error", { msg: "all-courses.json not found. Run npm run data:fetch first." });
        res.end(); return;
      }
      const existing = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
      const existMap = new Map(existing.map(c => [`${c.subject} ${c.number}`, c]));

      let freshNuPaths = null; // Map<"SUBJ NUM", string[]>
      let source = "";

      const TABLEAU_SITE_ID = "fa2c3643-d73c-40e1-b43c-06e38c98065d";
      const TABLEAU_API_BASE = "https://tableau.northeastern.edu/api/3.20";
      const EMBED_SDK_URL    = "https://tableau.northeastern.edu/javascripts/api/tableau.embedding.3.latest.min.js";
      const VIZ_SRC          = "https://tableau.northeastern.edu/t/Registrar/views/NUpathAttributes/NUpathAttribute";
      const BROWSER_UA       = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

      // ── Strategy 1: Tableau REST API (guest auth) ─────────────────────────
      send("log", { msg: "[1] Trying Tableau REST API (guest auth)…" });
      try {
        const authRes = await fetch(`${TABLEAU_API_BASE}/auth/signin`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": BROWSER_UA },
          body: JSON.stringify({ credentials: { name: "", password: "", site: { contentUrl: "Registrar" } } }),
        });
        if (!authRes.ok) {
          send("log", { msg: `  → Guest auth failed: HTTP ${authRes.status}` });
        } else {
          const authData = await authRes.json();
          const token  = authData.credentials?.token;
          const siteId = authData.credentials?.site?.id ?? TABLEAU_SITE_ID;
          if (!token) {
            send("log", { msg: "  → No token in auth response" });
          } else {
            send("log", { msg: `  → Authenticated. Querying views…` });
            const authHeaders = { "X-Tableau-Auth": token, "User-Agent": BROWSER_UA };
            const viewsRes = await fetch(
              `${TABLEAU_API_BASE}/sites/${siteId}/views?filter=name:eq:NUpathAttribute`,
              { headers: { ...authHeaders, Accept: "application/json" } },
            );
            if (viewsRes.ok) {
              const vData  = await viewsRes.json();
              const viewId = vData.views?.view?.[0]?.id;
              if (viewId) {
                send("log", { msg: `  → View LUID: ${viewId}` });
                const dataRes = await fetch(`${TABLEAU_API_BASE}/sites/${siteId}/views/${viewId}/data`, {
                  headers: { ...authHeaders, Accept: "text/csv" },
                });
                if (dataRes.ok) {
                  const csv    = await dataRes.text();
                  const parsed = parseTableauCsvNuPaths(csv);
                  if (parsed.size > 0) {
                    freshNuPaths = parsed;
                    source = "Tableau REST API";
                    send("log", { msg: `  → ✅ Got ${parsed.size} mappings via REST API` });
                  } else {
                    send("log", { msg: "  → Downloaded CSV but parsed 0 mappings" });
                  }
                } else {
                  send("log", { msg: `  → Data download failed: HTTP ${dataRes.status}` });
                }
              } else {
                send("log", { msg: "  → View 'NUpathAttribute' not found in site" });
              }
            } else {
              send("log", { msg: `  → Views query failed: HTTP ${viewsRes.status}` });
            }
          }
        }
      } catch (e) {
        send("log", { msg: `  REST API error: ${e.message}` });
      }

      // ── Strategy 2: Tableau direct CSV download (session cookie) ──────────
      if (!freshNuPaths) {
        send("log", { msg: "[2] Trying Tableau direct CSV download…" });
        try {
          let cookie = "";
          try {
            const sessRes = await fetch(TABLEAU_EMBED_URL, { headers: { "User-Agent": BROWSER_UA }, redirect: "follow" });
            const sc = sessRes.headers.get("set-cookie") ?? "";
            cookie = sc.split(",").map(s => s.trim().split(";")[0]).filter(Boolean).join("; ");
          } catch {}
          const csvUrls = [
            `${VIZ_SRC}.csv?:size=1920,1080`,
            `${VIZ_SRC}.csv`,
            "https://tableau.northeastern.edu/views/NUpathAttributes/NUpathAttribute.csv",
          ];
          for (const csvUrl of csvUrls) {
            send("log", { msg: `  GET ${csvUrl.replace("https://tableau.northeastern.edu", "")}` });
            const r = await fetch(csvUrl, {
              headers: { "User-Agent": BROWSER_UA, Accept: "text/csv,*/*", ...(cookie ? { Cookie: cookie } : {}) },
            });
            if (!r.ok) { send("log", { msg: `  → HTTP ${r.status}` }); continue; }
            const csv = await r.text();
            if (!csv.includes(",") || csv.trim().split(/\r?\n/).length < 2) {
              send("log", { msg: "  → Not valid CSV" }); continue;
            }
            const parsed = parseTableauCsvNuPaths(csv);
            if (parsed.size === 0) { send("log", { msg: "  → Parsed 0 mappings" }); continue; }
            freshNuPaths = parsed;
            source = "Tableau CSV (direct)";
            send("log", { msg: `  → ✅ Got ${parsed.size} mappings` });
            break;
          }
        } catch (e) {
          send("log", { msg: `  Direct CSV error: ${e.message}` });
        }
      }

      // ── Strategy 3: Playwright + Tableau Embedding API v3 ────────────────
      if (!freshNuPaths) {
        send("log", { msg: "[3] Trying Playwright + Tableau Embedding API v3…" });
        try {
          const { chromium } = await import("playwright");
          const browser = await chromium.launch({ headless: true });
          try {
            const page = await browser.newPage();
            const html = `<!DOCTYPE html>
<html><head><script type="module" src="${EMBED_SDK_URL}"></script></head>
<body>
<tableau-viz id="viz" src="${VIZ_SRC}" hide-tabs toolbar="hidden"></tableau-viz>
<script type="module">
  const viz = document.getElementById('viz');
  async function extractSheet(ws) {
    const dt = await ws.getSummaryDataAsync({ maxRows: 0, ignoreAliases: false });
    return { name: ws.name, columns: dt.columns.map(c => c.fieldName), rows: dt.data.map(r => r.map(v => v.formattedValue)) };
  }
  viz.addEventListener('firstinteractive', async () => {
    try {
      const sheet = viz.workbook.activeSheet;
      const sheets = sheet.sheetType === 'dashboard' ? sheet.worksheets : [sheet];
      const results = [];
      for (const ws of sheets) results.push(await extractSheet(ws));
      window._tableau_result = results;
    } catch(e) { window._tableau_error = e.message; }
  });
</script>
</body></html>`;
            await page.setContent(html, { waitUntil: "domcontentloaded" });
            send("log", { msg: "  → Waiting for firstinteractive (up to 120s)…" });
            await page.waitForFunction(
              () => window._tableau_result !== undefined || window._tableau_error !== undefined,
              { timeout: 120_000, polling: 2_000 },
            );
            const { result, error } = await page.evaluate(() => ({
              result: window._tableau_result, error: window._tableau_error,
            }));
            if (error) {
              send("log", { msg: `  → Embedding API error: ${error}` });
            } else if (result?.length) {
              for (const sheet of result) {
                const colsLower = sheet.columns.map(c => c.toLowerCase());
                const subjIdx = findCol(colsLower, ["subject", "subj"]);
                const numIdx  = findCol(colsLower, ["catalog number", "course number", "catalog nbr", "crse nmbr", "number", "nbr"]);
                const attrIdx = findCol(colsLower, ["attribute description", "attribute", "nupath", "np attribute", "crse attr description"]);
                send("log", { msg: `  → Sheet "${sheet.name}": ${sheet.rows.length} rows | ${sheet.columns.slice(0,5).join(", ")}` });
                if (subjIdx === -1 || numIdx === -1 || attrIdx === -1) continue;
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
                for (const [k, s] of grouped) mapped.set(k, [...s].sort());
                if (mapped.size > 0) {
                  freshNuPaths = mapped;
                  source = "Tableau (Embedding API v3)";
                  send("log", { msg: `  → ✅ Got ${mapped.size} mappings from sheet "${sheet.name}"` });
                  break;
                }
              }
              if (!freshNuPaths) send("log", { msg: "  → No sheets had recognizable NUpath columns" });
            } else {
              send("log", { msg: "  → No data returned" });
            }
          } finally {
            await browser.close().catch(() => {});
          }
        } catch (e) {
          if (e.code === "ERR_MODULE_NOT_FOUND" || e.message?.includes("Cannot find")) {
            send("log", { msg: "  Playwright not installed — run: npx playwright install chromium" });
          } else {
            send("log", { msg: `  Playwright error: ${e.message}` });
          }
        }
      }

      // ── Strategy 2: catalog.northeastern.edu scrape ───────────────────────
      if (!freshNuPaths && !aborted) {
        send("log", { msg: "\nFalling back to catalog.northeastern.edu…" });
        try {
          let subjects;
          try {
            subjects = await getSubjectURLs();
            send("log", { msg: `Found ${subjects.length} subjects. Scanning…` });
          } catch (e) {
            send("error", { msg: `Cannot reach catalog: ${e.message}` }); res.end(); return;
          }

          freshNuPaths = new Map();
          let done = 0;
          const BATCH = 5;
          for (let i = 0; i < subjects.length && !aborted; i += BATCH) {
            const batch = subjects.slice(i, i + BATCH);
            await Promise.all(batch.map(async ([slug, url]) => {
              const subjectCode = slug.split(/\s/)[0];
              try {
                const html   = await fetchPage(url);
                const parsed = parseSubjectPage(html, subjectCode);
                for (const c of parsed) freshNuPaths.set(`${c.subject} ${c.number}`, c.nuPath);
              } catch {}
              done++;
              send("progress", { done, total: subjects.length, msg: `${done}/${subjects.length} subjects` });
            }));
            await sleep(300);
          }
          source = "catalog.northeastern.edu";
          send("log", { msg: `Catalog scan complete — ${freshNuPaths.size} courses found.` });
        } catch (e) {
          send("error", { msg: `Scan failed: ${e.message}` }); res.end(); return;
        }
      }

      if (aborted) { res.end(); return; }

      // ── Build discrepancy list ────────────────────────────────────────────
      const discrepancies = [];
      for (const [key, freshNP] of freshNuPaths) {
        const course = existMap.get(key);
        if (!course) continue; // not in our DB — skip
        const oldNP = course.nuPath ?? [];
        if (JSON.stringify(oldNP) === JSON.stringify(freshNP)) continue; // no change
        const oldSet  = new Set(oldNP);
        const newSet  = new Set(freshNP);
        discrepancies.push({
          subject:   course.subject,
          number:    course.number,
          title:     course.title ?? "",
          oldNuPath: oldNP,
          newNuPath: freshNP,
          added:     freshNP.filter(c => !oldSet.has(c)),
          removed:   oldNP.filter(c =>  !newSet.has(c)),
        });
      }
      // Sort by new NUpath count desc, then by course key asc
      discrepancies.sort((a, b) =>
        b.newNuPath.length - a.newNuPath.length ||
        `${a.subject} ${a.number}`.localeCompare(`${b.subject} ${b.number}`)
      );

      // Write nupath-map.json as authoritative source
      try {
        const mapData = {
          _readme: "Authoritative NUpath designations. Updated by Tableau scraper / catalog scrape.",
          _lastUpdated: new Date().toISOString(),
          _source: source,
          courses: Object.fromEntries(freshNuPaths),
        };
        writeFileSync(NUPATH_MAP_PATH, JSON.stringify(mapData, null, 2) + "\n", "utf8");
        send("log", { msg: `Updated data/nupath-map.json (${freshNuPaths.size} courses)` });
      } catch (e) {
        send("log", { msg: `Warning: could not write nupath-map.json: ${e.message}`, isErr: true });
      }

      // Log to change-log.json
      appendLogEntry({
        type:      "nupath-scan",
        subject:   "🎓 NUpath Scan",
        timestamp: new Date().toISOString(),
        source,
        stats: {
          scanned:      freshNuPaths.size,
          changed:      discrepancies.length,
          gained:       discrepancies.reduce((s, x) => s + x.added.length,   0),
          lost:         discrepancies.reduce((s, x) => s + x.removed.length, 0),
          gainedOnly:   discrepancies.filter(x => x.added.length  > 0 && x.removed.length === 0).length,
          lostOnly:     discrepancies.filter(x => x.removed.length > 0 && x.added.length  === 0).length,
          mixed:        discrepancies.filter(x => x.added.length  > 0 && x.removed.length > 0).length,
        },
      });

      send("done", {
        ok: true,
        source,
        scanned: freshNuPaths.size,
        discrepancies,
      });
      res.end();
    })();
    return;
  }

  // ── POST /nupath-fix — apply selected NUpath fixes to all-courses.json ────────
  if (req.method === "POST" && url.pathname === "/nupath-fix") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        // items: [{subject, number, newNuPath: string[]}]
        const items = JSON.parse(body);
        if (!existsSync(ALL_COURSES)) {
          res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "all-courses.json not found" }));
          return;
        }
        const courses   = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
        const courseMap = new Map(courses.map(c => [`${c.subject} ${c.number}`, c]));
        let fixed = 0;
        for (const { subject, number, newNuPath } of items) {
          const course = courseMap.get(`${subject} ${number}`);
          if (!course) continue;
          course.nuPath = newNuPath;
          fixed++;
        }
        writeFileSync(ALL_COURSES, JSON.stringify([...courseMap.values()], null, 0), "utf8");
        appendLogEntry({
          type:      "nupath-manual-fix",
          subject:   "🎓 NUpath Manual Fix",
          timestamp: new Date().toISOString(),
          fixed,
          courses:   items.map(i => `${i.subject} ${i.number}`),
        });
        res.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, fixed }));
      } catch (e) {
        res.writeHead(500, { ...corsHeaders, "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(200, { ...corsHeaders, "Content-Type": "text/plain" });
  res.end([
    `NU Map Catalog Check Server — :${PORT}`,
    `GET  /run             SSE catalog check stream`,
    `POST /fix             apply catalog discrepancy fixes`,
    `GET  /git-status      diff uncommitted data files`,
    `POST /git-push        commit + push data files`,
    `GET  /nupath-schedule get current NUpath auto/manual mode`,
    `POST /nupath-schedule set NUpath auto/manual mode`,
    `GET  /nupath-scan     SSE: fetch NUpath from Tableau/catalog, return discrepancies`,
    `POST /nupath-fix      apply selected NUpath fixes`,
  ].join("\n"));
});

server.listen(PORT, () => {
  console.log(`\n✅  Catalog check server → http://localhost:${PORT}`);
  console.log(`   GET http://localhost:${PORT}/run  → SSE stream of catalog check progress`);
  console.log(`   Open the dev portal → Catalog Check tab → click "Run Check"\n`);
  console.log(`   Stop server: Ctrl+C\n`);
});

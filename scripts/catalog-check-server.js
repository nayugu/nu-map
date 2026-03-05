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
const ALL_COURSES   = resolve(ROOT, "public/all-courses.json");
const META_SRC_PATH = resolve(ROOT, "src/core/dataMeta.json");
const META_PUB_PATH = resolve(ROOT, "public/data-meta.json");
const CHANGE_LOG    = resolve(ROOT, "public/change-log.json");
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
    send("error", { msg: "public/all-courses.json not found. Run npm run data:fetch first." });
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
      "public/change-log.json",
      "public/all-courses.json",
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
      "public/change-log.json",
      "public/all-courses.json",
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

  res.writeHead(200, { ...corsHeaders, "Content-Type": "text/plain" });
  res.end(`NU Map Catalog Check Server running on :${PORT}\nGET /run  \u2014 start SSE check stream\nPOST /fix \u2014 apply discrepancy fixes\nGET /git-status \u2014 show uncommitted data file changes\nPOST /git-push \u2014 commit + push data files to GitHub`);
});

server.listen(PORT, () => {
  console.log(`\n✅  Catalog check server → http://localhost:${PORT}`);
  console.log(`   GET http://localhost:${PORT}/run  → SSE stream of catalog check progress`);
  console.log(`   Open the dev portal → Catalog Check tab → click "Run Check"\n`);
  console.log(`   Stop server: Ctrl+C\n`);
});

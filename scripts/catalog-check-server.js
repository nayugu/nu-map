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

function appendLogEntry(entry) {
  try {
    const log = existsSync(CHANGE_LOG) ? JSON.parse(readFileSync(CHANGE_LOG, "utf8")) : { runs: [] };
    if (!Array.isArray(log.runs)) log.runs = [];
    log.runs.unshift(entry); // prepend — newest first
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

    courses.push({ subject, number, title, creditsMin, creditsMax, nuPath, description });
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
        addedKeys.push(key);
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
      .then(() => {
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
        const items = JSON.parse(body); // [{code, type:'changed'|'range', diffs:[{field, was, now}]}]
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

        const fixable = items.filter(i => i.type === "changed" || i.type === "range");
        let fixed = 0, nChanged = 0, nRange = 0;
        for (let idx = 0; idx < fixable.length; idx++) {
          const item = fixable[idx];
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
          sendFix("fixed", { code: item.code, itemType: item.type, index: idx + 1, total: fixable.length });
        }

        writeFileSync(ALL_COURSES, JSON.stringify([...courseMap.values()], null, 0), "utf8");

        // Update dataMeta with current month/year
        const nowTs = new Date();
        const label = nowTs.toLocaleString("en-US", { month: "short", year: "numeric" });
        const meta  = { lastUpdated: label, courseCount: courses.length };
        try { writeFileSync(META_SRC_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8"); } catch {}
        try { writeFileSync(META_PUB_PATH, JSON.stringify(meta, null, 2) + "\n", "utf8"); } catch {}

        appendLogEntry({
          type:      "nuclear-fix",
          subject:   "☢ Nuclear Fix Applied",
          timestamp: new Date().toISOString(),
          fixed, nChanged, nRange, label,
        });

        sendFix("done", { ok: true, fixed, nChanged, nRange, label, total: fixable.length });
        res.end();
      } catch (e) {
        // If headers not yet sent, send JSON error; otherwise nothing we can do
        try { res.writeHead(400, { ...corsHeaders, "Content-Type": "application/json" }); } catch {}
        try { res.end(JSON.stringify({ ok: false, error: e.message })); } catch {}
      }
    });
    return;
  }

  res.writeHead(200, { ...corsHeaders, "Content-Type": "text/plain" });
  res.end(`NU Map Catalog Check Server running on :${PORT}\nGET /run  \u2014 start SSE check stream\nPOST /fix \u2014 apply discrepancy fixes to all-courses.json`);
});

server.listen(PORT, () => {
  console.log(`\n✅  Catalog check server → http://localhost:${PORT}`);
  console.log(`   GET http://localhost:${PORT}/run  → SSE stream of catalog check progress`);
  console.log(`   Open the dev portal → Catalog Check tab → click "Run Check"\n`);
  console.log(`   Stop server: Ctrl+C\n`);
});

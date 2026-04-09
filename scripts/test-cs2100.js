#!/usr/bin/env node
/**
 * test-cs2100.js
 *
 * One-shot smoke test: scrapes the CS subject page, extracts CS 2100,
 * and shows a before/after diff against the current all-courses.json.
 *
 * Does NOT write any files.
 *
 * Usage: node scripts/test-cs2100.js
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname }         from "path";
import { fileURLToPath }            from "url";
import { parse as parseHTML }       from "node-html-parser";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

// ── Inline NUPath map (must stay in sync with NUPATH_MAP in scrape-catalog.js)
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

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "NU-Map-DataBot/1.0 (test; academic planner)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${url}`);
  return res.text();
}

// ── Parse one courseblock for a specific course number ───────────────────────
function extractCourse(html, targetNumber) {
  const root   = parseHTML(html);
  const blocks = root.querySelectorAll(".courseblock, [class*='courseblock']");

  for (const block of blocks) {
    const titleEl = block.querySelector(
      ".courseblocktitle, .cb_title, .course-title, h3"
    );
    if (!titleEl) continue;

    const raw = titleEl.textContent.replace(/\u00a0/g, " ").trim();
    const m   = raw.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\.\s+(.+?)\.\s*\((\d+(?:[-–]\d+)?)\s+[Hh]ours?\)/)
             || raw.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\s+(.+?)\s+(\d+)\s+SH/i);
    if (!m) continue;

    const [, subject, number, title, credStr] = m;
    if (number !== targetNumber) continue;

    const credits = credStr.includes("-") || credStr.includes("–")
      ? parseInt(credStr.split(/[-–]/)[1], 10)
      : parseInt(credStr, 10);

    // Do NOT fall back to bare 'p' — first <p> in the block is the title.
    const descEl     = block.querySelector(".courseblockdesc, .cb_desc, .course-description, .courseblock-desc");
    const description = descEl
      ? descEl.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim()
      : "";

    // Collect all attribute/extra text for NUPath
    const attrEls  = block.querySelectorAll("[class*='courseblockextra'], [class*='cb_extra'], p");
    let attrText   = "";
    let prereqText = "";
    let coreqText  = "";

    for (const el of attrEls) {
      const t = el.textContent.replace(/\u00a0/g, " ");
      const tl = t.toLowerCase();
      if (tl.includes("attribute"))   attrText   = t;
      if (tl.includes("prerequisite")) prereqText = t.replace(/prerequisite[s]?(?:\(s\))?:?\s*/i, "").trim();
      if (tl.includes("corequisite"))  coreqText  = t.replace(/corequisite[s]?(?:\(s\))?:?\s*/i,  "").trim();
    }

    const nuPath = parseNUPath(attrText || description);

    return {
      subject, number, title,
      credits, nuPath, description,
      prereqRaw: prereqText,
      coreqRaw:  coreqText,
    };
  }
  return null;
}

// ── Diff helper ───────────────────────────────────────────────────────────────
function diffField(label, before, after) {
  const bStr = JSON.stringify(before);
  const aStr = JSON.stringify(after);
  if (bStr === aStr) {
    console.log(`  ${label.padEnd(14)} ✓  unchanged`);
  } else {
    console.log(`  ${label.padEnd(14)} ✗  CHANGED`);
    console.log(`    BEFORE: ${bStr}`);
    console.log(`    AFTER:  ${aStr}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════");
console.log("  CS 2100 scrape smoke test");
console.log("══════════════════════════════════════════════════\n");

// Load current data
const allCoursesPath = resolve(ROOT, "public/northeastern/all-courses.json");
if (!existsSync(allCoursesPath)) {
  console.error("❌  public/northeastern/all-courses.json not found.");
  process.exit(1);
}
const allCourses = JSON.parse(readFileSync(allCoursesPath, "utf8"));
const before     = allCourses.find(c => c.subject === "CS" && c.number === "2100");

if (!before) {
  console.error("❌  CS 2100 not found in all-courses.json.");
  process.exit(1);
}

console.log("BEFORE (current all-courses.json):");
console.log("  title:    ", before.title);
console.log("  credits:  ", before.credits);
console.log("  nuPath:   ", JSON.stringify(before.nuPath));
console.log("  description (first 120 chars):");
console.log("    " + (before.description || "").slice(0, 120));
console.log();

// Scrape live catalog
console.log("Fetching https://catalog.northeastern.edu/course-descriptions/cs/ …");
let after;
try {
  const html = await fetchPage("https://catalog.northeastern.edu/course-descriptions/cs/");
  after = extractCourse(html, "2100");
} catch (err) {
  console.error("❌  Fetch failed:", err.message);
  process.exit(1);
}

if (!after) {
  console.error("❌  CS 2100 not found on catalog page — selector may need updating.");
  process.exit(1);
}

console.log("\nAFTER (catalog scrape):");
console.log("  title:    ", after.title);
console.log("  credits:  ", after.credits);
console.log("  nuPath:   ", JSON.stringify(after.nuPath));
console.log("  description (first 120 chars):");
console.log("    " + after.description.slice(0, 120));
console.log("  prereqRaw:", after.prereqRaw.slice(0, 100));
console.log("  coreqRaw: ", after.coreqRaw.slice(0, 100));

console.log("\nDIFF:");
diffField("title",       before.title,                                   after.title);
diffField("credits",     before.credits,                                 after.credits);
diffField("nuPath",      [...(before.nuPath ?? [])].sort(),              after.nuPath);
diffField("description", before.description,                             after.description);

console.log("\n══════════════════════════════════════════════════");
console.log("  ✅  Test complete — no files were written.");
console.log("══════════════════════════════════════════════════\n");

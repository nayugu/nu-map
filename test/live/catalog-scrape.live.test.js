// LIVE · NON-DETERMINISTic — hits catalog.northeastern.edu over the network.
//
// NOT part of `npm test`. Runs only via `npm run test:live` (or CI's scheduled
// job) so a network blip or a NEU markup change never fails an ordinary PR. Its
// job is exactly that: detect when NEU changes their course-page markup so the
// catalog parser's selectors need updating. Reads no files, writes nothing.
// (Migrated from scripts/test-cs2100.js.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseHTML } from "node-html-parser";

const CATALOG_URL = "https://catalog.northeastern.edu/course-descriptions/cs/";

// Mirror of NUPATH_MAP in scrape-catalog.js (kept minimal for the smoke test).
const NUPATH_MAP = {
  "natural/designed world": "ND", "natural and designed world": "ND",
  "analyzing/using data": "AD", "analyzing and using data": "AD",
  "formal/quant": "FQ", "formal and quantitative": "FQ",
};
function parseNUPath(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [frag, code] of Object.entries(NUPATH_MAP)) {
    if (lower.includes(frag) && !found.includes(code)) found.push(code);
  }
  return found.sort();
}

function extractCourse(html, targetNumber) {
  const root = parseHTML(html);
  for (const block of root.querySelectorAll(".courseblock, [class*='courseblock']")) {
    const titleEl = block.querySelector(".courseblocktitle, .cb_title, .course-title, h3");
    if (!titleEl) continue;
    const raw = titleEl.textContent.replace(/ /g, " ").trim();
    const m =
      raw.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\.\s+(.+?)\.\s*\((\d+(?:[-–]\d+)?)\s+[Hh]ours?\)/) ||
      raw.match(/^([A-Z]{2,6})\s+(\d{4}[A-Z]?)\s+(.+?)\s+(\d+)\s+SH/i);
    if (!m) continue;
    const [, subject, number, title, credStr] = m;
    if (number !== targetNumber) continue;
    const credits = /[-–]/.test(credStr) ? parseInt(credStr.split(/[-–]/)[1], 10) : parseInt(credStr, 10);
    const descEl = block.querySelector(".courseblockdesc, .cb_desc, .course-description, .courseblock-desc");
    const description = descEl ? descEl.textContent.replace(/ /g, " ").replace(/\s+/g, " ").trim() : "";
    return { subject, number, title, credits, nuPath: parseNUPath(description) };
  }
  return null;
}

test("live catalog › CS course page parses into a well-formed CS 2100 record", async () => {
  const res = await fetch(CATALOG_URL, {
    headers: { "User-Agent": "NU-Map-DataBot/1.0 (test; academic planner)", Accept: "text/html" },
  });
  assert.ok(res.ok, `HTTP ${res.status} fetching ${CATALOG_URL}`);
  const html = await res.text();

  const course = extractCourse(html, "2100");
  assert.ok(course, "CS 2100 not found — NEU course-page markup or selectors likely changed");
  assert.equal(course.subject, "CS");
  assert.ok(course.title.length > 0, "empty title — title selector may have changed");
  assert.ok(Number.isInteger(course.credits) && course.credits > 0, `bad credits: ${course.credits}`);
  assert.ok(Array.isArray(course.nuPath));
});

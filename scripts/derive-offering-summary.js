#!/usr/bin/env node
/**
 * derive-offering-summary.js
 *
 * Transforms the raw, heavy public/northeastern/term-details.json (~4.3 MB, full per-term
 * section aggregates) into a slim client asset the app actually loads:
 *
 *   public/northeastern/offering-summary.json
 *   {
 *     "CS3500": {
 *       f:   { "202610": 96, "202630": 73 },  // fill % (enrolled/capacity) per completed term
 *       fmt: ["Traditional"],                 // instructional formats ever seen (union)
 *       cmp: ["Boston"],                      // campuses ever seen (union)
 *       day: "MWF",                           // modal primary meeting day-pattern
 *       lab: false                            // any section requires a linked lab/co-section
 *     }
 *   }
 *
 * Per-semester fill (Fall vs Spring vs Summer) and a competitiveness label are derived in the
 * app from `f` (the term code carries the semester type). Keeping only fill% + course-level
 * summary drops the file to well under 1 MB.
 *
 * Usage:
 *   node scripts/derive-offering-summary.js            # dry run — prints size + samples
 *   node scripts/derive-offering-summary.js --write    # write offering-summary.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = resolve(__dirname, "..");
const DETAILS_IN  = resolve(ROOT, "public/northeastern/term-details.json");
const SUMMARY_OUT = resolve(ROOT, "public/northeastern/offering-summary.json");

const doWrite = process.argv.includes("--write");

if (!existsSync(DETAILS_IN)) {
  console.error(`Missing ${DETAILS_IN} — run scripts/scrape-availability.js first.`);
  process.exit(1);
}

const details = JSON.parse(readFileSync(DETAILS_IN, "utf8"));
const summary = {};

for (const [courseId, byTerm] of Object.entries(details)) {
  const fill = {};
  const formats  = new Set();
  const campuses = new Set();
  const weekday  = { M: 0, T: 0, W: 0, R: 0, F: 0 };  // R = Thursday
  let totalSec = 0;
  let lab = false;

  for (const [termCode, d] of Object.entries(byTerm)) {
    if (d.cap > 0) fill[termCode] = Math.round((d.enr / d.cap) * 100);
    for (const f of d.formats ?? [])  formats.add(f);
    for (const c of d.campuses ?? []) campuses.add(c);
    for (const [pattern, n] of Object.entries(d.days ?? {})) {
      totalSec += n;                                   // includes async / weekend sections
      for (const ch of pattern) if (ch in weekday) weekday[ch] += n;
    }
    if (d.linked) lab = true;
  }

  // Per-weekday frequency: % of all sections that meet on each weekday (M,T,W,Th,F). Captures
  // "mostly MWR, occasionally TF" as a gradient rather than a single binary pattern. Async /
  // weekend sections count toward the total, so a heavily-online course reads as all-faint.
  const dow = totalSec > 0
    ? ["M", "T", "W", "R", "F"].map(k => Math.round((weekday[k] / totalSec) * 100))
    : null;

  summary[courseId] = {
    f:   fill,
    fmt: [...formats].sort(),
    cmp: [...campuses].sort(),
    ...(dow ? { dow } : {}),
    ...(lab ? { lab: true } : {}),
  };
}

const json  = JSON.stringify(summary);
const bytes = Buffer.byteLength(json, "utf8");
console.log(`Courses: ${Object.keys(summary).length}`);
console.log(`Size:    ${(bytes / 1048576).toFixed(2)} MB`);
for (const id of ["CS3500", "MATH1341", "ENGW1111"]) {
  if (summary[id]) console.log(`  ${id}: ${JSON.stringify(summary[id])}`);
}

if (doWrite) {
  writeFileSync(SUMMARY_OUT, json);
  console.log(`\nWrote ${SUMMARY_OUT}`);
} else {
  console.log("\nDry run — pass --write to save offering-summary.json");
}

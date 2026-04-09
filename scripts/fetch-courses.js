#!/usr/bin/env node
/**
 * fetch-courses.js
 *
 * Fetches a fresh course snapshot from husker.vercel.app (ninest/nu-courses)
 * and computes a human-readable diff against the current all-courses.json.
 *
 * Usage:
 *   node scripts/fetch-courses.js           # dry run — shows diff, no write
 *   node scripts/fetch-courses.js --write   # write public/northeastern/all-courses.json
 *
 * After fetching, run apply-patches.js to overlay local manual corrections.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH      = resolve(ROOT, "public/northeastern/all-courses.json");
const META_SRC_PATH = resolve(ROOT, "src/core/dataMeta.json");   // compile-time import in Header
const META_PUB_PATH = resolve(ROOT, "public/data-meta.json");      // served at runtime for dev portal
const COURSES_API = "https://husker.vercel.app/courses/all";

const WRITE = process.argv.includes("--write");

// ── Fetch ────────────────────────────────────────────────────────────────────

console.log(`\nFetching courses from ${COURSES_API} …`);
let fresh;
try {
  const res = await fetch(COURSES_API);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  fresh = await res.json();
} catch (err) {
  console.error(`\n❌  Fetch failed: ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(fresh)) {
  console.error(`\n❌  Unexpected response shape (expected array, got ${typeof fresh})`);
  process.exit(1);
}

console.log(`   Received ${fresh.length.toLocaleString()} courses.`);

// ── Load existing ────────────────────────────────────────────────────────────

let existing = [];
if (existsSync(OUT_PATH)) {
  existing = JSON.parse(readFileSync(OUT_PATH, "utf8"));
  console.log(`   Existing snapshot: ${existing.length.toLocaleString()} courses.`);
} else {
  console.log("   No existing snapshot — this will be the first write.");
}

// ── Diff ─────────────────────────────────────────────────────────────────────

const key = (c) => `${c.subject} ${c.number}`;

const existingMap = new Map(existing.map((c) => [key(c), c]));
const freshMap    = new Map(fresh.map((c)    => [key(c), c]));

const added    = [];
const removed  = [];
const modified = [];

for (const [k, newC] of freshMap) {
  if (!existingMap.has(k)) {
    added.push(newC);
  } else {
    const old = existingMap.get(k);
    const changes = diffFields(old, newC);
    if (changes.length > 0) modified.push({ course: newC, changes });
  }
}
for (const [k, oldC] of existingMap) {
  if (!freshMap.has(k)) removed.push(oldC);
}

// ── Report ───────────────────────────────────────────────────────────────────

const separator = "─".repeat(60);

console.log(`\n${separator}`);
console.log("  DIFF SUMMARY");
console.log(separator);
console.log(`  + Added    : ${added.length}`);
console.log(`  ~ Modified : ${modified.length}`);
console.log(`  - Removed  : ${removed.length}`);
console.log(separator);

if (added.length > 0) {
  console.log("\n+ ADDED (first 20):");
  added.slice(0, 20).forEach((c) =>
    console.log(`  + ${key(c).padEnd(14)}  ${c.title}`)
  );
  if (added.length > 20) console.log(`  … and ${added.length - 20} more`);
}

if (removed.length > 0) {
  console.log("\n- REMOVED:");
  removed.forEach((c) =>
    console.log(`  - ${key(c).padEnd(14)}  ${c.title}`)
  );
}

if (modified.length > 0) {
  console.log("\n~ MODIFIED (first 20):");
  modified.slice(0, 20).forEach(({ course, changes }) => {
    console.log(`  ~ ${key(course).padEnd(14)}  ${course.title}`);
    changes.forEach((ch) => console.log(`      ${ch}`));
  });
  if (modified.length > 20) console.log(`  … and ${modified.length - 20} more`);
}

// ── Write ────────────────────────────────────────────────────────────────────

if (!WRITE) {
  console.log(`\n📋  DRY RUN — no files written.`);
  console.log(
    `    Re-run with --write to save to public/all-courses.json.\n`
  );
  console.log(
    `    After writing, run:\n    node scripts/apply-patches.js\n`
  );
} else {
  writeFileSync(OUT_PATH, JSON.stringify(fresh, null, 0), "utf8");
  // Update both meta files so Header (compile) and dev portal (runtime) are in sync
  const now = new Date();
  const label = now.toLocaleString("en-US", { month: "short", year: "numeric" });
  const metaPayload = { lastUpdated: label, courseCount: fresh.length };
  writeFileSync(META_SRC_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
  writeFileSync(META_PUB_PATH, JSON.stringify(metaPayload, null, 2) + "\n", "utf8");
  console.log(`\n✅  Saved ${fresh.length.toLocaleString()} courses → public/all-courses.json`);
  console.log(`✅  Updated dataMeta → lastUpdated: "${label}"`);
  console.log(
    `    Next step: run  node scripts/apply-patches.js  to apply manual patches.\n`
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function diffFields(oldC, newC) {
  const WATCH = ["title", "credits", "scheduleType", "nuPath", "description"];
  const out = [];
  for (const f of WATCH) {
    const ov = JSON.stringify(oldC[f]);
    const nv = JSON.stringify(newC[f]);
    if (ov !== nv) out.push(`${f}: ${ov} → ${nv}`);
  }
  return out;
}

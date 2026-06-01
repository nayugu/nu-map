#!/usr/bin/env node
/**
 * merge-nupath.js
 *
 * Backfills missing nuPath data from all-courses.json into catalog-courses.json.
 * Run after fetch/scrape steps so catalog-courses.json has complete NUpath coverage,
 * eliminating the need to download all-courses.json at runtime.
 *
 * Usage:
 *   node scripts/merge-nupath.js          # dry run (prints stats, no file written)
 *   node scripts/merge-nupath.js --write  # write changes to catalog-courses.json
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT         = resolve(__dirname, "..");
const CATALOG_PATH = resolve(ROOT, "public/northeastern/catalog-courses.json");
const ALL_PATH     = resolve(ROOT, "public/northeastern/all-courses.json");
const WRITE        = process.argv.includes("--write");

if (!existsSync(CATALOG_PATH)) { console.error("catalog-courses.json not found."); process.exit(1); }
if (!existsSync(ALL_PATH))     { console.error("all-courses.json not found. Run npm run data:fetch first."); process.exit(1); }

const catalog    = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
const allCourses = JSON.parse(readFileSync(ALL_PATH, "utf8"));

// Build nuPath lookup from all-courses.json keyed by courseId ("CS3500").
const nuPathLookup = {};
for (const c of (Array.isArray(allCourses) ? allCourses : [])) {
  const id = `${(c.subject || "").toUpperCase().trim()}${(c.number || "").trim()}`;
  if (id && c.nuPath?.length) nuPathLookup[id] = c.nuPath;
}

const raw    = Array.isArray(catalog) ? catalog : Object.values(catalog).flat();
const before = raw.filter(c => c.nuPath?.length > 0).length;

const updated = raw.map(c => {
  if (c.nuPath?.length) return c; // already has nuPath — don't overwrite
  const id = `${(c.subject || "").toUpperCase().trim()}${(c.number || "").trim()}`;
  const nuPath = nuPathLookup[id];
  return nuPath ? { ...c, nuPath } : c;
});

const after = updated.filter(c => c.nuPath?.length > 0).length;
const total = updated.length;

console.log(`\nnuPath merge:`);
console.log(`  Before : ${before} / ${total} courses with nuPath (${Math.round(before / total * 100)}%)`);
console.log(`  After  : ${after}  / ${total} courses with nuPath (${Math.round(after  / total * 100)}%)`);
console.log(`  Added  : ${after - before}`);

if (after / total < 0.10) {
  console.warn(`\nWARNING: nuPath coverage is only ${Math.round(after / total * 100)}% after merge.`);
  console.warn(`  all-courses.json may be stale or missing nuPath data.`);
}

if (!WRITE) {
  console.log(`\nDry run — pass --write to save.\n`);
} else {
  // Preserve original format (array or object)
  const out = Array.isArray(catalog) ? updated : (() => {
    const obj = {};
    let i = 0;
    for (const key of Object.keys(catalog)) obj[key] = updated.slice(i, i += catalog[key].length);
    return obj;
  })();
  writeFileSync(CATALOG_PATH, JSON.stringify(out), "utf8");
  console.log(`Saved → catalog-courses.json\n`);
}

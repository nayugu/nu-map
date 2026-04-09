#!/usr/bin/env node
/**
 * apply-nupath-map.js
 *
 * Merges data/northeastern/nupath-map.json into public/northeastern/all-courses.json.
 * Overwrites the nuPath field for every course found in the map.
 * Courses NOT in the map are left unchanged.
 *
 * Usage:
 *   node scripts/apply-nupath-map.js          # dry run
 *   node scripts/apply-nupath-map.js --write  # write changes
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");
const MAP_PATH  = resolve(ROOT, "data/northeastern/nupath-map.json");
const OUT_PATH  = resolve(ROOT, "public/northeastern/all-courses.json");
const WRITE     = process.argv.includes("--write");

if (!existsSync(MAP_PATH)) { console.error("data/northeastern/nupath-map.json not found. Run npm run data:nupath:scan first."); process.exit(1); }
if (!existsSync(OUT_PATH)) { console.error("public/northeastern/all-courses.json not found. Run npm run data:fetch first."); process.exit(1); }

const map     = JSON.parse(readFileSync(MAP_PATH, "utf8"));
const courses = JSON.parse(readFileSync(OUT_PATH, "utf8"));
const lookup  = map.courses ?? {};

let changed = 0, unchanged = 0, notInMap = 0;
const updated = courses.map(c => {
  const key = `${c.subject} ${c.number}`;
  if (!(key in lookup)) { notInMap++; return c; }
  const freshNP = lookup[key];
  if (JSON.stringify(c.nuPath ?? []) === JSON.stringify(freshNP)) { unchanged++; return c; }
  changed++;
  return { ...c, nuPath: freshNP };
});

console.log(`\nNUpath map apply:`);
console.log(`  Changed  : ${changed}`);
console.log(`  Unchanged: ${unchanged}`);
console.log(`  Not in map: ${notInMap}`);

if (!WRITE) {
  console.log(`\n📋 Dry run — pass --write to save.\n`);
} else {
  writeFileSync(OUT_PATH, JSON.stringify(updated, null, 0), "utf8");
  console.log(`\n✅ Saved ${updated.length} courses → public/all-courses.json\n`);
}

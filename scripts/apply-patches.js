#!/usr/bin/env node
/**
 * apply-patches.js
 *
 * Reads all YAML patch files from data/northeastern/patches/*.yaml and overlays them
 * on top of public/northeastern/all-courses.json.
 *
 * Patches are applied in filename order. A patch can:
 *   - add    : insert courses that don't exist (or were removed from upstream)
 *   - update : change specific fields on existing courses
 *   - remove : delete courses from the dataset
 *
 * Usage:
 *   node scripts/apply-patches.js           # dry run — shows changes, no write
 *   node scripts/apply-patches.js --write   # write patched all-courses.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

// yaml is a dev dependency — install if missing: npm install -D js-yaml
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "..");
const COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const PATCH_DIR  = resolve(ROOT, "data/northeastern/patches");

const WRITE = process.argv.includes("--write");

// ── Load data ────────────────────────────────────────────────────────────────

let courses = JSON.parse(readFileSync(COURSES, "utf8"));
const courseMap = () => new Map(courses.map((c) => [key(c), c]));
const key = (c) => `${c.subject} ${c.number}`;

// ── Load patches ─────────────────────────────────────────────────────────────

const patchFiles = readdirSync(PATCH_DIR)
  .filter((f) => f.endsWith(".yaml") && f !== "TEMPLATE.yaml")
  .sort();

if (patchFiles.length === 0) {
  console.log("\n✅  No patches found in data/patches/ — nothing to apply.\n");
  process.exit(0);
}

console.log(`\nApplying ${patchFiles.length} patch file(s)…\n`);

const log = { add: [], update: [], remove: [], errors: [] };

for (const fname of patchFiles) {
  const fpath = join(PATCH_DIR, fname);
  let patch;
  try {
    patch = yaml.load(readFileSync(fpath, "utf8"));
  } catch (err) {
    log.errors.push(`${fname}: parse error — ${err.message}`);
    continue;
  }

  const map = courseMap();

  // ── additions ────────────────────────────────────────────────────────────
  for (const c of patch?.courses?.add ?? []) {
    const k = key(c);
    if (map.has(k)) {
      log.errors.push(`${fname}: add ${k} — course already exists (use update)`);
    } else {
      // Ensure required fields have defaults
      courses.push({
        subject: c.subject,
        number: c.number,
        title: c.title ?? "",
        scheduleType: c.scheduleType ?? "Lecture",
        credits: c.credits ?? 4,
        nuPath: c.nuPath ?? [],
        sections: c.sections ?? [],
        description: c.description ?? "",
        coreqs: c.coreqs ?? [],
        prereqs: c.prereqs ?? [],
      });
      log.add.push(`+ ${k}  ${c.title ?? ""}`);
    }
  }

  // ── updates ───────────────────────────────────────────────────────────────
  for (const upd of patch?.courses?.update ?? []) {
    const k = `${upd.subject} ${upd.number}`;
    const idx = courses.findIndex((c) => key(c) === k);
    if (idx === -1) {
      log.errors.push(`${fname}: update ${k} — course not found`);
    } else {
      const changes = [];
      for (const [field, value] of Object.entries(upd.fields ?? {})) {
        const old = JSON.stringify(courses[idx][field]);
        courses[idx][field] = value;
        changes.push(`  ${field}: ${old} → ${JSON.stringify(value)}`);
      }
      log.update.push(`~ ${k}\n${changes.join("\n")}`);
    }
  }

  // ── removals ──────────────────────────────────────────────────────────────
  for (const rem of patch?.courses?.remove ?? []) {
    const k = `${rem.subject} ${rem.number}`;
    const before = courses.length;
    courses = courses.filter((c) => key(c) !== k);
    if (courses.length === before) {
      log.errors.push(`${fname}: remove ${k} — course not found (already gone?)`);
    } else {
      log.remove.push(`- ${k}  ${rem.reason ?? ""}`);
    }
  }

  console.log(`  ✓ ${fname}`);
}

// ── Report ───────────────────────────────────────────────────────────────────

const sep = "─".repeat(60);
console.log(`\n${sep}`);
console.log("  PATCH SUMMARY");
console.log(sep);
console.log(`  + Added    : ${log.add.length}`);
console.log(`  ~ Updated  : ${log.update.length}`);
console.log(`  - Removed  : ${log.remove.length}`);
if (log.errors.length) console.log(`  ⚠ Errors   : ${log.errors.length}`);
console.log(sep);

if (log.add.length)    { console.log("\n+ ADDED:");    log.add.forEach(l => console.log("  " + l)); }
if (log.update.length) { console.log("\n~ UPDATED:");  log.update.forEach(l => console.log("  " + l)); }
if (log.remove.length) { console.log("\n- REMOVED:");  log.remove.forEach(l => console.log("  " + l)); }
if (log.errors.length) { console.log("\n⚠ ERRORS:");   log.errors.forEach(l => console.log("  " + l)); }

// ── Write ────────────────────────────────────────────────────────────────────

if (!WRITE) {
  console.log(`\n📋  DRY RUN — no files written.`);
  console.log(`    Re-run with --write to save.\n`);
} else if (log.errors.length > 0) {
  console.log(`\n❌  Errors found — fix patches before writing.\n`);
  process.exit(1);
} else {
  writeFileSync(COURSES, JSON.stringify(courses, null, 0), "utf8");
  console.log(`\n✅  Wrote ${courses.length.toLocaleString()} courses → public/all-courses.json\n`);
}

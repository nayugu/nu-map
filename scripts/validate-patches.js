#!/usr/bin/env node
/**
 * validate-patches.js
 *
 * Validates all YAML files in data/northeastern/patches/ against the schema.
 * Run by CI on every PR that touches data/northeastern/patches/.
 *
 * Exits with code 1 if any errors are found.
 *
 * Usage:
 *   node scripts/validate-patches.js
 *   node scripts/validate-patches.js --json    # output machine-readable JSON
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

import yaml from "js-yaml";

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "..");
const PATCH_DIR  = resolve(ROOT, "data/northeastern/patches");
const COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");

const JSON_OUT = process.argv.includes("--json");

// ── Load course keys for reference validation ────────────────────────────────

const existingKeys = new Set(
  JSON.parse(readFileSync(COURSES, "utf8")).map((c) => `${c.subject} ${c.number}`)
);

// ── Schema helpers ───────────────────────────────────────────────────────────

const REQUIRED_ADD_FIELDS = ["subject", "number", "title", "credits"];
const VALID_SCHED = ["Lecture", "Lab", "Seminar", "Studio", "Individual Instruction", "Off-campus instruction"];
const VALID_NUPATH = ["ND","EI","IC","FQ","SI","AD","DD","ER","CE","WI","EX","NUpath Elective","Writing Intensive"];

function assertString(val, path) {
  if (typeof val !== "string" || val.trim() === "")
    return `${path} must be a non-empty string`;
}
function assertNumber(val, path) {
  if (typeof val !== "number" || val <= 0)
    return `${path} must be a positive number`;
}
function validateCourseAdd(c, fname, idx) {
  const errs = [];
  const p = `${fname} → courses.add[${idx}]`;
  for (const f of REQUIRED_ADD_FIELDS) {
    if (c[f] == null) errs.push(`${p}.${f} is required`);
  }
  if (typeof c.subject === "string" && !/^[A-Z]{2,6}$/.test(c.subject.trim()))
    errs.push(`${p}.subject must be 2–6 uppercase letters (e.g. "CS")`);
  if (typeof c.number === "string" && !/^\d{4}([A-Z]?)$/.test(c.number.trim()))
    errs.push(`${p}.number must be a 4-digit string (e.g. "2500")`);
  if (c.credits != null) {
    const e = assertNumber(c.credits, `${p}.credits`);
    if (e) errs.push(e);
  }
  if (c.scheduleType && !VALID_SCHED.includes(c.scheduleType))
    errs.push(`${p}.scheduleType "${c.scheduleType}" not recognised. Valid: ${VALID_SCHED.join(", ")}`);
  if (Array.isArray(c.nuPath)) {
    c.nuPath.forEach((np, i) => {
      if (!VALID_NUPATH.includes(np))
        errs.push(`${p}.nuPath[${i}] "${np}" not a valid NUPath code`);
    });
  }
  if (existingKeys.has(`${c.subject} ${c.number}`))
    errs.push(`${p} — ${c.subject} ${c.number} already exists in the dataset (use update instead)`);
  return errs;
}

function validateCourseUpdate(u, fname, idx) {
  const errs = [];
  const p = `${fname} → courses.update[${idx}]`;
  if (!u.subject || !u.number) errs.push(`${p}: subject and number are required`);
  if (!u.fields || Object.keys(u.fields).length === 0)
    errs.push(`${p}: fields object is required and must not be empty`);
  if (u.subject && u.number && !existingKeys.has(`${u.subject} ${u.number}`))
    errs.push(`${p}: ${u.subject} ${u.number} not found in current dataset`);
  return errs;
}

function validateCourseRemove(r, fname, idx) {
  const errs = [];
  const p = `${fname} → courses.remove[${idx}]`;
  if (!r.subject || !r.number) errs.push(`${p}: subject and number are required`);
  if (r.subject && r.number && !existingKeys.has(`${r.subject} ${r.number}`))
    errs.push(`${p}: ${r.subject} ${r.number} not found in current dataset (already removed?)`);
  return errs;
}

// ── Main validation loop ─────────────────────────────────────────────────────

const patchFiles = readdirSync(PATCH_DIR)
  .filter((f) => f.endsWith(".yaml") && f !== "TEMPLATE.yaml")
  .sort();

const results = [];
let totalErrors = 0;

for (const fname of patchFiles) {
  const fpath = join(PATCH_DIR, fname);
  const fileErrors = [];

  let patch;
  try {
    patch = yaml.load(readFileSync(fpath, "utf8"));
  } catch (err) {
    fileErrors.push(`YAML parse error: ${err.message}`);
    results.push({ file: fname, errors: fileErrors });
    totalErrors += fileErrors.length;
    continue;
  }

  // Top-level meta
  if (!patch?.meta?.date) fileErrors.push("meta.date is required (YYYY-MM-DD)");
  if (!patch?.meta?.reason) fileErrors.push("meta.reason is required");

  // Course sections
  (patch?.courses?.add ?? []).forEach((c, i) =>
    fileErrors.push(...validateCourseAdd(c, fname, i))
  );
  (patch?.courses?.update ?? []).forEach((u, i) =>
    fileErrors.push(...validateCourseUpdate(u, fname, i))
  );
  (patch?.courses?.remove ?? []).forEach((r, i) =>
    fileErrors.push(...validateCourseRemove(r, fname, i))
  );

  results.push({ file: fname, errors: fileErrors });
  totalErrors += fileErrors.length;
}

// ── Output ───────────────────────────────────────────────────────────────────

if (JSON_OUT) {
  console.log(JSON.stringify({ files: results, totalErrors }, null, 2));
} else {
  const sep = "─".repeat(60);
  console.log(`\n${sep}`);
  console.log(`  PATCH VALIDATION  (${patchFiles.length} file(s))`);
  console.log(sep);

  if (patchFiles.length === 0) {
    console.log("  No patch files found.\n");
    process.exit(0);
  }

  for (const r of results) {
    if (r.errors.length === 0) {
      console.log(`  ✅  ${r.file}`);
    } else {
      console.log(`  ❌  ${r.file}`);
      r.errors.forEach((e) => console.log(`       • ${e}`));
    }
  }

  console.log(sep);
  if (totalErrors === 0) {
    console.log(`  All patches valid.\n`);
  } else {
    console.log(`  ${totalErrors} error(s) found. Fix before merging.\n`);
    process.exit(1);
  }
}

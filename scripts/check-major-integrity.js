#!/usr/bin/env node
/**
 * check-major-integrity.js
 *
 * Guards against "impossible-to-satisfy" requirement sections across ALL majors.
 *
 * The failure mode this catches (originally surfaced by the IECS combined major):
 * a course is listed as a plain required COURSE in more than one section without being
 * marked as split/shared credit. Because allocation uses each course at most once within
 * a major, the earliest section consumes it and every later section that also lists it
 * becomes mathematically unsatisfiable — a student who literally takes every listed
 * course still shows the section as incomplete. See scripts/scrape-majors.js (split-credit
 * XOM emission) and src/core/gradRequirements.js (XOM single-course split-credit path).
 *
 * Invariant checked, per section: if the section is satisfiable when a course may satisfy
 * everything it matches (checkSection — no allocation), it must also be satisfiable after
 * allocation (allocateMajor). A gap means the section can never be completed. This compares
 * two existing code paths, so it stays correct as the requirement schema evolves and cannot
 * false-positive on RANGE/OR/XOM-pool structures (both paths see the same placements).
 *
 * A committed baseline (major-integrity-baseline.json) records the currently-known set of
 * such sections. The test fails only when a NEW impossible section appears — i.e. a scraper
 * regression or a new major that reintroduces the bug. When the debt shrinks (e.g. after a
 * re-scrape converts explicit "counts toward the X requirement" rows into split-credit XOM),
 * rerun with --update to record the improvement.
 *
 * Usage:
 *   node scripts/check-major-integrity.js            # verify against baseline (CI/test)
 *   node scripts/check-major-integrity.js --update   # rewrite the baseline to current state
 *   node scripts/check-major-integrity.js --list     # print every current flag and exit 0
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { impossibleSectionTitles } from './lib/major-integrity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
export const BASELINE = resolve(__dirname, 'major-integrity-baseline.json');

/** Return sorted `"<relpath> :: <title>"` flags for sections impossible under allocation. */
export function findImpossibleSections() {
  const files = execSync(
    "find data/northeastern/programs/undergraduate data/northeastern/programs/graduate -name 'requirements.json'",
    { cwd: ROOT }
  ).toString().trim().split('\n').filter(Boolean);

  const flags = [];
  for (const rel of files) {
    let major;
    try { major = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')); } catch { continue; }
    for (const title of impossibleSectionTitles(major)) {
      flags.push(`${rel.replace(/^data\/northeastern\/programs\//, '')} :: ${title}`);
    }
  }
  return [...new Set(flags)].sort();
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return [];
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { return []; }
}

function main() {
  const args = process.argv.slice(2);
  const current = findImpossibleSections();

  if (args.includes('--list')) {
    current.forEach((f) => console.log(f));
    console.log(`\n${current.length} impossible section(s).`);
    return;
  }

  if (args.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    console.log(`✅  Baseline updated: ${current.length} known impossible section(s).`);
    return;
  }

  const baseline = new Set(loadBaseline());
  const currentSet = new Set(current);
  const added = current.filter((f) => !baseline.has(f));
  const removed = [...baseline].filter((f) => !currentSet.has(f));

  if (removed.length) {
    console.log(`ℹ️  ${removed.length} previously-broken section(s) are now fixed:`);
    removed.forEach((f) => console.log(`   - ${f}`));
    console.log('   Run `node scripts/check-major-integrity.js --update` to record this.\n');
  }

  if (added.length) {
    console.error(`❌  ${added.length} NEW impossible-to-satisfy section(s) detected:`);
    added.forEach((f) => console.error(`   + ${f}`));
    console.error(
      '\nA course is required in this section but consumed by an earlier one. Either it is a\n' +
      'shared/split-credit course (emit as a single-course XOM — see scrape-majors.js), or a\n' +
      'true duplicate to merge. If this is expected debt, run with --update to accept it.'
    );
    process.exit(1);
  }

  console.log(`✅  No new impossible sections. (${baseline.size} known, tracked in baseline.)`);
}

// Run only when invoked as a CLI, not when imported by a test.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

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
import { impossibleSectionTitles, overconsumingPoolTitles } from './lib/major-integrity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
export const BASELINE = resolve(__dirname, 'major-integrity-baseline.json');
export const OVERCONSUMPTION_BASELINE = resolve(__dirname, 'major-overconsumption-baseline.json');

function programFiles() {
  return execSync(
    "find data/northeastern/programs/undergraduate data/northeastern/programs/graduate -name 'requirements.json'",
    { cwd: ROOT }
  ).toString().trim().split('\n').filter(Boolean);
}

/** Return sorted `"<relpath> :: <title>"` flags for sections impossible under allocation. */
export function findImpossibleSections() {
  const flags = [];
  for (const rel of programFiles()) {
    let major;
    try { major = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')); } catch { continue; }
    for (const title of impossibleSectionTitles(major)) {
      flags.push(`${rel.replace(/^data\/northeastern\/programs\//, '')} :: ${title}`);
    }
  }
  return [...new Set(flags)].sort();
}

/**
 * Return sorted `"<relpath> :: <title>"` flags for sections whose pools over-consume named
 * courses beyond their own credit threshold (see overconsumingPoolTitles) — the "still
 * technically satisfiable, but silently starves a later overlapping section" failure mode
 * that findImpossibleSections cannot see, since it only checks boolean satisfiability.
 */
export function findOverconsumingPools() {
  const flags = [];
  for (const rel of programFiles()) {
    let major;
    try { major = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8')); } catch { continue; }
    for (const title of overconsumingPoolTitles(major)) {
      flags.push(`${rel.replace(/^data\/northeastern\/programs\//, '')} :: ${title}`);
    }
  }
  return [...new Set(flags)].sort();
}

function loadBaselineFile(path) {
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return []; }
}

/** Diff `current` flags against a baseline file, reporting added/removed with the given labels. */
function reportDiff({ current, baselinePath, addedLabel, fixMessage }) {
  const baseline = new Set(loadBaselineFile(baselinePath));
  const currentSet = new Set(current);
  const added = current.filter((f) => !baseline.has(f));
  const removed = [...baseline].filter((f) => !currentSet.has(f));

  if (removed.length) {
    console.log(`ℹ️  ${removed.length} previously-flagged section(s) are now fixed:`);
    removed.forEach((f) => console.log(`   - ${f}`));
  }
  if (added.length) {
    console.error(`❌  ${added.length} NEW ${addedLabel}:`);
    added.forEach((f) => console.error(`   + ${f}`));
    console.error(`\n${fixMessage}`);
  }
  return { baseline, added, removed };
}

function main() {
  const args = process.argv.slice(2);
  const current = findImpossibleSections();
  const currentOverconsuming = findOverconsumingPools();

  if (args.includes('--list')) {
    current.forEach((f) => console.log(f));
    console.log(`\n${current.length} impossible section(s).`);
    currentOverconsuming.forEach((f) => console.log(f));
    console.log(`${currentOverconsuming.length} over-consuming pool section(s).`);
    return;
  }

  if (args.includes('--update')) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    writeFileSync(OVERCONSUMPTION_BASELINE, JSON.stringify(currentOverconsuming, null, 2) + '\n');
    console.log(`✅  Baselines updated: ${current.length} impossible, ${currentOverconsuming.length} over-consuming.`);
    return;
  }

  const { baseline, added } = reportDiff({
    current,
    baselinePath: BASELINE,
    addedLabel: 'impossible-to-satisfy section(s) detected',
    fixMessage:
      'A course is required in this section but consumed by an earlier one. Either it is a\n' +
      'shared/split-credit course (emit as a single-course XOM — see scrape-majors.js), or a\n' +
      'true duplicate to merge. If this is expected debt, run with --update to accept it.',
  });

  const { baseline: overBaseline, added: overAdded } = reportDiff({
    current: currentOverconsuming,
    baselinePath: OVERCONSUMPTION_BASELINE,
    addedLabel: 'over-consuming pool section(s) detected',
    fixMessage:
      'A pool in this section consumed more named-course credit than its numCreditsMin needed,\n' +
      'which can starve a later section listing the same courses even though this one never goes\n' +
      'fully unsatisfiable. Check for a scraper regression in the XOM/RANGE consumption cap\n' +
      '(src/core/gradRequirements.js). If this is expected (e.g. an AND-paired lecture+lab whose\n' +
      'combined credit exceeds the pool minimum), run with --update to accept it.',
  });

  if (added.length || overAdded.length) process.exit(1);

  console.log(
    `✅  No new flags. (${baseline.size} known impossible, ${overBaseline.size} known over-consuming, tracked in baselines.)`
  );
}

// Run only when invoked as a CLI, not when imported by a test.
// `process.argv[1] &&`: with no script path (`node -e`, a REPL, a worker) this
// otherwise throws on import instead of declining to run. See verify-majors.js.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

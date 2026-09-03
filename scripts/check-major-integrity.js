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

// A flag is a PATH, and a path carries the catalog edition:
// `undergraduate/2026/science/x_bs/requirements.json :: Electives`.
const EDITION_PATH = /^(\w+)\/(\d{4})\/(.+)$/;

/**
 * Re-key a flag onto another edition, so accepted debt can be recognised after
 * the catalog rolls.
 *
 * Without this every entry in the baseline stops matching on the first scrape
 * of a new edition, and every carried-over section is reported as NEW. Measured
 * on the real 2027 scrape: 11 over-consuming pools reported, of which 4 were
 * the identical program and section already accepted for 2026 — noise in a gate
 * that exits 1 and stops the pipeline, which is how a gate gets `--update`d
 * without being read. The other 7 were real, and are what should have been
 * shown.
 */
const reEdition = (flag, year) => flag.replace(EDITION_PATH, `$1/${year}/$3`);

/** Diff `current` flags against a baseline file, reporting added/removed with the given labels. */
function reportDiff({ current, baselinePath, addedLabel, fixMessage }) {
  const baselineList = loadBaselineFile(baselinePath);
  const baseline = new Set(baselineList);
  const currentSet = new Set(current);

  // Editions the baseline knows about, newest first, so a 2027 flag is checked
  // against 2026 before 2025.
  const knownYears = [...new Set(baselineList
    .map((f) => EDITION_PATH.exec(f)?.[2]).filter(Boolean))]
    .sort().reverse();
  const carriedOver = (flag) => {
    const m = EDITION_PATH.exec(flag);
    if (!m) return false;
    return knownYears.some((y) => y !== m[2] && baseline.has(reEdition(flag, y)));
  };

  const added = current.filter((f) => !baseline.has(f) && !carriedOver(f));
  // Likewise the other direction: a 2026 entry is not "now fixed" merely
  // because the corpus has moved to 2027 under a different path.
  const stillFlagged = (flag) => {
    const m = EDITION_PATH.exec(flag);
    if (!m) return false;
    return [...currentSet].some((c) => {
      const cm = EDITION_PATH.exec(c);
      return cm && cm[2] !== m[2] && reEdition(c, m[2]) === flag;
    });
  };
  const removed = [...baseline].filter((f) => !currentSet.has(f) && !stillFlagged(f));

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

#!/usr/bin/env node
/**
 * migrate-shared-sections.js
 *
 * One-time repair of existing major data: marks every "impossible" requirement section
 * (satisfiable in principle but unsatisfiable after allocation — see lib/major-integrity.js)
 * with `shared: true`, so the allocator counts its cross-listed courses without consuming
 * them. This fixes integrative / GPA-credit re-lists / duplicate sections en masse without
 * re-scraping. Going forward, scripts/scrape-majors.js applies the same marking on each run.
 *
 * Usage:
 *   node scripts/migrate-shared-sections.js            # dry run — report what would change
 *   node scripts/migrate-shared-sections.js --write    # apply and rewrite the data files
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { markSharedSections } from './lib/major-integrity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

const files = execSync(
  "find data/northeastern/programs/undergraduate data/northeastern/programs/graduate -name 'requirements.json'",
  { cwd: ROOT }
).toString().trim().split('\n').filter(Boolean);

let filesChanged = 0, sectionsMarked = 0;
for (const rel of files) {
  const path = resolve(ROOT, rel);
  let major;
  try { major = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }

  const marked = markSharedSections(major);
  if (marked > 0) {
    filesChanged++;
    sectionsMarked += marked;
    const shared = major.requirementSections.filter((s) => s.shared).map((s) => s.title);
    console.log(`  ${rel.replace(/^src\/data\//, '')}  (+${marked}): ${shared.join(', ')}`);
    if (WRITE) writeFileSync(path, JSON.stringify(major, null, 2) + '\n');
  }
}

console.log(
  `\n${WRITE ? 'Marked' : 'Would mark'} ${sectionsMarked} shared section(s) across ${filesChanged} file(s).`
);
if (!WRITE) console.log('Run with --write to apply.');

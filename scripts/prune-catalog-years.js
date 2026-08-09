#!/usr/bin/env node
/**
 * prune-catalog-years.js
 *
 * Retention for the frozen per-edition program trees.
 *
 * Requirements are locked to the catalog edition a student entered under, so
 * src/data/{majors,grad-majors}/<year>/ accumulates one directory per edition
 * and older ones are never rescraped. Without a bound that grows forever; with
 * too tight a bound we delete the requirements a real student still follows.
 *
 * KEEP_YEARS = 7 comes from the longest realistic path, not a round number:
 * a fall entrant on co-op normally graduates in 5, and a leave or an extra
 * co-op cycle makes 6 ordinary. 7 covers that with a year of margin, and
 * anything older belongs to a student whose audit should be an advisor
 * conversation anyway.
 *
 * ARCHIVE EDITIONS ARE NOT TOUCHED. data/northeastern/programs/archive/ is a separate tree and
 * TREES below does not include it, deliberately: the six editions backfilled
 * from catalog.northeastern.edu/archive/ are the ones this retention window
 * was sized for. With the live 2026 edition they come to exactly KEEP_YEARS.
 *
 * The consequence to remember when 2027 lands: the live tree starts
 * accumulating again while the archive stays fixed, so the total exceeds 7 and
 * the OLDEST archived edition — not the oldest live one — is the right thing
 * to retire. That is a manual judgement, which is why nothing here automates
 * it. But note the asymmetry: a live edition can be rescraped from the archive
 * later, and the oldest archived one cannot be recovered from anywhere.
 *
 * Deleting an edition is irreversible — NEU does not serve retired editions in
 * a form we can rescrape — so this NEVER runs automatically. It is a manual
 * command, it refuses to leave fewer than KEEP_YEARS directories, and --write
 * is required.
 *
 * Usage:
 *   node scripts/prune-catalog-years.js            # report only
 *   node scripts/prune-catalog-years.js --write    # actually delete
 */
import { readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT  = join(dirname(fileURLToPath(import.meta.url)), '..');
const TREES = ['data/northeastern/programs/majors', 'data/northeastern/programs/grad-majors'];
const KEEP_YEARS = 7;
const WRITE = process.argv.includes('--write');

let deleted = 0;
for (const tree of TREES) {
  const dir = join(ROOT, tree);
  let years;
  try {
    years = readdirSync(dir)
      .filter(n => /^\d{4}$/.test(n) && statSync(join(dir, n)).isDirectory())
      .map(Number)
      .sort((a, b) => b - a);
  } catch { continue; }

  const keep = years.slice(0, KEEP_YEARS);
  const drop = years.slice(KEEP_YEARS);
  console.log(`${tree}: ${years.length} edition(s) [${years.join(', ')}]`);
  if (!drop.length) { console.log(`  nothing to prune (keeping ${KEEP_YEARS})`); continue; }
  console.log(`  keep: ${keep.join(', ')}`);
  console.log(`  DROP: ${drop.join(', ')}`);
  for (const y of drop) {
    if (WRITE) { rmSync(join(dir, String(y)), { recursive: true, force: true }); deleted++; }
  }
}

console.log(WRITE
  ? `\n✅  Pruned ${deleted} edition director${deleted === 1 ? 'y' : 'ies'}. Rebuild the bundle: npm run data:programs-bundle`
  : `\n📋  Report only — pass --write to delete. This is irreversible: retired catalog editions cannot be rescraped.`);

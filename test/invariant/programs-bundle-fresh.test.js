// INVARIANT · programs-bundle.json must match src/data.
//
// The bundle is what the hosted MCP worker serves: it can't read 1,017 files
// over the network, so it fetches this single artifact from GitHub raw. That
// makes it a COPY of the source tree, and copies drift — this one sat six
// weeks stale, so production MCP was answering from data that predated a whole
// parser rewrite while local tools were current.
//
// Regenerating it is cheap (`npm run data:programs-bundle`). Noticing it went
// stale was the part with no mechanism, so that's what this supplies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '../..');
const bundle = JSON.parse(readFileSync(join(ROOT, 'public/northeastern/programs-bundle.json'), 'utf8'));

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === 'requirements.json') out.push(p);
  }
  return out;
}
const files = [...walk(join(ROOT, 'data/northeastern/programs/undergraduate')), ...walk(join(ROOT, 'data/northeastern/programs/graduate'))];

test('bundle › contains every program in src/data, and no extras', () => {
  const onDisk = files.length;
  const inBundle = Object.keys(bundle.programData).length;
  assert.equal(inBundle, onDisk,
    `bundle has ${inBundle} programs, src/data has ${onDisk} — run: npm run data:programs-bundle`);
});

test('bundle › program ids are unique', () => {
  // The undergrad and graduate PharmD are different programs on different
  // catalog pages. While ids were year/college/folder they collided, and
  // programData — being keyed by id — silently kept only one, leaving the
  // other unreachable in the app and the MCP.
  const ids = bundle.programs.map(p => p.id);
  const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert.deepEqual([...new Set(dupes)], []);

  // ⚠ This used to assert `programData.length === ids.length`, which held only
  // while exactly ONE edition was on disk. `programRegistry.node.js` says
  // outright that the two are different sets once editions are retained:
  // programData keeps EVERY catalog year, because an id carries its year and a
  // student's frozen edition has to stay reachable, while the browsable LIST is
  // deduped to one row per program so `list_programs` does not grow by ~1,000
  // near-identical rows per year kept. The 2027 roll made that real — 1,722
  // records against 1,213 listed — and the equality failed while nothing was
  // wrong.
  //
  // What the collision it was written for actually looks like: two programs
  // sharing an id, so programData silently keeps one and the other is
  // unreachable. That is checked directly instead — every listed id resolves,
  // and no two records share a key.
  const keys = Object.keys(bundle.programData);
  assert.equal(new Set(keys).size, keys.length, 'two records share a programData key');
  const missing = ids.filter(id => !(id in bundle.programData));
  assert.deepEqual(missing, [], 'a listed program has no record in programData');
  assert.ok(keys.length >= ids.length,
    `programData (${keys.length}) cannot hold fewer records than the list names (${ids.length})`);
});

test('bundle › every program matches its source file', () => {
  // Compare the fields that change when the scraper or verifier runs. A full
  // deep-equal would be stricter but slower and noisier; these move together.
  // Keyed by the same id the registry builds — grad ids carry a "grad/"
  // prefix, so folder alone is not unique.
  const byId = new Map(Object.entries(bundle.programData));
  const drift = [];
  for (const f of files) {
    const src = JSON.parse(readFileSync(f, 'utf8'));
    const parts = f.split('/');
    const [year, college, folder] = parts.slice(-4, -1);
    const id = f.includes('/graduate/') ? `grad/${year}/${college}/${folder}`
                                           : `${year}/${college}/${folder}`;
    const b = byId.get(id);
    if (!b) { drift.push(`${id}: absent from bundle`); continue; }
    const shape = p => [
      p.requirementSections?.length ?? 0,
      p.concentrations?.concentrationOptions?.length ?? 0,
      p.totalCreditsRequired ?? 0,
      p.metadata?.verification?.level ?? null,
    ].join('|');
    if (shape(src) !== shape(b)) drift.push(`${id}: src ${shape(src)} vs bundle ${shape(b)}`);
  }
  assert.deepEqual(drift.slice(0, 8), [],
    `${drift.length} program(s) differ — run: npm run data:programs-bundle`);
});

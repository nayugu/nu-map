#!/usr/bin/env node
/**
 * bundle-diff.js — is a freshly-scraped programs bundle safe to ship?
 *
 * A scrape rewrites ~1,000 files at once and pushes to main unattended, so
 * "the diff is big" tells you nothing. What matters is WHICH kinds of change
 * happened. This compares two programs-bundle.json snapshots and sorts every
 * difference into buckets a human can judge:
 *
 *   · programs lost / gained          — the only two that can strand a student
 *   · credit totals moved             — the number an advisor reads
 *   · requirement sections gained/lost
 *   · concentrations gained/lost
 *   · verification level moved
 *
 * It also reports the specific defects the variant split was built to remove,
 * so a run can be checked against its own claim rather than eyeballed:
 * duplicated concentration menus, "(n)"-suffixed titles, and programs whose
 * panes were merged when they should have split.
 *
 *   node scripts/bundle-diff.js <before.json> [after.json]
 */
import { readFileSync } from 'fs';

const [beforePath, afterPath = 'public/northeastern/programs-bundle.json'] = process.argv.slice(2);
if (!beforePath) {
  console.error('usage: bundle-diff.js <before.json> [after.json]');
  process.exit(2);
}

const load = p => JSON.parse(readFileSync(p, 'utf8'));
const A = load(beforePath), B = load(afterPath);

const index = bundle => {
  const m = new Map();
  for (const p of bundle.programs) m.set(p.id, p);
  return m;
};
const ia = index(A), ib = index(B);

const shape = (bundle, id) => {
  const d = bundle.programData[id] ?? {};
  return {
    sections: (d.requirementSections ?? []).length,
    conc:     (d.concentrations?.concentrationOptions ?? []).length,
    sh:       d.totalCreditsRequired ?? 0,
    variant:  d.metadata?.variant?.modality ?? null,
  };
};

const lost   = [...ia.keys()].filter(id => !ib.has(id));
const gained = [...ib.keys()].filter(id => !ia.has(id));
const both   = [...ia.keys()].filter(id => ib.has(id));

const shMoved = [], secMoved = [], concMoved = [], verMoved = [];
for (const id of both) {
  const a = shape(A, id), b = shape(B, id);
  if (a.sh !== b.sh)         shMoved.push([id, a.sh, b.sh]);
  if (a.sections !== b.sections) secMoved.push([id, a.sections, b.sections]);
  if (a.conc !== b.conc)     concMoved.push([id, a.conc, b.conc]);
  const va = ia.get(id).verification?.level ?? 'none';
  const vb = ib.get(id).verification?.level ?? 'none';
  if (va !== vb) verMoved.push([id, va, vb]);
}

const head = (label, rows, fmt = r => r.join('  ')) => {
  console.log(`\n${label}: ${rows.length}`);
  for (const r of rows.slice(0, 25)) console.log('   ' + fmt(r));
  if (rows.length > 25) console.log(`   … and ${rows.length - 25} more`);
};

console.log(`programs: ${ia.size} → ${ib.size}`);
head('LOST (a saved plan pointing here breaks)', lost, id => id);
head('GAINED', gained, id => `${id}  "${ib.get(id).label}"`);
head('credit total moved', shMoved, ([id, a, b]) => `${a} → ${b}   ${id}`);
head('sections moved', secMoved, ([id, a, b]) => `${a} → ${b}   ${id}`);
head('concentrations moved', concMoved, ([id, a, b]) => `${a} → ${b}   ${id}`);
head('verification level moved', verMoved, ([id, a, b]) => `${a} → ${b}   ${id}`);

// ── The defects this change exists to remove ────────────────────────────────

const defects = bundle => {
  let dupConc = 0, suffixConc = 0, suffixSec = 0, progs = new Set();
  for (const [id, d] of Object.entries(bundle.programData)) {
    const opts = d.concentrations?.concentrationOptions ?? [];
    const titles = opts.map(o => o.title);
    if (new Set(titles).size !== titles.length) { dupConc++; progs.add(id); }
    for (const t of titles) if (/ \(\d+\)$/.test(t)) { suffixConc++; progs.add(id); }
    for (const s of d.requirementSections ?? []) {
      if (/ \(\d+\)$/.test(s.title ?? '')) suffixSec++;
    }
  }
  return { dupConc, suffixConc, suffixSec, progs: progs.size };
};
const da = defects(A), db = defects(B);
console.log('\n── the defects the variant split targets ──');
console.log(`  concentration titles ending "(n)":  ${da.suffixConc} → ${db.suffixConc}`);
console.log(`  requirement sections ending "(n)":  ${da.suffixSec} → ${db.suffixSec}`);
console.log(`  programs with an exact dup title:   ${da.dupConc} → ${db.dupConc}`);

const variants = Object.entries(B.programData).filter(([, d]) => d.metadata?.variant);
const byMod = {};
for (const [, d] of variants) {
  const m = d.metadata.variant.modality;
  byMod[m] = (byMod[m] ?? 0) + 1;
}
console.log(`  variant programs emitted:           ${variants.length}`, byMod);

// A variant must never carry the primary's plan, and must differ from it
// somewhere — otherwise the split invented a program rather than found one.
// A variant shares its page with its primary, so sourceUrl pairs them exactly —
// no slug arithmetic needed.
const primaryByUrl = new Map();
for (const [id, d] of Object.entries(B.programData)) {
  if (!d.metadata?.variant && d.metadata?.sourceUrl) primaryByUrl.set(d.metadata.sourceUrl, id);
}
let identical = 0, withPlan = 0, orphaned = 0;
for (const [id, d] of variants) {
  if (d.metadata.planOfStudyCourses?.length || d.planGrid) withPlan++;
  const primaryId = primaryByUrl.get(d.metadata.sourceUrl);
  if (!primaryId) { orphaned++; continue; }
  const p = shape(B, primaryId), v = shape(B, id);
  // A variant that matches its primary in every dimension is probably not a
  // separate curriculum at all — it would mean the split invented a program.
  if (p.sh === v.sh && p.sections === v.sections && p.conc === v.conc) identical++;
}
console.log(`  variants carrying a plan witness:   ${withPlan}  (must be 0)`);
console.log(`  variants with no primary on the page:${orphaned}  (must be 0)`);
console.log(`  variants identical to their primary: ${identical}  (suspicious if high)`);

const faults = [];
if (lost.length)     faults.push(`${lost.length} program(s) disappeared`);
if (withPlan)        faults.push(`${withPlan} variant(s) carry the primary's sample plan`);
if (orphaned)        faults.push(`${orphaned} variant(s) have no primary`);
if (db.suffixConc)   faults.push(`${db.suffixConc} concentration title(s) still end in "(n)"`);
if (db.dupConc)      faults.push(`${db.dupConc} program(s) still hold an exact duplicate title`);
console.log(faults.length
  ? `\nverdict: INSPECT — ${faults.join('; ')}`
  : '\nverdict: clean — nothing lost, no duplicate concentrations, no plan leakage');
process.exit(faults.length ? 1 : 0);

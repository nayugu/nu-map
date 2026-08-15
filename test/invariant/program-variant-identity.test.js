// INVARIANT · what must be true of every program variant in the shipped data.
//
// The variant split (docs/program-variants.md) turned 46 multi-pane catalog
// pages into 36 extra program records. Every property below is one that, if it
// broke, would break silently — a student would see a plausible number that
// belonged to a different curriculum. The unit tests check the machinery; this
// checks the OUTPUT, across the whole corpus, the way it actually ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadPrograms } from '../../src/adapters/northeastern/programRegistry.node.js';
import { resolveConcentration } from '../../src/core/concentrationResolve.js';
import { parseProgram } from '../../src/adapters/northeastern/programNaming.js';

const { programs, programData, resolveProgramId } = loadPrograms();
const entries = [...programData.entries()];
const variants = entries.filter(([, d]) => d.metadata?.variant);
const primaries = entries.filter(([, d]) => !d.metadata?.variant);

test('variants exist at all — a silent regression to zero would pass every other test', () => {
  assert.ok(variants.length >= 30,
    `expected ~36 variant programs, found ${variants.length}. If the scraper stopped ` +
    `splitting panes, every check below is vacuously true.`);
});

test('no variant id collides with another program', () => {
  const ids = programs.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate program ids');
  const primaryIds = new Set(primaries.map(([id]) => id));
  for (const [id] of variants) {
    assert.ok(!primaryIds.has(id), `${id} exists as both a variant and a primary`);
  }
});

test('every variant has a primary published on the same page', () => {
  // A variant with no primary means the split lost the base curriculum — the
  // student's actual program would have vanished from the picker.
  const primaryByUrl = new Map();
  for (const [id, d] of primaries) {
    if (d.metadata?.sourceUrl) primaryByUrl.set(d.metadata.sourceUrl, id);
  }
  for (const [id, d] of variants) {
    assert.ok(primaryByUrl.has(d.metadata.sourceUrl),
      `${id} has no primary program on ${d.metadata.sourceUrl}`);
  }
});

test('no variant inherits a page-wide credit total', () => {
  // The concrete bug this guards: scoping the regex search but not the
  // fallbacks let a variant reach the sample-plan grid, which describes the
  // PRIMARY curriculum. Interdisciplinary Design and Media—Advanced Entry
  // shipped 48 SH for a degree its own pane calls "a minimum of 28".
  for (const [id, d] of variants) {
    assert.ok(!['plan-grid', 'total-hours-row'].includes(d.totalCreditsSource),
      `${id} took its total from page-wide evidence (${d.totalCreditsSource})`);
  }
});

test('no variant carries the primary\'s sample plan or witness', () => {
  // The plan pane describes the primary curriculum. Handing it to a variant
  // makes the verifier report every primary-only course as dropped — a witness
  // aimed at the wrong program is worse than no witness.
  for (const [id, d] of variants) {
    assert.equal(d.planGrid ?? null, null, `${id} carries a sample plan`);
    assert.deepEqual(d.metadata.planOfStudyCourses ?? [], [],
      `${id} carries a plan-of-study witness`);
  }
});

test('every variant folder parses back into a distinguishable label', () => {
  // The picker labels programs by parsing the FOLDER, not the JSON. An
  // unregistered modality yields a raw slug on screen and two rows a student
  // cannot tell apart.
  for (const [id, d] of variants) {
    const folder = id.split('/').pop();
    const { degree } = parseProgram(folder);
    assert.match(degree, /—/,
      `${id}: folder does not parse to a modality-bearing degree (got "${degree}")`);
    assert.doesNotMatch(d.name, /undefined/, `${id}: name contains "undefined"`);
    assert.doesNotMatch(folder, /undefined/, `${id}: folder contains "undefined"`);
  }
});

test('a stale or legacy program id never resolves to a variant', () => {
  // resolveInMap has tiered fallbacks (same college+folder, then same folder in
  // any college). Splitting programs added near-identical siblings, and a
  // fallback landing on the advanced-entry record would hand a returning
  // student a curriculum they are not on.
  for (const [id, d] of primaries) {
    if (!d.metadata?.sourceUrl) continue;
    const parts = id.replace(/^grad\//, '').split('/');
    const stale = [
      id,                                              // exact
      `${parts[0]}/WRONGCOLLEGE/${parts[2]}`,          // college renamed
      id.replace(/^grad\//, ''),                       // pre-"grad/" spelling
    ];
    for (const s of stale) {
      const hit = resolveProgramId(s);
      if (!hit) continue;
      assert.ok(!programData.get(hit)?.metadata?.variant,
        `stale id "${s}" resolved to variant ${hit}`);
    }
  }
});

test('no concentration title anywhere is a disambiguated duplicate', () => {
  // The original symptom. 22 of these shipped; the correct number is zero,
  // because a "(2)" title is a collision the renamer papered over.
  for (const [id, d] of entries) {
    for (const c of d.concentrations?.concentrationOptions ?? []) {
      assert.doesNotMatch(c.title, / \(\d+\)$/,
        `${id}: concentration "${c.title}" is a renamed duplicate`);
    }
  }
});

test('concentration titles are unique within every program', () => {
  for (const [id, d] of entries) {
    const t = (d.concentrations?.concentrationOptions ?? []).map(c => c.title);
    assert.equal(new Set(t).size, t.length, `${id} has duplicate concentration titles`);
  }
});

test('a saved "(n)" concentration clears rather than binding to the wrong one', () => {
  // Plans saved while the duplicates existed carry titles like "Concentration
  // in Accounting (2)". The right outcome is that the selection clears and the
  // student re-picks. Silently binding it to "Concentration in Accounting"
  // would be wrong information — on Public Policy PhD the twins differed by
  // 8 SH — which is worse than no information.
  const ib = programData.get('2026/business/international_business_bsib_(boston)');
  assert.ok(ib, 'International Business missing from the corpus');
  assert.equal(resolveConcentration(ib, 'Concentration in Accounting (2)'), null);
  // …while a title that is merely stale, not ambiguous, still resolves.
  assert.ok(resolveConcentration(ib, 'Concentration in Accounting'));
  assert.ok(resolveConcentration(ib, 'Accounting'), 'the menu label should still resolve');
});

test('a variant never duplicates its primary in every dimension', () => {
  // If a variant matches its primary on credits, sections AND concentrations,
  // the split probably invented a program rather than found one. Two pairs
  // legitimately share a shape while differing in content, so this asserts on
  // the requirement bodies rather than on the counts.
  const primaryByUrl = new Map();
  for (const [id, d] of primaries) {
    if (d.metadata?.sourceUrl) primaryByUrl.set(d.metadata.sourceUrl, d);
  }
  for (const [id, d] of variants) {
    const p = primaryByUrl.get(d.metadata.sourceUrl);
    if (!p) continue;
    const same = p.totalCreditsRequired === d.totalCreditsRequired
      && JSON.stringify(p.requirementSections) === JSON.stringify(d.requirementSections)
      && JSON.stringify(p.concentrations ?? null) === JSON.stringify(d.concentrations ?? null);
    assert.ok(!same, `${id} is byte-identical to its primary — the split added nothing`);
  }
});

// UNIT · scripts/lib/program-variants.js — one catalog page, one-or-more programs.
//
// These tests are adversarial on purpose. The bug this module exists to remove
// shipped for months while every guard reported green, because each guard was
// checking something adjacent to the actual invariant: table reconciliation
// counted consumption (which cannot see double-counting), and the duplicate-
// title check ran after the renamer had made the duplicates unique. So the
// tests here try to BREAK the new invariants rather than confirm them.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PANE_DECISIONS, KNOWN_PRIMARY_PANES, UnadjudicatedPaneError,
  planPanes, assertPaneCoverage, variantSlug,
} from '../../scripts/lib/program-variants.js';
import { fmtProgramLabel, parseProgram, isDegreeToken }
  from '../../src/adapters/northeastern/programNaming.js';

const pane = id => ({ id, el: null });

// ── The ratchet: an unknown pane must STOP the run ───────────────────────────

test('planPanes › throws on a pane nobody has adjudicated', () => {
  // This is the whole design. A new pane shape must never fall through to a
  // default, because the default that existed before ("merge it") is what
  // produced 159 phantom requirement sections and 22 duplicate concentrations.
  assert.throws(
    () => planPanes([pane('programrequirementstextcontainer'),
                     pane('someshinynewtextcontainer')], 'http://x'),
    err => err instanceof UnadjudicatedPaneError
        && err.paneIds.includes('someshinynewtextcontainer')
        && /adjudicate/i.test(err.message));
});

test('planPanes › reports EVERY unknown pane, not just the first', () => {
  // Fixing them one run at a time would mean one failed monthly job per pane.
  try {
    planPanes([pane('textcontainer'), pane('alpha'), pane('beta')], 'http://x');
    assert.fail('should have thrown');
  } catch (err) {
    assert.deepEqual(err.paneIds, ['alpha', 'beta']);
  }
});

test('planPanes › a single unknown pane is fine when it is the FIRST', () => {
  // The first pane is primary whatever it is called; NEU has already shipped
  // two typo'd ids ("cirriculum", "progra") and inventing a failure for a
  // one-pane page would take the whole catalog down for a spelling mistake.
  const { primary, variants } = planPanes([pane('brandnewtextcontainer')], 'http://x');
  assert.equal(primary.length, 1);
  assert.deepEqual(variants, []);
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test('planPanes › merges continuations into the primary', () => {
  const { primary, variants } = planPanes(
    [pane('textcontainer'), pane('programrequirementstextcontainer')], 'http://x');
  assert.deepEqual(primary.map(p => p.id),
    ['textcontainer', 'programrequirementstextcontainer']);
  assert.deepEqual(variants, []);
});

test('planPanes › splits an alternate curriculum into its own program', () => {
  const { primary, variants } = planPanes(
    [pane('programrequirementstextcontainer'),
     pane('advancedentryphdprogramrequirementstextcontainer')], 'http://x');
  assert.deepEqual(primary.map(p => p.id), ['programrequirementstextcontainer']);
  assert.equal(variants.length, 1);
  assert.equal(variants[0].modality, 'advancedentry');
  assert.equal(variants[0].label, 'Advanced Entry');
});

test('planPanes › two panes of the SAME modality make one program, not two', () => {
  // Otherwise a page that split its advanced-entry curriculum across two panes
  // would produce two folders with the same name — the collision this whole
  // change exists to prevent, reintroduced by the fix itself.
  const { variants } = planPanes(
    [pane('programrequirementstextcontainer'),
     pane('advancedentryphdprogramrequirementstextcontainer'),
     pane('advancedentryprogramrequirementstextcontainer')], 'http://x');
  assert.equal(variants.length, 1);
  assert.equal(variants[0].panes.length, 2);
});

test('planPanes › an empty page yields nothing rather than throwing', () => {
  assert.deepEqual(planPanes([], 'http://x'), { primary: [], variants: [] });
});

// ── Coverage: the invariant that catches DOUBLE-counting ─────────────────────

test('assertPaneCoverage › accepts an exact partition', () => {
  assert.doesNotThrow(() => assertPaneCoverage(
    [pane('a'), pane('b')], [['a'], ['b']], 'http://x'));
});

test('assertPaneCoverage › rejects a pane counted twice', () => {
  // This is the failure the old `tablesConsumed === tablesOnPage` check could
  // never express: International Business reported a spotless 8/8 while
  // shipping all 15 of its concentrations twice.
  assert.throws(
    () => assertPaneCoverage([pane('a'), pane('b')], [['a', 'b'], ['b']], 'http://x'),
    /parsed more than once: b ×2/);
});

test('assertPaneCoverage › rejects a pane never read', () => {
  assert.throws(
    () => assertPaneCoverage([pane('a'), pane('b')], [['a']], 'http://x'),
    /never parsed: b/);
});

test('assertPaneCoverage › reports both faults at once', () => {
  // One run should tell you everything that is wrong with the page, not make
  // you re-run to discover the second half.
  let err;
  try { assertPaneCoverage([pane('a'), pane('b'), pane('c')], [['a'], ['a']], 'http://x'); }
  catch (e) { err = e; }
  assert.ok(err, 'should have thrown');
  assert.match(err.message, /never parsed: b, c/);
  assert.match(err.message, /parsed more than once: a ×2/);
});

// ── Slugs and the labels they must produce ───────────────────────────────────

test('variantSlug › welds the modality onto the degree, keeping the campus', () => {
  assert.equal(variantSlug('public_policy_phd_(boston)', 'advancedentry', isDegreeToken),
    'public_policy_phdadvancedentry_(boston)');
  assert.equal(variantSlug('international_business_bsib_(boston)', 'exchange', isDegreeToken),
    'international_business_bsibexchange_(boston)');
  assert.equal(variantSlug('law_jd_(boston)', 'parttime', isDegreeToken),
    'law_jdparttime_(boston)');
});

test('variantSlug › falls back to a plain suffix when the tail is not a degree', () => {
  // Degrading the printed label is fine; producing a colliding or unparseable
  // folder is not. The folder must stay unique whatever the page is called.
  assert.equal(variantSlug('foundation_year', 'advancedentry', isDegreeToken),
    'foundation_year_advancedentry');
});

test('variantSlug › handles a slug with no campus tag', () => {
  assert.equal(variantSlug('organizational_communication_ms', 'advancedentry', isDegreeToken),
    'organizational_communication_msadvancedentry');
});

test('variantSlug › survives NEU\'s truncated-paren folder', () => {
  // At least one scraped folder is "…_ba_(boston" with no closing paren.
  const s = variantSlug('linguistics_ba_(boston', 'exchange', isDegreeToken);
  assert.ok(s.includes('baexchange'), s);
  assert.notEqual(s, 'linguistics_ba_(boston');
});

test('variantSlug › is deterministic and never equals the base slug', () => {
  for (const base of ['public_policy_phd_(boston)', 'law_llm_(boston)', 'x_ms']) {
    for (const mod of Object.values(PANE_DECISIONS).filter(d => d.kind === 'split').map(d => d.modality)) {
      const a = variantSlug(base, mod, isDegreeToken);
      assert.equal(a, variantSlug(base, mod, isDegreeToken), 'not deterministic');
      assert.notEqual(a, base, 'variant collided with its own primary');
    }
  }
});

test('distinct modalities never produce the same folder', () => {
  const mods = [...new Set(Object.values(PANE_DECISIONS)
    .filter(d => d.kind === 'split').map(d => d.modality))];
  const slugs = mods.map(m => variantSlug('law_llm_(boston)', m, isDegreeToken));
  assert.equal(new Set(slugs).size, slugs.length, `collision among ${slugs}`);
});

// ── The contract between the table and the naming module ─────────────────────

test('every split modality is registered in programNaming', () => {
  // Without this, a variant's folder does not parse back into a label and the
  // picker shows a raw slug. The two files are edited at different times by
  // different people, so the link is asserted rather than trusted.
  for (const [paneId, d] of Object.entries(PANE_DECISIONS)) {
    if (d.kind !== 'split') continue;
    const slug = variantSlug('public_policy_phd_(boston)', d.modality, isDegreeToken);
    const { degree } = parseProgram(slug);
    assert.ok(degree.includes('—'),
      `${paneId}: modality "${d.modality}" is not in programNaming.MODALITIES ` +
      `— ${slug} parsed as degree "${degree}"`);
    assert.equal(fmtProgramLabel(slug), `Public Policy, PhD—${d.label}`,
      `${paneId}: label does not match the decision table's own label`);
  }
});

test('every decision is well formed', () => {
  for (const [paneId, d] of Object.entries(PANE_DECISIONS)) {
    assert.ok(/^(merge|split)$/.test(d.kind), `${paneId}: bad kind ${d.kind}`);
    if (d.kind === 'split') {
      assert.match(d.modality, /^[a-z]+$/, `${paneId}: modality must be a bare slug token`);
      assert.ok(d.label?.length, `${paneId}: split needs a printable label`);
    } else {
      assert.ok(d.why?.length, `${paneId}: a merge must say WHY it is a continuation`);
    }
  }
});

test('a pane id is never both a known primary and a split', () => {
  // `programrequirementstextcontainer` legitimately appears in both roles —
  // primary on 21 pages, continuation on 9 — which is fine because it MERGES.
  // A pane that both opens pages and splits them would be ambiguous.
  for (const id of KNOWN_PRIMARY_PANES) {
    assert.notEqual(PANE_DECISIONS[id]?.kind, 'split',
      `${id} opens pages but is also marked as a variant`);
  }
});

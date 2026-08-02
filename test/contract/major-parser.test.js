// CONTRACT · the requirement parser against real catalog HTML.
//
// Fixtures are trimmed captures of live pages (scripts/capture-fixture.js),
// chosen because each one broke the parser in a distinct way. Named assertions
// rather than snapshots, so a failure reads as a diagnosis instead of a diff.
//
// This lives in test/contract/ because it needs node-html-parser; the unit and
// invariant jobs deliberately run with no npm install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'node-html-parser';

import {
  parseRequirements, parseTotalCredits, findLeakedMarkers,
  extractPlanOfStudyCourses, normalizeConcentrationHref,
  UNDERGRAD_PROFILE, GRAD_PROFILE,
} from '../../scripts/lib/catalog-program-parser.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/catalog');
const load = name => parse(readFileSync(join(DIR, `${name}.html`), 'utf8'));
const ug   = name => parseRequirements(load(name), UNDERGRAD_PROFILE);
const grad = name => parseRequirements(load(name), GRAD_PROFILE);

const titles     = r => r.requirementSections.map(s => s.title);
const concTitles = r => (r.concentrations?.concentrationOptions ?? []).map(c => c.title);

// ── The invariant that matters most ──────────────────────────────────────────

test('parser › every requirement table is parsed or explicitly excluded', () => {
  // Counting only inside the panes we chose is self-confirming: PhD pages
  // reported a tidy 3/3 while half the page went unread. Reconcile against the
  // whole document instead.
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.html'))) {
    const name = f.replace(/\.html$/, '');
    const r = /-ms$|-phd$/.test(name) ? grad(name) : ug(name);
    const unaccounted = r.tablesOnPage - r.tablesConsumed - r.tablesExcluded;
    assert.equal(unaccounted, 0,
      `${name}: ${unaccounted} of ${r.tablesOnPage} tables neither parsed nor excluded`);
    assert.deepEqual(r.warnings, [], `${name} warned: ${r.warnings.join('; ')}`);
  }
});

test('parser › titles are unique, so they can serve as keys', () => {
  // Section titles key the UI's progress pairing; concentration titles key
  // saved plans, share links and MCP SET_CONCENTRATION.
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.html'))) {
    const name = f.replace(/\.html$/, '');
    const r = /-ms$|-phd$/.test(name) ? grad(name) : ug(name);
    const s = titles(r), c = concTitles(r);
    assert.equal(new Set(s).size, s.length, `${name} has duplicate section titles`);
    assert.equal(new Set(c).size, c.length, `${name} has duplicate concentration titles`);
  }
});

test('parser › no internal _CHOOSE marker escapes', () => {
  for (const f of readdirSync(DIR).filter(f => f.endsWith('.html'))) {
    const name = f.replace(/\.html$/, '');
    const r = /-ms$|-phd$/.test(name) ? grad(name) : ug(name);
    assert.deepEqual(findLeakedMarkers({ requirementSections: r.requirementSections }), []);
  }
});

// ── Dropped tables (the 82-program bug) ──────────────────────────────────────

test('parser › philosophy-ba › all five program options survive', () => {
  // Philosophy's whole major is five mutually-exclusive options, each an <h3>
  // table. The old walk tracked only <h2> and nulled it after each table, so
  // four were dropped and the program shipped 16 SH against a stated 128.
  const r = ug('philosophy-ba');
  assert.equal(r.tablesConsumed, 5);
  assert.equal(concTitles(r).length, 5);
  assert.ok(concTitles(r).some(t => /No Concentration/i.test(t)));
  assert.ok(concTitles(r).some(t => /Law and Ethics/i.test(t)));
});

test('parser › political-science-ba › all eight concentrations, none mandatory', () => {
  const r = ug('political-science-ba');
  assert.equal(concTitles(r).length, 8);
  // Two of the eight hang off an EMPTY <h3> used purely as a bookmark; binding
  // the anchor there instead of to the real heading lost them.
  assert.ok(concTitles(r).some(t => /International Relations and Diplomacy/i.test(t)));
  assert.ok(concTitles(r).some(t => /Law and Legal Studies/i.test(t)));
  // "Political Science Concentrations (Optional)" — must not be forced.
  assert.equal(r.concentrations.minOptions, 0);
});

// ── Concentrations misread as mandatory requirements ─────────────────────────

test('parser › cs-bscs › concentrations are options, not a "Program Requirement"', () => {
  const r = ug('cs-bscs');
  assert.equal(concTitles(r).length, 5);
  assert.equal(r.concentrations.minOptions, 1);
  // The AI concentration follows <h2>Program Requirement</h2><p>…</p><hr/>, so
  // attributing tables to the last h2 made it a required section by that name.
  assert.ok(!titles(r).includes('Program Requirement'),
    `leaked a mandatory section: ${titles(r).join(' | ')}`);
});

test('parser › physics-bs › an inline optional concentration is not required', () => {
  // No gateway <ul> points at "Astrophysics Concentration (Optional)", so the
  // structural rule finds nothing and the narrow title fallback must catch it.
  const r = ug('physics-bs');
  assert.deepEqual(concTitles(r), ['Astrophysics Concentration (Optional)']);
  assert.equal(r.concentrations.minOptions, 0);
});

test('parser › art-ba › mutually exclusive options both become concentrations', () => {
  const r = ug('art-ba');
  assert.equal(concTitles(r).length, 2);
  assert.ok(concTitles(r).some(t => /Art History and Visual Studies/i.test(t)));
  assert.ok(concTitles(r).includes('Electives Option'));
});

// ── Structural variants found by the corpus census ───────────────────────────

test('parser › bioengineering-phd › requirements spanning two panes are both read', () => {
  // #curriculumtextcontainer AND #advancedentryphdprogramrequirementstextcontainer.
  // Taking only the first match halved 52 programs.
  const r = grad('bioengineering-phd');
  assert.ok(r.tablesConsumed >= 6, `only ${r.tablesConsumed} tables consumed`);
});

test('parser › economics-ms › tables nested inside a <ul> are not lost', () => {
  // Two of its four tables sit inside <ul class="tightlist">; treating a list
  // as a leaf made them invisible.
  const r = grad('economics-ms');
  assert.equal(r.tablesConsumed, 4);
  assert.ok(concTitles(r).some(t => /Data Science for Economics/i.test(t)));
});

test('parser › bsba › off-page concentrations are reported for pre-fetching', () => {
  // Business lists its concentrations as links, not tables. Parsing is
  // synchronous and fetching is not, so the parser surfaces them instead.
  const r = ug('bsba');
  assert.ok(r.pendingExternal.length >= 15, `found ${r.pendingExternal.length}`);
  assert.ok(r.pendingExternal.every(l => /\/concentrations\//.test(l.href)));
});

test('parser › bsba + conc-finance › an injected resolver produces options', () => {
  const finance = load('conc-finance');
  const r = parseRequirements(load('bsba'), UNDERGRAD_PROFILE, {
    resolveExternal: href => (/finance/.test(href) ? finance : null),
  });
  assert.ok(concTitles(r).some(t => /Finance/i.test(t)),
    `expected a Finance concentration, got: ${concTitles(r).join(' | ')}`);
});

test('href normalization › the three shapes the catalog emits collapse to one', () => {
  const want = 'https://catalog.northeastern.edu/undergraduate/business/concentrations/finance/';
  for (const raw of [
    '/undergraduate/business/concentrations/finance',
    '/undergraduate/business/concentrations/finance/',
    '/undergraduate/business/concentrations/finance/index.html',
    '  /undergraduate/business/concentrations/finance/   ',   // real: whitespace inside the href
  ]) assert.equal(normalizeConcentrationHref(raw), want, raw);
});

// ── Credit totals ────────────────────────────────────────────────────────────

test('totalCredits › prefers the stated requirement over the sample plan', () => {
  // CS BSCS states 134; its plan grids total 135. The old code read the grid.
  const { value, source } = parseTotalCredits(load('cs-bscs'), UNDERGRAD_PROFILE);
  assert.equal(value, 134);
  assert.match(source, /^stated/);
});

test('totalCredits › ignores "N semester hours in the major"', () => {
  // POLS states 128 overall and 52 in the major; the subtotal must not win.
  const { value } = parseTotalCredits(load('political-science-ba'), UNDERGRAD_PROFILE);
  assert.equal(value, 128);
});

test('totalCredits › reads a graduate total stated only in prose', () => {
  const { value, source } = parseTotalCredits(load('economics-ms'), GRAD_PROFILE);
  assert.ok(value >= 8 && value < 150, `got ${value}`);
  assert.match(source, /^stated/);
});

// ── Sample plan of study ─────────────────────────────────────────────────────

test('planOfStudy › course codes come from anchors, not cell text', () => {
  // Compound cells read as "ME 2355and ME 2356" and "ME 3475 or  3480" — the
  // alternative drops its subject prefix — so a text regex loses most of them.
  const codes = extractPlanOfStudyCourses(load('cs-bscs'));
  assert.ok(codes.length > 20, `only ${codes.length} codes`);
  assert.ok(codes.every(c => /^[A-Z]{2,6}\d+$/.test(c)), 'malformed key present');
  // Placeholders ("Elective", "Co-op", "Vacation") have no anchor and are skipped.
  assert.ok(!codes.some(c => /ELECTIVE|COOP|VACATION/i.test(c)));
});

test('planOfStudy › never drawn from the requirement panes', () => {
  // The plan is a witness, not a requirement source; reading it as one is the
  // bug that gave Nursing BSN four phantom sections.
  const r = ug('cs-bscs');
  assert.ok(r.excludedPanes.every(p => /^planofstudy/.test(p.id)));
});

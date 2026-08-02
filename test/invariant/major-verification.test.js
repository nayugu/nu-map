// INVARIANT · program requirement data must not regress against the recorded
// baseline. Pure function over committed JSON — no network, no npm install
// (the invariant CI job runs without one), so this executes on every PR.
//
// The ratchet only ever tightens: a run may fix things freely, but any new
// discrepancy, any counter increasing, or any program dropping to 'review'
// fails. Record intended changes with:
//     node scripts/verify-majors.js --update
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAll, compareToBaseline } from '../../scripts/verify-majors.js';

const results = verifyAll();

test('verification › the corpus is non-empty (guards a broken loader)', () => {
  assert.ok(results.length > 900, `only ${results.length} programs found`);
});

test('verification › no program regresses against the baseline', () => {
  const regressions = compareToBaseline(results);
  assert.deepEqual(regressions, [],
    `${regressions.length} regression(s):\n  ${regressions.slice(0, 20).join('\n  ')}`);
});

test('verification › no requirement table is silently dropped', () => {
  // The check that matters most: a table on the catalog page that we neither
  // parsed nor explicitly excluded means the program is missing requirements.
  const dropped = results.filter(r => (r.counters.tablesUnaccounted ?? 0) > 0);
  assert.deepEqual(dropped.map(r => r.id), [],
    `${dropped.length} program(s) dropped requirement tables`);
});

test('verification › no internal parser marker reaches the data', () => {
  const leaked = results.filter(r => (r.counters.leakedMarkers ?? 0) > 0);
  assert.deepEqual(leaked.map(r => r.id), []);
});

test('verification › concentration titles are unique per program', () => {
  // Titles are the key the UI and the MCP SET_CONCENTRATION action use to
  // select one, so duplicates are unaddressable.
  const dup = results.filter(r =>
    r.discrepancies.some(d => d.check === 'duplicate-concentration-titles'));
  assert.deepEqual(dup.map(r => r.id), []);
});

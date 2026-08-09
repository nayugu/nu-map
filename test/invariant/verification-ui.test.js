// INVARIANT · the badge a program shows must match the rows behind it.
//
// This bug class has recurred twice. Both times the badge was derived from
// finding SEVERITY while the popover's marks came from raw COUNTERS, so the
// two could disagree without anything failing:
//
//   - a green "checked" badge above a red ✕ (an info-level finding drawing a
//     failure mark)
//   - 52 programs showing a yellow badge above four rows that all looked fine
//   - 3 asserting "the catalog states a total credit count" about a number
//     that had actually come from the sample plan
//
// Nobody re-checks that by eye across 1,000 programs, so it is checked here.
// Pure and offline: the invariant job runs with no npm install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { buildCheckRows, levelFromRows, STATE } from '../../src/core/verificationRows.js';

function programs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) programs(p, out);
    else if (e === 'parsed.initial.json') out.push(p);
  }
  return out;
}

const ROOT = join(import.meta.dirname, '../..');
const all = [...programs(join(ROOT, 'data/northeastern/programs/majors')), ...programs(join(ROOT, 'data/northeastern/programs/grad-majors'))]
  .map(f => ({ f, json: JSON.parse(readFileSync(f, 'utf8')) }))
  .filter(p => p.json.metadata?.verification);

test('verification UI › the corpus is loaded (guards a silent no-op)', () => {
  assert.ok(all.length > 900, `only ${all.length} programs had a verification block`);
});

test('verification UI › the badge equals the worst row on every program', () => {
  const bad = [];
  for (const { f, json } of all) {
    const v = json.metadata.verification;
    const implied = levelFromRows(buildCheckRows(v));
    if (implied !== v.level) bad.push(`${f}: badge=${v.level} rows imply=${implied}`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} program(s) disagree`);
});

test('verification UI › a counted finding is never rendered as pass or n/a', () => {
  // The failure mode behind the 52: a medium finding hidden under a neutral
  // dash, leaving the badge colour unexplained.
  const bad = [];
  for (const { f, json } of all) {
    const v = json.metadata.verification;
    const counted = (v.discrepancies ?? []).filter(d => d.severity !== 'info').length;
    if (!counted) continue;
    const rows = buildCheckRows(v);
    const shown = rows.filter(r => r.state === 'warn' || r.state === 'fail').length;
    if (shown < 1) bad.push(`${f}: ${counted} counted finding(s), none visible`);
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('verification UI › every row has a translatable key, never raw English', () => {
  const bad = [];
  for (const { f, json } of all) {
    for (const r of buildCheckRows(json.metadata.verification)) {
      if (!r.textKey?.startsWith('verify.pop.')) bad.push(`${f}: ${r.textKey}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('verification UI › every row state is one we can draw', () => {
  const bad = [];
  for (const { f, json } of all) {
    for (const r of buildCheckRows(json.metadata.verification)) {
      if (!STATE[r.state]) bad.push(`${f}: unknown state "${r.state}"`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

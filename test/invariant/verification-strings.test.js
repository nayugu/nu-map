// INVARIANT · every detail bullet must render, in English and in every locale.
//
// Bullets are stored as { key, params } and rendered two ways: through t() in
// the browser, and through DETAIL_EN for the CLI, the report and the MCP
// payload. Adding a key to one and not the other produces no error — it
// produces an empty string. That shipped: `planLikelyElective` was added to
// all 8 locales but not to DETAIL_EN, so audit_requirements returned
// `because: ["", "", ""]` for every program with an out-of-subject
// sample-plan course.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { DETAIL_EN, detailText, buildCheckRows } from '../../src/core/verificationRows.js';

const ROOT = join(import.meta.dirname, '../..');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === 'parsed.initial.json') out.push(p);
  }
  return out;
}
const programs = [...walk(join(ROOT, 'data/northeastern/programs/majors')), ...walk(join(ROOT, 'data/northeastern/programs/grad-majors'))]
  .map(f => JSON.parse(readFileSync(f, 'utf8')))
  .filter(p => p.metadata?.verification);

// Every detail key actually present in the shipped data.
const usedKeys = new Set();
const usedTextKeys = new Set();
for (const p of programs) {
  for (const d of p.metadata.verification.discrepancies ?? []) {
    for (const x of d.detail ?? []) if (x && typeof x === 'object' && x.key) usedKeys.add(x.key);
  }
  for (const r of buildCheckRows(p.metadata.verification)) usedTextKeys.add(r.textKey);
}

test('strings › every detail key in the data renders in English', () => {
  const missing = [...usedKeys].filter(k => !DETAIL_EN[k]).sort();
  assert.deepEqual(missing, [], `absent from DETAIL_EN: ${missing.join(', ')}`);
});

test('strings › no bullet renders as an empty string', () => {
  const empty = [];
  for (const p of programs) {
    for (const d of p.metadata.verification.discrepancies ?? []) {
      for (const x of d.detail ?? []) if (!detailText(x)) empty.push(`${p.name}: ${JSON.stringify(x)}`);
    }
  }
  assert.deepEqual(empty.slice(0, 5), []);
});

test('strings › every row and detail key exists in en.js', () => {
  const en = readFileSync(join(ROOT, 'src/locales/en.js'), 'utf8');
  const have = new Set([...en.matchAll(/"([\w.\-]+)"\s*:/g)].map(m => m[1]));
  const need = [...usedTextKeys, ...[...usedKeys].map(k => `verify.detail.${k}`)];
  const missing = need.filter(k => !have.has(k)).sort();
  assert.deepEqual(missing, [], `absent from en.js: ${missing.join(', ')}`);
});

#!/usr/bin/env node
/**
 * chart-fingerprint-diff.js — which plans a change actually moved.
 *
 *   node scripts/verify-chart.js --fingerprint /tmp/before.json     # then make the change
 *   node scripts/verify-chart.js --fingerprint /tmp/after.json
 *   node scripts/chart-fingerprint-diff.js /tmp/before.json /tmp/after.json
 *
 * ── The question this answers, which nothing else did ───────────────
 *
 * A coverage change is reported as one number, and one number cannot distinguish
 * "12 programs that previously refused now generate" from "12 now generate and 40 that were
 * already fine came out differently". The second is a regression wearing the first's clothes,
 * and the constraint on this work is explicitly that plans which are already good must not
 * move. So `moved` is the category that matters here; `gained` is the one being aimed at.
 *
 * Pure file comparison — no catalog load, no generation — so it is instant and can be run
 * against snapshots taken days apart.
 *
 * Exit codes: 0 nothing moved · 1 something moved · 2 bad arguments. Non-zero on `moved`
 * because in this workflow a moved plan is the thing you asked to be told about, whether or
 * not it turns out to be an improvement.
 */
import { readFileSync, existsSync } from "node:fs";
import { compareFingerprints } from "./lib/chart-fingerprint.js";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error("usage: chart-fingerprint-diff.js <before.json> <after.json>");
  process.exit(2);
}
for (const p of [beforePath, afterPath]) {
  if (!existsSync(p)) { console.error(`no such snapshot: ${p}`); process.exit(2); }
}

const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const before = load(beforePath), after = load(afterPath);
const hashes = (snap) => Object.fromEntries(
  Object.entries(snap.plans ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : v.hash]));

const { same, moved, gained, lost } = compareFingerprints(hashes(before), hashes(after));

console.log(`\nbefore ${before.meta?.made ?? "?"} plans of ${before.meta?.shapes ?? "?"} shapes`
  + `   after ${after.meta?.made ?? "?"} of ${after.meta?.shapes ?? "?"}`);
console.log(`\n  unchanged ${same.length}`);
console.log(`  MOVED     ${moved.length}   ← must be 0 for a coverage-only change`);
console.log(`  gained    ${gained.length}`);
console.log(`  lost      ${lost.length}   ← a plan that used to generate and no longer does`);

const list = (name, xs) => {
  if (!xs.length) return;
  console.log(`\n${name}:`);
  for (const x of xs.slice(0, 40)) console.log(`   ${x}`);
  if (xs.length > 40) console.log(`   … and ${xs.length - 40} more`);
};
list("gained", gained);
list("lost", lost);
list("moved", moved);

// The first moved plan in full, because "40 plans moved" is not actionable and one worked
// example usually identifies the mechanism immediately.
if (moved.length) {
  const label = moved[0];
  const b = before.plans?.[label], a = after.plans?.[label];
  if (b?.canonical && a?.canonical) {
    console.log(`\n── ${label} — before ──\n${b.canonical}`);
    console.log(`\n── ${label} — after ──\n${a.canonical}`);
  } else {
    console.log(`\n(no canonical text in these snapshots — rerun with a current `
      + `verify-chart.js to get the readable form)`);
  }
}

process.exit(moved.length ? 1 : 0);

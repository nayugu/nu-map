#!/usr/bin/env node
// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
//
// The instrument for /data search. Reads the SHIPPED index out of dist/assets/
// rather than rebuilding records, so what it measures is what users get.
//
//   node scripts/data-search-probe.js                 size, latency, named queries
//   node scripts/data-search-probe.js --mono          prefix monotonicity sweep
//   node scripts/data-search-probe.js --mono --all    …over every record (slow)
//   node scripts/data-search-probe.js "organic chem"  one query, ranked
//   node scripts/data-search-probe.js --fixture       rewrite the test fixture
//
// Committed rather than written inline each time, because the expensive
// verifications in this repo were always the ones that got deleted after
// answering one question. Extend this file; do not write another script.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { decodeIndex, prepareIndex, searchEntities, urlOf } from "../src/core/entitySearch.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

// Newest by mtime, not first by name: running buildAiData without vite leaves
// older hashed indexes in place, and measuring a stale one silently is worse
// than not measuring at all.
const assets = path.join(ROOT, "dist", "assets");
const file = fs.existsSync(assets)
  ? fs.readdirSync(assets)
      .filter((f) => /^data-index-.*\.json$/.test(f))
      .map((f) => [f, fs.statSync(path.join(assets, f)).mtimeMs])
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f)[0]
  : null;
if (!file) {
  console.error("No dist/assets/data-index-*.json. Run a build first:\n"
    + "  node -e 'import(\"./scripts/build-ai-data.js\").then(m=>m.buildAiData())'");
  process.exit(2);
}

const raw = fs.readFileSync(path.join(assets, file));
const prepared = prepareIndex(decodeIndex(JSON.parse(raw.toString("utf8"))));
const byKind = {};
for (const r of prepared.records) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

const KB = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`${file}`);
console.log(`  ${prepared.records.length} records — ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")}`);
console.log(`  ${KB(raw.length)} raw · ${KB(zlib.gzipSync(raw).length)} gzip · ${KB(zlib.brotliCompressSync(raw).length)} brotli`);

// ── Fixture ──────────────────────────────────────────────────────────
// A FIXED corpus for test/contract/data-search.test.js. Fixed on purpose: the
// catalog is rescraped monthly and pushed to main unattended, so a contract
// keyed on live data would fail that job for reasons that are not regressions.
// Chosen deterministically, and stratified towards the cases that break —
// duplicate names, numbered sequences, aliases — rather than uniformly.
if (flag("--fixture")) {
  const { encodeIndex } = await import("../src/core/entitySearch.js");
  const recs = prepared.records;
  const chosen = new Set();
  const take = (pred, n) => {
    let seen = 0;
    for (let i = 0; i < recs.length && seen < n; i++) {
      if (!pred(recs[i]) || chosen.has(i)) continue;
      chosen.add(i); seen++;
    }
  };
  const stride = (kind, n) => {
    const idx = recs.map((r, i) => [r, i]).filter(([r]) => r.kind === kind).map(([, i]) => i);
    const step = Math.max(1, Math.floor(idx.length / n));
    for (let j = 0; j < idx.length && chosen.size < 1e9; j += step) chosen.add(idx[j]);
  };
  // Every record whose display name is shared with another — the ties that make
  // recall@1 lie, and the case a ranker is most likely to get wrong.
  const nameCount = new Map();
  for (const r of recs) nameCount.set(r.name.toLowerCase(), (nameCount.get(r.name.toLowerCase()) ?? 0) + 1);
  take((r) => nameCount.get(r.name.toLowerCase()) > 1, 80);
  take((r) => (r.aliases ?? []).length > 0, 20);           // every alias carrier
  take((r) => /\b(1|2|3)$/.test(r.name), 40);              // numbered sequences
  take((r) => r.name.length > 90, 20);                     // the longest names
  stride("section", 8); stride("nupath", 13); stride("subject", 30); stride("program", 150);
  stride("professor", 150); stride("course", 400);

  const picked = [...chosen].sort((a, b) => a - b).map((i) => {
    const r = recs[i];
    return {
      kind: r.kind, name: r.name, code: r.code, path: r.path,
      aliases: r.aliases, acronyms: r.acronyms,
    };
  });
  const out = path.join(ROOT, "test", "fixtures", "data-search-index.json");
  fs.writeFileSync(out, JSON.stringify(encodeIndex(picked, prepared.kinds), null, 0) + "\n");
  const kinds = {};
  for (const r of picked) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  console.log(`\nwrote ${picked.length} records → ${path.relative(ROOT, out)}`);
  console.log(`  ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}`);
  process.exit(0);
}

// ── One query, ranked ────────────────────────────────────────────────
const positional = args.filter((a) => !a.startsWith("--"));
if (positional.length) {
  const q = positional.join(" ");
  console.log(`\n"${q}"`);
  for (const h of searchEntities(prepared, q, { limit: 10 })) {
    const r = prepared.records[h.index];
    console.log(`  ${String(h.score).padStart(7)} ${h.routed ? "→" : " "} ${r.kind.padEnd(9)} ${(r.code || "").padEnd(11)} ${r.name}`);
    console.log(`          ${urlOf(prepared, h.index)}`);
  }
  process.exit(0);
}

// ── Named queries: the ones that broke before ────────────────────────
const NAMED = [
  "cs", "computer science", "chemistry", "chem", "chem 2311", "chem2311", "2311",
  "orgo", "organic chemistry", "calculus", "nd", "writing intensive",
  "ranganathan", "aanjhan ranganathan", "ranganathan aanjhan",
  "machine learning", "bscs", "ece", "data science", "phil 1101", "zzzznope",
];
console.log("\n── named queries ──");
for (const q of NAMED) {
  const hits = searchEntities(prepared, q, { limit: 4 });
  const shown = hits.map((h) => {
    const r = prepared.records[h.index];
    return `${r.code || r.name}${h.routed ? "*" : ""} [${r.kind.slice(0, 4)}]`;
  }).join("  ");
  console.log(`  ${q.padEnd(22)} ${shown || "—"}`);
}

// ── Latency ──────────────────────────────────────────────────────────
const LAT = ["c", "co", "com", "comp", "compu", "computer", "computer s", "computer science",
  "chem", "chemi", "chem 2", "chem 23", "b", "bio", "biol", "ran", "rangan",
  "machine", "machine l", "machine learning", "1", "12", "123", "1234"];
for (const q of LAT) searchEntities(prepared, q);
const times = LAT.map((q) => {
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) searchEntities(prepared, q);
  return [(performance.now() - t0) / 20, q];
}).sort((a, b) => b[0] - a[0]);
console.log(`\n── latency over ${prepared.records.length} records ──`);
console.log(`  worst ${times[0][0].toFixed(2)} ms ("${times[0][1]}")  median ${times[Math.floor(times.length / 2)][0].toFixed(2)} ms`);
{
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) prepareIndex(decodeIndex(JSON.parse(raw.toString("utf8"))));
  console.log(`  parse + prepare: ${((performance.now() - t0) / 5).toFixed(1)} ms`);
}

// ── Prefix monotonicity ──────────────────────────────────────────────
// The primary metric. Recall@1 on an entity's exact full name is nearly free
// and measures almost nothing; this asks the property that actually broke
// before: once an entity appears, one more character must never drop it.
if (flag("--mono")) {
  const LIMIT = 10;
  const rate = flag("--all") ? 1 : 0.05;
  let rng = 20260822;
  const next = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let queries = 0, drops = 0, absent = 0, firstSeen = 0;
  const examples = [];
  for (let i = 0; i < prepared.records.length; i++) {
    if (rate < 1 && next() > rate) continue;
    const r = prepared.records[i];
    // How you would actually type it: the code leads when there is one.
    const typed = (r.code ? `${r.code} ${r.name}` : r.name).slice(0, 40);
    let had = false, everHad = false;
    for (let L = 3; L <= typed.length; L++) {
      const q = typed.slice(0, L).trim();
      if (!q) continue;
      queries++;
      const hits = searchEntities(prepared, q, { limit: LIMIT });
      const inList = hits.some((h) => h.index === i);
      if (inList && !everHad) { everHad = true; firstSeen++; }
      if (had && !inList) {
        drops++;
        if (examples.length < 10)
          examples.push(`"${typed.slice(0, L - 1)}" had it, "${q}" lost it — ${r.kind} ${r.code || ""} ${r.name}`);
      }
      had = inList;
    }
    if (!had) {
      absent++;
      if (examples.length < 16) examples.push(`ABSENT at full name: ${r.kind} ${r.code || ""} ${r.name}`);
    }
  }
  console.log(`\n── monotonicity (${rate < 1 ? `${(rate * 100).toFixed(0)}% sample` : "all records"}) ──`);
  console.log(`  ${queries} prefix queries`);
  console.log(`  non-monotonic drops:            ${drops}  (${(drops / queries * 100).toFixed(3)}%)`);
  console.log(`  absent at their own full name:  ${absent}`);
  console.log(`  reached the list at some prefix: ${firstSeen}`);
  for (const e of examples) console.log(`    ${e}`);
}

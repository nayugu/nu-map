#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// The roadmap check: is everything in roadmap/ written correctly?
//
//   node scripts/check-roadmap.js            (checks roadmap/)
//   node scripts/check-roadmap.js <dir>      (checks another folder; used by the tests)
//
// Exits 1 and names every file and problem at once, or prints a one-line OK.
//
// This is the ONLY place a roadmap mistake is fatal, and it is deliberately
// not part of `npm test` or the build: the monthly data workflows run both,
// and a typo in a roadmap item must never stop a month's catalog update. It
// runs in CI as its own job (.github/workflows/roadmap.yml), only when
// roadmap/ or its code changes, so a red X lands on the commit that caused it.
// ═══════════════════════════════════════════════════════════════════

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadRoadmap, describeProblems } from "../build/roadmap.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = resolve(process.argv[2] ?? join(ROOT, "roadmap"));

// Links already sent to people in feedback replies. Renaming or deleting one
// of these files breaks a link in someone's inbox. Add to this list whenever
// you send a link; never remove from it.
const SENT = ["pols-ba-capstone-or-coop", "degree-audit-import", "summer-graduation", "term-off"];

const r = loadRoadmap(dir);
const failures = [];
if (r.problems.length) failures.push(describeProblems(r.problems));
// Only the real folder carries the sent links; a test folder does not.
if (!process.argv[2]) {
  const ids = new Set(r.items.map(i => i.id));
  const bad = new Set(r.problems.map(p => p.file.replace(/\.md$/, "")));
  const gone = SENT.filter(id => !ids.has(id) && !bad.has(id));
  if (gone.length) failures.push(`These items were linked in feedback replies and are now gone or renamed:\n  - ${gone.map(id => `roadmap/${id}.md`).join("\n  - ")}\nRestore the file (or its old name).`);
}

if (failures.length) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}
console.log(`roadmap OK: ${r.items.length} items, updated ${r.updated ?? "(unknown)"}`);

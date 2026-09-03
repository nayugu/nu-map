#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// DERIVE RESTRICTIONS — the browser asset behind the course card
//
// Turns the per-section tallies in term-details.json into the small file the
// app fetches. term-details.json is 8.8 MB and Node-only; this is what the
// browser gets.
//
// ── EVERY TERM, AND EVERY SECTION GROUP ────────────────────────────
//
// A restriction is a property of a SECTION in a SEMESTER, and this file went
// through two lossy folds before arriving at that. Both are recorded because
// both are tempting:
//
// 1. One entry per SEASON, keeping the most recent term. Loses cross-semester
//    variation entirely — Fall 2024 and Fall 2025 can differ and only one
//    would ever be shown.
//
// 2. UNIONING the section groups within a term. This one was worse, because it
//    is not merely incomplete, it MISLEADS. Measured: 98 course-term-kinds have
//    sections that disagree. ARCH 5115 in 202510 has five sections and three
//    distinct program groups —
//
//      1 section   MARCH-ARCH2
//      1 section   BS-ARCH or BS-ARCS
//      2 sections  MARCH-ARCH3 or MARCH-ARCH3A
//      1 section   no program restriction
//
//    unioned, that reads "MARCH-ARCH3 (2 of 5), MARCH-ARCH2 (1 of 5), BS-ARCH
//    (1 of 5)…", which sounds like any of them may take some section and never
//    tells a BS-ARCH student that exactly ONE section is open to them.
//
// So: every term we have data for, and within each, every distinct section
// group with its own count. That is the stored tally essentially verbatim —
// this file got simpler by giving up on folding, not more complex.
//
// It makes no stability claim. Each entry names the term it was read from and
// says nothing about a term we did not read. An early design reported a
// frequency ("every Fall, 3 of 3"); that was unproducible from the terms we
// hold and was measuring seasonal structure as though it were drift.
//
// ── WHAT IS DROPPED, and why ───────────────────────────────────────
//
//   must:Levels   98.9% of sections carry it and it says UG or GR — which we
//                 already know from the plan's studentType. Printing it on
//                 essentially every course would bury the 20% of courses that
//                 carry a restriction the student can act on.
//
// Nothing else is dropped. A `Cannot` binds only where every section carries it
// (`foldKind` intersects negatives and needs the section count to do so), and a
// kind whose codes have no label still ships — a code with no gloss is worse
// than nothing to read but far better than a silently missing restriction.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname }                        from "node:path";
import { fileURLToPath }                           from "node:url";

import { foldKind } from "./lib/restrictions.js";

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DETAILS = resolve(ROOT, "public/northeastern/term-details.json");
const LABELS  = resolve(ROOT, "public/northeastern/restriction-labels.json");
const OUT     = resolve(ROOT, "public/northeastern/restrictions.json");

const WRITE = process.argv.includes("--write");

// Same mapping derive-offering-summary.js uses for `prof`.
const SUFFIX_TYPE = { "10": "fall", "30": "spring", "40": "sumA", "50": "sumA", "60": "sumB" };

/** Kinds never shown. See the header. */
const HIDDEN = new Set(["must:Levels"]);

function main() {
  const details = JSON.parse(readFileSync(DETAILS, "utf8"));
  const labels  = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, "utf8")) : {};

  const courses = {};
  const usedLabels = {};
  let entries = 0, hiddenOnly = 0, kindTally = {};

  let splitKinds = 0;

  for (const [courseId, byTerm] of Object.entries(details)) {
    const terms = [];
    // Newest term first — that is the order a student reads them in.
    for (const termCode of Object.keys(byTerm).sort().reverse()) {
      const d = byTerm[termCode];
      if (!d?.restr) continue;
      const season = SUFFIX_TYPE[termCode.slice(4)];

      const kinds = {};
      for (const [key, tally] of Object.entries(d.restr)) {
        if (HIDDEN.has(key)) continue;
        // Every distinct section group, NOT a union. `[codes, sections]` pairs,
        // biggest group first: an object per group would repeat two key names
        // across thousands of entries for no gain in a shipped asset.
        const groups = Object.entries(tally)
          .filter(([, n]) => Number.isFinite(n) && n > 0)
          .map(([setKey, n]) => [setKey.split("|").filter(Boolean), n])
          .filter(([codes]) => codes.length)
          .sort((a, b) => b[1] - a[1] || a[0].join().localeCompare(b[0].join()));
        if (!groups.length) continue;
        if (groups.length > 1) splitKinds += 1;
        kinds[key] = groups;
        for (const [codes] of groups) {
          for (const code of codes) {
            const lk = `${key}|${code}`;
            if (labels[lk]) usedLabels[lk] = labels[lk];
          }
        }
        kindTally[key] = (kindTally[key] ?? 0) + 1;
      }
      if (!Object.keys(kinds).length) { hiddenOnly += 1; continue; }
      terms.push({ term: termCode, season: season ?? null, sections: d.sections ?? null, kinds });
    }
    if (terms.length) { courses[courseId] = terms; entries += 1; }
  }

  console.log(`courses with a shown restriction: ${entries}`);
  console.log(`course-terms carrying ONLY hidden kinds (Levels): ${hiddenOnly}`);
  console.log(`kinds whose SECTIONS DISAGREE (kept as separate groups): ${splitKinds}`);
  console.log(`labels referenced: ${Object.keys(usedLabels).length} of ${Object.keys(labels).length}`);
  console.log(`\nby kind:`);
  for (const [k, n] of Object.entries(kindTally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(34)} ${n} course-seasons`);
  }

  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    note: "Banner section restrictions, per season, each naming the term it was read from. " +
          "See scripts/derive-restrictions.js. `must:Levels` is excluded deliberately.",
    labels: usedLabels,
    courses,
  };
  const json = JSON.stringify(doc);
  console.log(`\npayload: ${(json.length / 1024).toFixed(0)} KB`);

  // A guard in the spirit of derive-offering-summary's 5% rule: this file
  // decides whether a student is told about a restriction at all, so a run that
  // loses most of them must refuse rather than quietly ship an empty one.
  if (existsSync(OUT)) {
    const prev = JSON.parse(readFileSync(OUT, "utf8"));
    const was = Object.keys(prev.courses ?? {}).length;
    if (was >= 50 && entries < was * 0.8) {
      console.error(`\n✖ REFUSING TO WRITE — courses with restrictions fell ${was} → ${entries} (>20%).`);
      console.error(`  That is a change in upstream shape, not hundreds of lifted restrictions.`);
      process.exit(1);
    }
  }

  if (!WRITE) { console.log(`\n(dry run — pass --write to update ${OUT})`); return; }
  writeFileSync(OUT, json + "\n");
  console.log(`\nwrote ${OUT}`);
}

main();

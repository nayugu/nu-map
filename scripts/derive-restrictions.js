#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// DERIVE RESTRICTIONS — the browser asset behind the course card
//
// Turns the per-section tallies in term-details.json into the small file the
// app fetches. term-details.json is 8.8 MB and Node-only; this is what the
// browser gets.
//
// ── ONE ENTRY PER SEASON, each naming its own term ─────────────────
//
// The obvious fold — keep only the most recent term — was rejected because it
// destroys the case advising actually raised. MEIE 4701 is one course whose
// sections are partitioned by major AND by season:
//
//   Fall      Majors: IEBA, IECS, INDE     (Industrial only)
//   Summer 2  Majors: MEBE, MECE, MEDS, MEHI, MEPH   (Mechanical only)
//
// A single-term view shows one of those and hides the other, so an IE student
// reading "offered Summer 1, Summer 2, Fall" still has no way to know Summer 2
// is closed to them. Per season, each labelled with the term it was READ from,
// shows the difference without asserting anything about years we did not look
// at.
//
// This is deliberately NOT a stability claim. It says "in Fall 2024 this was
// the restriction", not "Fall is always like this" — an earlier design tried to
// report a frequency ("every Fall, 3 of 3") and it was both unproducible from
// the terms we have and measuring seasonal structure as though it were drift.
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

  for (const [courseId, byTerm] of Object.entries(details)) {
    const perSeason = {};
    for (const [termCode, d] of Object.entries(byTerm)) {
      if (!d?.restr) continue;
      const season = SUFFIX_TYPE[termCode.slice(4)];
      if (!season) continue;
      // The most recent term of this season wins; term codes sort chronologically.
      if (perSeason[season] && perSeason[season].term >= termCode) continue;

      const kinds = {};
      for (const [key, tally] of Object.entries(d.restr)) {
        if (HIDDEN.has(key)) continue;
        const polarity = key.slice(0, key.indexOf(":"));
        const { codes } = foldKind(tally, polarity, d.sections);
        if (!codes.length) continue;
        // `[code, sections]` pairs rather than objects: this ships to the
        // browser, and 892 entries of {"code":…,"sections":…} is a lot of
        // repeated key names for no gain.
        kinds[key] = codes.map(c => [c.code, c.sections]);
        for (const c of codes) {
          const lk = `${key}|${c.code}`;
          if (labels[lk]) usedLabels[lk] = labels[lk];
        }
        kindTally[key] = (kindTally[key] ?? 0) + 1;
      }
      if (!Object.keys(kinds).length) { hiddenOnly += 1; continue; }
      perSeason[season] = { term: termCode, sections: d.sections ?? null, kinds };
    }
    if (Object.keys(perSeason).length) { courses[courseId] = perSeason; entries += 1; }
  }

  console.log(`courses with a shown restriction: ${entries}`);
  console.log(`course-terms carrying ONLY hidden kinds (Levels): ${hiddenOnly}`);
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

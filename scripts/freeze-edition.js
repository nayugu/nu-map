#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// freeze-edition — capture the LIVE catalog edition before it rolls.
//
// ── Why this has to exist ───────────────────────────────────────────
//
// The retired union is only as complete as the snapshots behind it. It is
// computed as (∪ frozen editions) − (current catalog), so a course is
// recoverable only if some frozen edition carries it.
//
// That makes a missed capture permanent and silent. A course that lives in
// exactly one edition — born in the 2026-2027 catalog, gone in 2027-2028 — is
// resolvable only if a 2027 snapshot exists. Miss it and the union computes
// 2026 − 2028, the course appears in neither, and it drops out of every plan
// naming it exactly the way the 367 courses of the 2027 roll nearly did. There
// is no error, no rail and no second chance: `catalog-courses.json` is
// REPLACED by each scrape, so the evidence is gone the moment the roll lands.
//
// The archive is NOT a fallback. It lags, and it has already skipped a year
// outright: /archive/2025-2026/ does not exist, NEU published that edition as
// PDF only, and our own snapshot is the sole machine-readable copy in
// existence. Capture the live edition while it is live.
//
// `edition-probe.js --coverage` is the alarm that says a capture is due; this
// is the thing you run in answer to it.
//
// ── Why it takes no network for the catalog itself ──────────────────
//
// The live edition was already scraped — it IS `catalog-courses.json`. Re-
// fetching 227 subject pages to obtain a copy of a file already on disk would
// cost ~29 minutes and could only introduce drift between the shipped catalog
// and the edition record claiming to be it. So the freeze is a filtered copy,
// and the ONE request it does make is the check that matters: reading the live
// edition banner to prove the file really is the edition being claimed.
//
// ── What gets excluded, and why it is not a detail ──────────────────
//
// `catalog-courses.json` is a superset of its edition. `course-retention.js`
// unions RETIRED courses back into it — 709 of them after the 2027 roll — so
// that a frozen program tree can still be audited. Those courses are, by
// definition, not part of the edition being frozen: they are the previous
// edition's, kept for a different reason.
//
// Freezing them would corrupt every future union. The retired set of the NEXT
// roll is computed against this file, so a 2027 snapshot containing 2026's
// retirements would report those courses as still-published in 2027 and
// quietly re-date their lifespans. The edition is the ACTIVE courses only.
//
// Usage:
//   node scripts/freeze-edition.js --edition 2026-2027
//   node scripts/freeze-edition.js --edition 2026-2027 --write
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseHTML } from "node-html-parser";

import { parseEditionArg, assertEdition } from "./lib/catalog-edition.js";
import { parseCatalogEdition } from "./lib/catalog-program-parser.js";
import { fidelityOfEdition } from "./lib/catalog-course-parser.js";
import { keyOfCourse } from "./lib/course-retention.js";

const CATALOG   = "public/northeastern/catalog-courses.json";
const ROOT_DIR  = "data/northeastern/catalog/editions";
const MANIFEST  = join(ROOT_DIR, "manifest.json");
const BANNER_URL = "https://catalog.northeastern.edu/course-descriptions/cs/";

const WRITE = process.argv.includes("--write");

async function liveEdition() {
  const res = await fetch(BANNER_URL, {
    headers: { "User-Agent": "NU-Map-DataBot/1.0 (freeze-edition)", Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} reading the live edition banner`);
  const year = parseCatalogEdition(parseHTML(await res.text()));
  if (!year) throw new Error("could not read the live edition banner — has the markup changed?");
  return year;
}

async function main() {
  const edition = parseEditionArg(process.argv);
  if (!edition) {
    console.error("freeze-edition needs --edition <label>, e.g. --edition 2026-2027.\n"
      + "It is stated rather than inferred on purpose: this writes a file that is never\n"
      + "regenerated, and a wrong year is unrecoverable once the catalog rolls again.");
    process.exit(1);
  }

  const outDir = join(ROOT_DIR, String(edition.year));
  const outFile = join(outDir, "catalog-courses.json");
  // Frozen means frozen. Refusing beats a --force flag nobody reads: if a
  // snapshot is genuinely wrong, deleting it by hand is a deliberate act that
  // leaves a trace in git, which is exactly the friction this file wants.
  if (existsSync(outFile)) {
    console.error(`${outFile} already exists. Frozen editions are never regenerated —`);
    console.error(`see ${ROOT_DIR}/README.md. Delete it by hand if it is genuinely wrong.`);
    process.exit(1);
  }

  // The claim is checked against NEU, not against our own file. Our file cannot
  // testify to its own edition — that is the whole reason this check exists.
  const live = await liveEdition();
  assertEdition(live, edition, BANNER_URL);

  const all = JSON.parse(readFileSync(CATALOG, "utf8"));
  if (!Array.isArray(all) || !all.length) {
    console.error(`${CATALOG} is not a non-empty array — refusing.`);
    process.exit(1);
  }
  // The edition is the ACTIVE courses. See the header: retention's rescues
  // belong to an earlier edition and freezing them would corrupt every future
  // union computed against this snapshot.
  const active  = all.filter(c => !c.retired);
  const dropped = all.length - active.length;

  const subjects = new Set(active.map(c => c.subject));
  const stats = {
    label: edition.label,
    fidelity: fidelityOfEdition(edition.year),
    courses: active.length,
    subjects: subjects.size,
    coursesWithPrereqs: active.filter(c => c.prereqs?.length).length,
    coursesWithNuPath: active.filter(c => c.nuPath?.length).length,
    capturedFrom: CATALOG,
    capturedAt: new Date().toISOString().slice(0, 10),
    method: `frozen from the live scrape while ${edition.label} was the live edition; `
      + `${dropped} retained course(s) from earlier editions excluded`,
    archiveUrl: null,
  };

  console.log(`\nFREEZE ${edition.label} → ${outDir}/`);
  console.log(`  live banner says ${live} — matches the requested edition`);
  console.log(`  ${all.length} records in the catalog`);
  console.log(`    ${active.length} active  → frozen`);
  console.log(`    ${dropped} retained from earlier editions → EXCLUDED`);
  console.log(`  ${stats.subjects} subjects, ${stats.coursesWithPrereqs} with prereqs, `
    + `${stats.coursesWithNuPath} with NUPath`);

  // A snapshot identical to one we already hold means the roll has not actually
  // happened here yet, whatever the banner says — most likely the catalog has
  // not been re-scraped since. Freezing it would file this year's data under
  // next year's name.
  const prior = existsSync(ROOT_DIR)
    ? JSON.parse(readFileSync(MANIFEST, "utf8")).editions ?? {} : {};
  for (const [year, m] of Object.entries(prior)) {
    const f = join(ROOT_DIR, year, "catalog-courses.json");
    if (!existsSync(f)) continue;
    const other = JSON.parse(readFileSync(f, "utf8"));
    const same = other.length === active.length
      && new Set(other.map(keyOfCourse)).size === new Set(active.map(keyOfCourse)).size
      && other.every(c => active.some(a => keyOfCourse(a) === keyOfCourse(c)));
    if (same) {
      console.error(`\n  REFUSING: this is course-for-course identical to the ${year} snapshot.`);
      console.error(`  The catalog has probably not been re-scraped since the roll, so freezing`);
      console.error(`  it would file ${year}'s data under ${edition.year}.`);
      process.exit(1);
    }
  }

  if (!WRITE) {
    console.log(`\n  (report only — pass --write to freeze)`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(active), "utf8");
  const man = JSON.parse(readFileSync(MANIFEST, "utf8"));
  man.editions[String(edition.year)] = stats;
  writeFileSync(MANIFEST, JSON.stringify(man, null, 2) + "\n", "utf8");
  console.log(`\n  wrote ${outFile}`);
  console.log(`  recorded in ${MANIFEST}`);
  console.log(`\n  Re-run \`node scripts/derive-retired-union.js --write\`: the union is`);
  console.log(`  computed against the frozen editions and this one is new to it.`);
}

main();

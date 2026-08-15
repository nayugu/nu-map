#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// DERIVE CO-OP COURSES — which catalog courses ARE a work term
//
// A co-op is two things at once. NU Map models it natively as a block that
// occupies semester slots, grants `EX` and zeroes the term's study load. NEU
// *also* registers it as a real course, and 140 programs name one as a
// requirement. The bridge between the two has always been a single hardcoded
// string in `src/adapters/northeastern/specialTerms.js`:
//
//     courseGrants: ["COOP3945"],
//
// That string is one cell of a table with 87 entries, and it satisfies zero of
// the ~99 graduate programs, because graduate co-op registers under the
// PROGRAM'S OWN SUBJECT — `ENCP 6964` for the College of Engineering, `CS 6964`
// for Khoury, `PPUA 6964` for policy. Only 10 of the 87 are in subject `COOP`.
//
// This script writes the table. See docs/coop-design.md.
//
// ── The classification is by TITLE, and it has to be ────────────────
//
// The distinction that matters is between a course you REGISTER for to record a
// work term, and a course you SIT IN. Number ranges cannot tell them apart:
// `ENCP 6100` ("Introduction to Cooperative Education", 1 SH, a real class) and
// `ENCP 6954` ("Co-op Work Experience - Half-Time", 0 SH, a registration) are
// adjacent in the same subject. Only the title says which is which.
//
// Measured over the 2026 catalog, the 87 work-experience titles partition
// perfectly along two flags:
//
//                domestic   abroad
//   full-time          34       19
//   half-time          19       15
//
// and a further 25 courses are co-op-TITLED but are ordinary classes —
// professional-development seminars, integration seminars, `Introduction to
// Co-op`. Those are left alone: they are courses a student really does place.
//
// ── Guards ──────────────────────────────────────────────────────────
//
// Same principle as `fetch-nupath`'s 5% rule and `scrape-rails`: this file
// decides which courses stop being placeable in the bank, so a bad run must
// refuse to write rather than quietly remove a course a student needs.
//
//   zero-credit   every work-experience course must be 0 SH. If NEU ever makes
//                 one credit-bearing, hiding it from the bank would silently
//                 lose a student credit — so stop and make a human look.
//   no-shrink     a >20% drop against the existing file means upstream changed
//                 shape, not that NEU deleted twenty co-op courses.
//   prep-overlap  nothing classified as a work term may read like a class.
//
// Usage:  node scripts/derive-coop-courses.js [--write]
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IN   = path.join(REPO, "public/northeastern/catalog-courses.json");
const OUT  = path.join(REPO, "public/northeastern/coop-courses.json");

/** A registration row for a work term. */
const WORK = /co-?op work experience|internship exchange|work experience abroad/i;

/**
 * A class you sit in — this WINS over WORK when both match.
 *
 * The case that forced the precedence: `EESC 6400 "Pre-co-op Work Experience"`
 * matches WORK on the words "co-op Work Experience", but its description is
 * "…in order to PREPARE FOR graduate co-op" — the same description as
 * `BINF 6900 "Pre–Co-op Experience"`, which WORK misses only because its title
 * happens to omit the word "Work". They are the same kind of thing, so the
 * classification must not turn on that accident.
 */
const CLASSROOM = /professional development|introduction to|integration seminar|reflection seminar|preparing for|pre-?.?co-?op/i;

const isWork = (title) => WORK.test(title ?? "") && !CLASSROOM.test(title ?? "");

const flagsOf = (title) => ({
  abroad:   /abroad|global|international/i.test(title),
  halfTime: /half[-\s]?time/i.test(title),
});

const catalog = JSON.parse(readFileSync(IN, "utf8"));
const courses = Array.isArray(catalog) ? catalog : (catalog.courses ?? Object.values(catalog));
const keyOf   = (c) => c.subject + c.number;

const work     = courses.filter(c => isWork(c.title));
const excluded = courses.filter(c => WORK.test(c.title ?? "") && CLASSROOM.test(c.title ?? ""));

// The boundary between "registration" and "class" is the only judgement this
// script makes, so it is printed on every run rather than buried. A new title
// appearing here is a prompt to read it, not a failure.
if (excluded.length) {
  console.log(`excluded as classroom courses despite matching the work-term pattern:`);
  for (const c of excluded) console.log(`  ${keyOf(c).padEnd(10)} ${c.title}`);
  console.log();
}

// ── Guards ────────────────────────────────────────────────────────────
const problems = [];

const credited = work.filter(c => (c.credits ?? 0) !== 0);
if (credited.length) {
  problems.push(`${credited.length} work-experience course(s) carry credit — a work term grants 0 SH, so `
    + `hiding these from the bank would lose a student credit:\n    `
    + credited.map(c => `${keyOf(c)} ${c.credits} SH  ${c.title}`).join("\n    "));
}

if (existsSync(OUT)) {
  const prev = JSON.parse(readFileSync(OUT, "utf8"));
  const was  = Object.keys(prev.courses ?? {}).length;
  if (was > 0 && work.length < was * 0.8) {
    problems.push(`work-experience course count fell from ${was} to ${work.length} (>20%). `
      + `That is a change in upstream shape, not twenty deleted co-ops.`);
  }
}

// ── Report ────────────────────────────────────────────────────────────
const byFlags = {};
const map = {};
for (const c of work.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
  const f = flagsOf(c.title ?? "");
  map[keyOf(c)] = f;
  const bucket = `${f.halfTime ? "half" : "full"}/${f.abroad ? "abroad" : "domestic"}`;
  byFlags[bucket] = (byFlags[bucket] ?? 0) + 1;
}

console.log(`work-experience courses: ${work.length}  across ${new Set(work.map(c => c.subject)).size} subjects`);
for (const [k, v] of Object.entries(byFlags).sort()) console.log(`  ${k.padEnd(14)} ${String(v).padStart(3)}`);
const inCoopSubject = work.filter(c => c.subject === "COOP" || c.subject === "COP").length;
console.log(`  in subject COOP/COP: ${inCoopSubject} — the other ${work.length - inCoopSubject} are why a `
  + `subject-based lookup cannot work`);

const classroom = courses.filter(c => /co-?op|cooperative/i.test(c.title ?? "") && !isWork(c.title));
console.log(`\nco-op-titled ordinary classes, left placeable: ${classroom.length}`);

if (problems.length) {
  console.error(`\n✖ REFUSING TO WRITE — ${problems.length} guard(s) tripped:\n`);
  problems.forEach(p => console.error(`  • ${p}\n`));
  process.exitCode = 1;
} else if (process.argv.includes("--write")) {
  const doc = {
    generated: new Date().toISOString().slice(0, 10),
    source: "catalog course titles",
    note: "Courses recorded by placing a work term rather than by being placed. See docs/coop-design.md.",
    count: work.length,
    byFlags,
    courses: map,
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
  console.log(`\nwrote ${OUT}`);
} else {
  console.log(`\n(dry run — pass --write to update ${OUT})`);
}

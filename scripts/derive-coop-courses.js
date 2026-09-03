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

/**
 * A registration row for a work term, decidable from the title alone.
 *
 * `research work experience` is CS 8948/8949, found by asking the sceptical
 * question the other way round — not "are we hiding a class?" but "are we
 * leaving a registration placeable?". Their description settles it: "Doctoral
 * students register for this course before starting their off-campus
 * internship." No program names them, so nothing was reported wrong; they were
 * simply two draggable cards that record a work term.
 */
const WORK = /co-?op work experience|research work experience|internship exchange|internship experience|work experience abroad/i;

/**
 * The one title the corpus cannot decide on its own: a bare `Internship`.
 *
 * 37 courses carry it. Two of them (`COP 5002`, `PPUA 6861`) are 0 SH
 * registrations — COP is literally the co-op subject, and PPUA 6861's
 * description is "an approved public- or nonprofit-sector internship that
 * fulfills academic degree requirements". The other 35 are the departmental
 * `*994 Internship` courses, 4 SH each, which a student really does place and
 * really does earn credit for.
 *
 * No wording separates them, so this branch — and ONLY this branch — consults
 * credit. That is a weakening of "classify by title" and it is deliberate:
 * the alternative is either hiding 35 credit-bearing courses from the bank
 * (losing a student 140 SH between them) or leaving two work registrations
 * placeable as if they were classes.
 *
 * Note what it does NOT weaken: the zero-credit guard below still governs
 * everything matched by WORK, which is where a new credit-bearing title would
 * actually show up.
 */
const BARE_INTERN = /^\s*internship\s*$/i;

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

const isWork = (c) => {
  const title = c.title ?? "";
  if (CLASSROOM.test(title)) return false;
  if (WORK.test(title)) return true;
  return BARE_INTERN.test(title) && (c.credits ?? 0) === 0;
};

/**
 * Which BLOCK records this course.
 *
 * The card's picker is scoped by it: an internship block offers internship
 * registrations, a co-op block offers co-op registrations. Both are work terms
 * and both hide from the bank, but they are not the same claim — `COOP 3949
 * Internship Exchange` is not a co-op, and a student who dragged an internship
 * should not be shown `COOP 3945` as if it were theirs to pick.
 */
const kindOf = (title) => (/intern/i.test(title) ? "intern" : "coop");

const flagsOf = (title) => ({
  abroad:   /abroad|global|international/i.test(title),
  halfTime: /half[-\s]?time/i.test(title),
});

const catalog = JSON.parse(readFileSync(IN, "utf8"));
const courses = Array.isArray(catalog) ? catalog : (catalog.courses ?? Object.values(catalog));
const keyOf   = (c) => c.subject + c.number;

const work     = courses.filter(isWork);
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
const byKind  = {};
const map = {};
for (const c of work.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
  const f    = flagsOf(c.title ?? "");
  const kind = kindOf(c.title ?? "");
  map[keyOf(c)] = { ...f, kind };
  const bucket = `${f.halfTime ? "half" : "full"}/${f.abroad ? "abroad" : "domestic"}`;
  byFlags[bucket] = (byFlags[bucket] ?? 0) + 1;
  byKind[kind]    = (byKind[kind] ?? 0) + 1;
}

console.log(`work-experience courses: ${work.length}  across ${new Set(work.map(c => c.subject)).size} subjects`);
for (const [k, v] of Object.entries(byFlags).sort()) console.log(`  ${k.padEnd(14)} ${String(v).padStart(3)}`);
console.log(`  by block:`);
for (const [k, v] of Object.entries(byKind).sort()) console.log(`    ${k.padEnd(12)} ${String(v).padStart(3)}`);
const inCoopSubject = work.filter(c => c.subject === "COOP" || c.subject === "COP").length;
console.log(`  in subject COOP/COP: ${inCoopSubject} — the other ${work.length - inCoopSubject} are why a `
  + `subject-based lookup cannot work`);

const classroom = courses.filter(c => /co-?op|cooperative|internship/i.test(c.title ?? "") && !isWork(c));
console.log(`\nco-op-titled ordinary classes, left placeable: ${classroom.length}`);

// ── Co-op PREP: the classes that must come before the work term ───────
//
// The advising team's complaint: nothing in NU Map says a professional-
// development course has to precede the co-op it prepares you for. Nothing
// upstream says so either — `COOP 3945` has empty prereqs and empty coreqs, and
// the catalog states the rule nowhere.
//
// `derive-plan-order.js` already infers it from the published sample plans
// (`coopPrep`: the text mentions co-op AND no plan ever places the course after
// the first work term) and CHART already hard-bounds those courses. But that
// rule has a confound, measured here:
//
//   its second test screens out LATE false positives — MEIE 4702 is a senior
//   capstone that discusses co-op experience, and 0% of plans put it early —
//   but it is VACUOUS FOR EARLY ONES. "Never appears after the first work term"
//   is automatically true of any first-year course, because co-ops start in
//   year two or three. So three first-year seminars that merely MENTION co-op
//   in their description came through:
//
//     BIOL1000 Biology at Northeastern      "…orientation to cooperative education…"
//     MATH1000 Mathematics at Northeastern  "…learn more about co-op."
//     ENVR1500 Introduction to Env… Data    "…prepare students for co-ops…"
//
// None is a co-op prerequisite. Telling a student that "Mathematics at
// Northeastern" must precede their co-op is wrong, and wrong in the way that
// costs trust in everything else on the card.
//
// The fix needs no new predicate: intersect that evidence with the TITLE
// classification this script already makes. A prep course is one whose title
// says it is about co-op (`classroom`, above) and whose position the
// departments agree on (`coopPrep`). Measured: 7 kept, exactly those 3 dropped.
//
// Title alone would NOT do — `Ethics and Professional Development` and
// `Designing Transformative Curriculum and Professional Development` match the
// CLASSROOM pattern and are not co-op prep. It is the conjunction that works.
//
// plan-order.json is written by a separate manual derive, so it may be absent
// or stale. Absent → no `prep` block at all, never a guess.
const PLAN_ORDER = path.join(REPO, "public/northeastern/plan-order.json");
const classroomIds = new Set(classroom.map(keyOf));
let prep = null;

if (existsSync(PLAN_ORDER)) {
  const planOrder = JSON.parse(readFileSync(PLAN_ORDER, "utf8"));
  const candidates = Array.isArray(planOrder.coopPrep) ? planOrder.coopPrep : [];
  const kept = [], dropped = [];
  for (const entry of candidates) {
    const id = entry?.course;
    const obs = entry?.observations;
    if (!id || !Number.isFinite(obs)) continue;
    (classroomIds.has(id) ? kept : dropped).push({ id, obs });
  }
  prep = {};
  for (const { id, obs } of kept.sort((a, b) => a.id.localeCompare(b.id))) {
    prep[id] = { observations: obs };
  }
  const titleOf = (id) => courses.find(c => keyOf(c) === id)?.title ?? "?";
  console.log(`\nco-op PREP — plan evidence ∩ co-op title: ${kept.length} of ${candidates.length}`);
  for (const { id, obs } of kept) console.log(`  keep  ${id.padEnd(10)} ${String(obs).padStart(4)} plans  ${titleOf(id)}`);
  for (const { id, obs } of dropped)
    console.log(`  drop  ${id.padEnd(10)} ${String(obs).padStart(4)} plans  ${titleOf(id)}   ← title is not about co-op`);
  if (!kept.length && candidates.length) {
    problems.push(`plan-order.json lists ${candidates.length} co-op prep candidate(s) but NONE survived the `
      + `title test. Either the title classifier or plan-order's shape changed — writing an empty prep block `
      + `would silently remove the note from every course that has it.`);
  }
} else {
  console.log(`\nco-op PREP — skipped: ${PLAN_ORDER} not found (run derive-plan-order.js first)`);
}

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
    byKind,
    courses: map,
    // Courses that must be SAT IN before the first work term, with the number
    // of published plans that agree. Absent when plan-order.json was missing,
    // which the loaders read as "no note", never as "no requirement".
    ...(prep ? { prepCount: Object.keys(prep).length, prep } : {}),
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
  console.log(`\nwrote ${OUT}`);
} else {
  console.log(`\n(dry run — pass --write to update ${OUT})`);
}

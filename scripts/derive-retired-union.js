#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// derive-retired-union — keep a retired course RESOLVABLE for the plans
// that already name it, after the catalog stops carrying it.
//
// ── The defect this exists for ──────────────────────────────────────
//
// `public/northeastern/catalog-courses.json` is a single CURRENT snapshot and
// the monthly scrape REPLACES it, so every edition roll deletes courses out
// from under saved plans. `course-retention.js` rescues the ones a shipped
// PROGRAM tree still names — deliberately, and it says so: "it is not a
// browsing archive, and it is not keep everything". Its `need` set is the
// union of program references, and everything outside it is dropped
// (`if (!need.has(key)) { dropped.push(key); continue; }`).
//
// That is the right rule for the catalog and it leaves one gap: a program is
// not the only thing that names a course. A STUDENT'S PLAN names courses too,
// it lives in their own localStorage, and we cannot enumerate it. So the
// courses retention correctly drops are exactly the ones no audit protects.
//
// Measured for the 2026→2027 roll (`edition-probe.js --snapshot --editions
// 2027 --all-subjects`, 2026-09-02): 974 of our 7,966 courses are absent from
// the live edition, plus 115 in 10 subjects with no live page at all — about
// 1,089 retirements. CLAUDE.md's independent simulation of the same roll puts
// retention at 703 kept and **367 dropped**, corroborating within ~2%.
//
// Those 367 do not fail loudly. Measured in the browser
// (`test/browser/retired-course.browser.test.js`): a plan holding a course the
// catalog lacks opens with no error and no recovery screen, the rest of the
// board renders — and the course is GONE. No card, no notice, and
// `totalSHPlaced` sums `effectiveCourseMap[id]?.sh ?? 0`, so its credits
// silently become zero. PlannerContext says it outright: "unknown ids resolve
// to 0". A student opens their plan on a Tuesday in October and it is quietly
// short a course. That is degrading to WRONG information, which this repo's
// working rules put on the far side of the line from degrading to less.
//
// ── What it emits ───────────────────────────────────────────────────
//
// `public/northeastern/retired-courses.json` — the full record of every course
// a FROZEN EDITION SNAPSHOT carries that the current catalog does not, each
// with a lifespan naming the editions rather than a scrape date.
//
// ── Why the frozen snapshots are the source ─────────────────────────
//
// Not "whatever was in last month's catalog". Deriving from the previous run
// would make the union accumulate forever with nothing able to prune it, and
// it would encode our scrape history rather than NEU's catalog.
//
// Deriving from the snapshots in `data/northeastern/catalog/editions/` gives
// the union the same self-pruning property retention has, by the same
// mechanism: a course is kept only while a shipped edition carries it, so
// dropping an edition tree drops its exclusive courses on the next run. There
// is no accumulating set and nothing to garbage-collect. It is also
// recomputed from scratch every time, so a bad run cannot leave residue.
//
// ── Disjointness is the load-bearing invariant ──────────────────────
//
// A key is either current or retired, NEVER both. There is no field-level
// merge anywhere in this design, and that is what makes the runtime rule one
// line ("look here only if the catalog missed"). It also means this file must
// be derived AFTER retention has run: the courses retention pulls back into
// the catalog are current-file entries, and emitting them here as well would
// create exactly the two-sources-for-one-key ambiguity the disjointness rule
// exists to forbid.
//
// ── Lifespan, not a boolean ─────────────────────────────────────────
//
// `retiredSince` is the day OUR scrape first failed to find the course, which
// is a fact about us. What a student needs is the fact about the catalog:
// which editions published it. `{firstEdition, lastEdition, editions[]}` is
// answerable relative to their own catalog year, which a boolean never is —
// a course retired in 2027 is not retired for a 2026 student, it is current.
//
// The figures are bounded by what we hold: `lastEdition` is the newest
// snapshot carrying the course, and with one snapshot on disk that is all it
// can be. It is a floor on the course's real life, never a claim about the
// editions we have never read — the same absent-vs-false distinction
// `knownTermCodes` enforces in term-history.js. `editionsHeld` records how
// many snapshots the answer was computed over, so a reader can tell a narrow
// answer from a confident one.
//
// Usage:
//   node scripts/derive-retired-union.js            # report only
//   node scripts/derive-retired-union.js --write    # write the artifact
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { keyOfCourse } from "./lib/course-retention.js";

const EDITIONS_DIR = "data/northeastern/catalog/editions";
const CATALOG      = "public/northeastern/catalog-courses.json";
const OUT          = "public/northeastern/retired-courses.json";

/**
 * A run that would clear most of the union refuses to write, for the same
 * reason `fetch-nupath` refuses at 5% and `derive-restrictions` at 20%: this
 * runs unattended in the monthly job, and a broken upstream must not silently
 * empty an artifact students' plans resolve against. Growth is never blocked —
 * an edition roll is SUPPOSED to add hundreds at once.
 */
const MAX_SHRINK = 0.20;

const WRITE = process.argv.includes("--write");

const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Every frozen edition on disk, oldest first. Labelled by END year. */
function editionsOnDisk() {
  if (!existsSync(EDITIONS_DIR)) return [];
  return readdirSync(EDITIONS_DIR)
    .filter(name => /^\d{4}$/.test(name))
    .map(Number)
    .sort((a, b) => a - b)
    .map(year => ({ year, path: join(EDITIONS_DIR, String(year), "catalog-courses.json") }))
    .filter(e => existsSync(e.path));
}

/**
 * The whole derivation, as one pure function.
 *
 * Separated from IO for the reason `course-retention.js` gives for the same
 * split: inline, the only way to exercise this is to have a real edition roll,
 * which happens once a year. The interesting behaviour — a roll that retires a
 * thousand courses — is then untestable until the morning it runs unattended.
 * Here a test can hand it a simulated post-roll catalog in milliseconds.
 *
 * @param {object[]} catalog   the CURRENT catalog, retention already applied
 * @param {{year:number, rows:object[]}[]} snapshots  frozen editions, any order
 * @returns {{retired: object[], perEdition: object, current: Set<string>}}
 */
export function deriveRetiredUnion(catalog, snapshots) {
  // The current catalog INCLUDES retention's rescued courses, which is what
  // makes the two files disjoint without a subtraction step here.
  const current = new Set(catalog.map(keyOfCourse).filter(Boolean));
  const ordered = [...snapshots].sort((a, b) => a.year - b.year);

  // key → { record, editions: Set<year> }. The record kept is the one from the
  // NEWEST edition carrying it: that is the last thing NEU published about the
  // course, so its title, credits and description are the least stale copy we
  // have. Editions are walked oldest-first, so a later write is the newer one.
  const held = new Map();
  const perEdition = {};
  for (const { year, rows } of ordered) {
    let inEdition = 0;
    for (const c of rows) {
      const key = keyOfCourse(c);
      if (!key) continue;
      inEdition++;
      const prior = held.get(key);
      if (prior) { prior.record = c; prior.editions.add(year); }
      else held.set(key, { record: c, editions: new Set([year]) });
    }
    perEdition[year] = inEdition;
  }

  const retired = [];
  for (const [key, { record, editions: yrs }] of held) {
    if (current.has(key)) continue;          // still published — not retired
    const years = [...yrs].sort((a, b) => a - b);
    // `retired`/`retiredSince` may be present on a record that was itself
    // rescued into an older snapshot. Strip them: this file states the
    // lifespan, and two representations of the same fact drift.
    const { retired: _r, retiredSince: _s, ...clean } = record;
    retired.push({
      ...clean,
      lifespan: {
        firstEdition: years[0],
        lastEdition:  years[years.length - 1],
        editions:     years,
        // How many snapshots the lifespan was computed over. With one on disk
        // the bounds are as tight as they can be and no tighter; this is what
        // stops a reader mistaking a narrow answer for a confident one.
        editionsHeld: ordered.length,
      },
    });
  }
  retired.sort((a, b) => (keyOfCourse(a) < keyOfCourse(b) ? -1 : 1));
  return { retired, perEdition, current };
}

function main() {
  const editions = editionsOnDisk();
  if (!editions.length) {
    console.error(`No frozen editions under ${EDITIONS_DIR}/ — nothing to derive.`);
    process.exit(1);
  }

  const catalog = readJSON(CATALOG);
  if (!Array.isArray(catalog) || !catalog.length) {
    console.error(`${CATALOG} is not a non-empty array — refusing to derive against it.`);
    process.exit(1);
  }

  const snapshots = editions.map(({ year, path }) => {
    const rows = readJSON(path);
    if (!Array.isArray(rows) || !rows.length) {
      console.error(`  ${year}: snapshot is empty or not an array — refusing.`);
      process.exit(1);
    }
    return { year, rows };
  });

  console.log(`\nRETIRED UNION`);
  console.log(`  current catalog: ${catalog.length} courses`);
  console.log(`  frozen editions: ${editions.map(e => e.year).join(", ")}\n`);

  const { retired, perEdition, current } = deriveRetiredUnion(catalog, snapshots);
  for (const [year, n] of Object.entries(perEdition)) console.log(`  ${year}: ${n} courses`);

  // ── Rails ──────────────────────────────────────────────────────────
  const prev = existsSync(OUT) ? readJSON(OUT) : [];
  const prevN = Array.isArray(prev) ? prev.length : 0;
  if (prevN && retired.length < prevN * (1 - MAX_SHRINK)) {
    console.error(
      `\n  REFUSING TO WRITE: the union would shrink ${prevN} → ${retired.length} `
      + `(more than ${MAX_SHRINK * 100}%). A snapshot may be missing or truncated.`);
    process.exit(1);
  }
  // Disjointness, asserted rather than assumed — it is the one property the
  // runtime rule depends on, and a bug in the retention step upstream is
  // exactly how it would break.
  const overlap = retired.map(keyOfCourse).filter(k => current.has(k));
  if (overlap.length) {
    console.error(
      `\n  REFUSING TO WRITE: ${overlap.length} key(s) in BOTH files, e.g. `
      + `${overlap.slice(0, 8).join(" ")}. The union must be disjoint from the catalog.`);
    process.exit(1);
  }

  const bySubject = {};
  for (const c of retired) bySubject[c.subject] = (bySubject[c.subject] ?? 0) + 1;
  const top = Object.entries(bySubject).sort((a, b) => b[1] - a[1]).slice(0, 10);

  console.log(`\n  retired union: ${retired.length} courses (was ${prevN})`);
  if (top.length) console.log(`  largest subjects: ${top.map(([s, n]) => `${s}(${n})`).join(" ")}`);

  if (!WRITE) {
    console.log(`\n  (report only — pass --write to update ${OUT})`);
    return;
  }
  writeFileSync(OUT, JSON.stringify(retired), "utf8");
  console.log(`\n  wrote ${OUT}`);
}

// Importing this file must not run a derivation — the test drives the pure
// function above with a simulated catalog.
if (process.argv[1] && process.argv[1].endsWith("derive-retired-union.js")) main();

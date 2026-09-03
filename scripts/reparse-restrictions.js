#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// REPARSE RESTRICTIONS — re-derive stored gates from cached pages
//
// `getRestrictions` is one call per CRN: ~7,400 calls and ~30 minutes per term.
// Before the cache existed, every change to the parser cost a full re-fetch of
// every term, which is why the comma-split defect went unnoticed for a month
// and why widening the parser to the other ten restriction kinds looked like a
// 4.5-hour job. This script is the other half of that fix: it re-parses pages
// already captured and rewrites the stored fields, with no Banner traffic.
//
// ── PER-COURSE COMPLETENESS, not per-term ──────────────────────────
//
// The safety property that matters. `termGate` reads "every section is gated"
// off the section COUNT, so a course whose cache is missing one section can be
// folded from "gated on 3 of 4" — no gate — into "gated on 3 of 3", a FALSE
// gate. A false gate refuses a plan; a missing one only sequences a course
// early. So a term-level completeness check is not good enough: 99% of a term
// cached still means hundreds of courses silently mis-folded.
//
// A course is re-derived only when the cache holds EVERY CRN that term-details
// says it had. Anything short of that leaves the stored value untouched and is
// counted as skipped. Measured on the probe's sampled cache: 1,300 of ~6,800
// pages per term, so almost everything is correctly skipped and the script
// refuses to pretend otherwise.
//
// ── USAGE ──────────────────────────────────────────────────────────
//
//   node scripts/reparse-restrictions.js            report only
//   node scripts/reparse-restrictions.js --write    update term-details.json
//   node scripts/reparse-restrictions.js --migrate  fold legacy per-page dirs in
//
// Exits 0 on a clean report, 1 when a guard trips.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname }                   from "node:path";
import { fileURLToPath }                      from "node:url";

import { parseRestrictions, classesOf }       from "./lib/class-standing.js";
import { restrictionsOf, tallySection }       from "./lib/restrictions.js";
import { cachedTerms, readTermCache, migrateLegacy, legacyTerms }
                                              from "./lib/restriction-cache.js";

const ROOT    = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DETAILS = resolve(ROOT, "public/northeastern/term-details.json");
const LABELS  = resolve(ROOT, "public/northeastern/restriction-labels.json");

const WRITE   = process.argv.includes("--write");
const MIGRATE = process.argv.includes("--migrate");

const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : "—");

function main() {
  if (MIGRATE) {
    const legacy = legacyTerms();
    if (!legacy.length) console.log("no legacy per-page directories to migrate");
    for (const t of legacy) {
      const res = migrateLegacy(t);
      console.log(`migrated ${t}: ${res.pages} pages folded into one gzipped file`);
    }
    console.log();
  }

  const details = JSON.parse(readFileSync(DETAILS, "utf8"));
  const terms = cachedTerms().concat(legacyTerms()).filter((t, i, a) => a.indexOf(t) === i).sort();
  if (!terms.length) { console.error("nothing cached — run the scrape or the probe first"); process.exit(1); }

  console.log(`term-details: ${Object.keys(details).length} courses`);
  console.log(`cached terms: ${terms.join(", ")}\n`);

  let totalChanged = 0, totalCourses = 0;
  const problems = [];
  const caveats  = [];
  // Code → label, accumulated across every term re-parsed, merged over the
  // existing file so re-parsing one term does not drop the others' labels.
  const labels   = {};

  for (const term of terms) {
    const cache = readTermCache(term);
    if (!cache) { console.log(`${term}: unreadable cache — skipped`); continue; }

    const pages   = cache.pages;
    const byCrn   = cache.courses;             // crn → courseId
    const cachedN = Object.keys(pages).length;

    // Which CRNs does the cache hold for each course?
    const crnsByCourse = new Map();
    let unattributed = 0;
    for (const crn of Object.keys(pages)) {
      const id = byCrn[crn];
      if (!id) { unattributed += 1; continue; }
      if (!crnsByCourse.has(id)) crnsByCourse.set(id, []);
      crnsByCourse.get(id).push(crn);
    }

    // Expected section count per course, from the data the scrape already wrote.
    let expected = 0, coursesInTerm = 0;
    for (const [id, byTerm] of Object.entries(details)) {
      const d = byTerm?.[term];
      if (!d || !Number.isFinite(d.sections)) continue;
      coursesInTerm += 1;
      expected += d.sections;
    }

    let complete = 0, partial = 0, changed = 0, unchanged = 0;
    const diffs = [];

    for (const [id, crns] of crnsByCourse) {
      const d = details[id]?.[term];
      if (!d || !Number.isFinite(d.sections)) continue;
      // THE guard. Fewer cached pages than the course had sections means the
      // fold below would read "all sections gated" off an incomplete set.
      if (crns.length < d.sections) { partial += 1; continue; }
      complete += 1;

      const must = new Map(), not = new Map();
      const nextRestr = {};
      for (const crn of crns) {
        const parsed = parseRestrictions(pages[crn]);
        // The whole pane. This is the field that actually needs re-deriving:
        // terms captured before it existed hold only the `Classes` heading, and
        // re-reading them from Banner is ~30 minutes each.
        const { blocks, labels: L } = restrictionsOf(parsed);
        tallySection(blocks, nextRestr);
        Object.assign(labels, L);
        const { must: mk, not: nk } = classesOf(parsed);
        if (mk) must.set(mk, (must.get(mk) ?? 0) + 1);
        if (nk) not.set(nk, (not.get(nk) ?? 0) + 1);
      }
      const nextStd    = must.size ? Object.fromEntries([...must].sort()) : undefined;
      const nextStdNot = not.size  ? Object.fromEntries([...not].sort())  : undefined;
      const nextR      = Object.keys(nextRestr).length ? nextRestr : undefined;

      const same = JSON.stringify(d.std)    === JSON.stringify(nextStd)
                && JSON.stringify(d.stdNot) === JSON.stringify(nextStdNot)
                && JSON.stringify(d.restr)  === JSON.stringify(nextR);
      if (same) { unchanged += 1; continue; }
      changed += 1;
      if (diffs.length < 8) {
        const kinds = nextR ? Object.keys(nextR).length : 0;
        diffs.push(`${id}: std ${JSON.stringify(d.std)} → ${JSON.stringify(nextStd)}` +
                   `, restr ${d.restr ? Object.keys(d.restr).length : 0} → ${kinds} kinds`);
      }
      if (WRITE) {
        if (nextStd)    d.std    = nextStd;    else delete d.std;
        if (nextStdNot) d.stdNot = nextStdNot; else delete d.stdNot;
        if (nextR)      d.restr  = nextR;      else delete d.restr;
      }
    }

    console.log(`${term}: ${cachedN} pages cached of ${expected} sections (${pct(cachedN, expected)} of the term)`);
    if (unattributed) console.log(`  ${unattributed} pages have no course identity — cached before the manifest, unusable here`);
    console.log(`  courses fully cached: ${complete} of ${coursesInTerm}   partially: ${partial} (left untouched)`);
    console.log(`  re-derived: ${unchanged} unchanged, ${changed} CHANGED`);
    diffs.forEach(x => console.log(`    Δ ${x}`));

    totalChanged += changed;
    totalCourses += complete;

    // Unattributable pages are a CAVEAT, not a guard, and this started as the
    // latter until the reasoning was worked through: a course is re-derived only
    // when its ATTRIBUTED pages already reach its section count, and a page with
    // no identity is excluded from that count entirely. So an unattributed page
    // can only ever mean a course had more CRNs than term-details records — it
    // can never turn "gated on 3 of 4" into "gated on 3 of 3", which is the only
    // shape that writes a false gate. Blocking `--write` on it protected nothing
    // and made the tool refuse every pre-manifest cache.
    if (unattributed) {
      caveats.push(`${term}: ${unattributed} pages cached before the manifest cannot be ` +
        `attributed to a course. They are ignored, so this run judges fewer courses ` +
        `complete than the cache could support — re-run the scrape to make them usable.`);
    }
  }

  console.log(`\n── Summary ──`);
  console.log(`courses re-derived: ${totalCourses}`);
  console.log(`values changed:     ${totalChanged}`);

  if (caveats.length) {
    console.log(`\ncaveats:`);
    caveats.forEach(c => console.log(`  · ${c}`));
  }

  if (problems.length) {
    console.error(`\n✖ ${problems.length} guard(s) tripped:`);
    problems.forEach(p => console.error(`  • ${p}`));
    process.exit(1);
  }

  if (!WRITE) {
    console.log(`\n(dry run — pass --write to update ${DETAILS})`);
    return;
  }
  if (!totalChanged) { console.log(`\nnothing to write.`); return; }
  writeFileSync(DETAILS, JSON.stringify(details, null, 2));
  console.log(`\nwrote ${DETAILS}`);
  if (Object.keys(labels).length) {
    let prev = {};
    if (existsSync(LABELS)) { try { prev = JSON.parse(readFileSync(LABELS, "utf8")); } catch {} }
    const merged = { ...prev, ...labels };
    writeFileSync(LABELS, JSON.stringify(merged, null, 1) + "\n");
    console.log(`wrote ${LABELS} (${Object.keys(merged).length} codes)`);
  }
}

main();

#!/usr/bin/env node
/**
 * edition-probe.js — the instrument for catalog-edition questions.
 *
 * Design of record: docs/catalog-editions-design.md.
 *
 * It exists because the expensive verifications in this repo were never the
 * committed ones — they were scripts written in a chat to answer one question
 * and deleted afterwards, so the next question of the same shape paid full
 * price again. Six `*probe*` scripts already accreted that way. Extend THIS
 * file rather than writing another one.
 *
 * What it answers, over a subject sample or the whole catalog:
 *
 *   membership drift  which courses an edition gained / lost / kept
 *   field drift       on the courses BOTH editions have, which fields actually
 *                     differ — the measurement that decides whether historical
 *                     editions are stored as snapshots or as overlays
 *                     (docs/catalog-editions-design.md §6)
 *   fidelity          whether an edition publishes prereqs/coreqs/NUPath at
 *                     all, MEASURED rather than trusted from the table in §4
 *   lifespan          which editions published a named course, which is what
 *                     turns "retired" from a boolean into a fact
 *
 * Usage:
 *   node scripts/edition-probe.js --fidelity
 *   node scripts/edition-probe.js --drift --editions 2025,2027
 *   node scripts/edition-probe.js --course CS2500
 *   node scripts/edition-probe.js --drift --editions 2025,2027 --all-subjects
 *
 * SAMPLE BY DEFAULT. A 230-subject x 7-edition sweep is ~1,600 fetches at
 * 400 ms and must never be what you get for forgetting a flag; --all-subjects
 * is opt-in and needs a reason, same rule as verify-chart --all.
 */
import { existsSync, readdirSync } from "node:fs";
import { parse as parseHTML } from "node-html-parser";
import { parseSubjectPage, fidelityOfEdition } from "./lib/catalog-course-parser.js";
import { parseCatalogEdition } from "./lib/catalog-program-parser.js";

const BASE = "https://catalog.northeastern.edu";
const DELAY_MS = parseInt(process.env.CATALOG_DELAY_MS ?? "400", 10);

/**
 * The live edition. Not a constant we maintain by hand — that is exactly the
 * mistake parseCatalogEdition exists to prevent — but a default the caller can
 * override, resolved from the live site on first use.
 */
let LIVE_YEAR = null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── argv ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has  = (f) => argv.includes(f);
const val  = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

/**
 * A default subject sample chosen for SPREAD, not size: a large
 * prereq-chained subject, a service subject every degree touches, two
 * professional subjects with their own numbering habits, a humanities subject
 * where descriptions carry the requirements, and a subject with labs.
 */
const SAMPLE_SUBJECTS = ["cs", "math", "biol", "eece", "engw", "phys"];

// ── fetch ─────────────────────────────────────────────────────────────────────
/**
 * Retries are not politeness padding here, they are what makes a full-catalog
 * sweep possible at all. `--all-subjects` is 227 pages; at even a 1% transient
 * rate an unretried run aborts most of the time, and it aborts AFTER spending
 * the four minutes. Measured: the first two attempts at this died on a bare
 * `fetch failed` (a connection reset, no status), one of them 200 pages in.
 *
 * A 404 still returns null on the FIRST look, without retrying — that is a real
 * answer about the edition (subjects appear and disappear), not a failure.
 */
async function fetchPage(url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "NU-Map-DataBot/1.0 (academic degree planner; contact nayugu@github; respects robots.txt)",
          Accept: "text/html",
        },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === attempts) throw new Error(`${e.message} for ${url} (after ${attempts} attempts)`);
      // Linear, not exponential: the observed failure is a single reset rather
      // than rate limiting, and a sweep this long should not silently stretch.
      await sleep(DELAY_MS * 2 * i);
    }
  }
}

/** `/archive/2024-2025` for a past edition, `` for the live one. */
function basePathFor(year) {
  return year === LIVE_YEAR ? "" : `/archive/${year - 1}-${year}`;
}

async function resolveLiveYear() {
  if (LIVE_YEAR != null) return LIVE_YEAR;
  const html = await fetchPage(`${BASE}/course-descriptions/cs/`);
  const y = parseCatalogEdition(parseHTML(html ?? ""));
  if (!y) throw new Error("could not read the live edition banner — has the markup changed?");
  LIVE_YEAR = y;
  return y;
}

/**
 * Fetch and parse one subject page for one edition.
 *
 * Returns null when the page does not exist for that edition, which is a real
 * answer (subjects appear and disappear) and must not be conflated with "the
 * page existed and held no courses".
 */
async function subjectFor(year, slug) {
  const url = `${BASE}${basePathFor(year)}/course-descriptions/${slug}/`;
  const html = await fetchPage(url);
  await sleep(DELAY_MS);
  if (html == null) return null;

  const root = parseHTML(html);
  const pageYear = parseCatalogEdition(root);
  // Provenance, for the same reason catalog-edition.js asserts it: if a URL can
  // serve the wrong edition, every measurement taken from it is worthless. Here
  // it only warns, because a probe must be able to report a broken archive
  // rather than refuse to run against one.
  if (pageYear != null && pageYear !== year) {
    console.warn(`  ⚠ ${url} claims the ${pageYear} edition, asked for ${year}`);
  }

  const courses = parseSubjectPage(html, slug.toUpperCase());
  return { url, pageYear, courses, blocks: root.querySelectorAll(".courseblock, [class*='courseblock']").length };
}

const keyOf = (c) => `${c.subject}${c.number}`;

// ── fidelity ──────────────────────────────────────────────────────────────────
/**
 * Does an edition publish prereqs/coreqs/NUPath at all?
 *
 * Measured off the RAW page (label counts), not off parsed records, because the
 * parser can fail for an unrelated reason and a zero would then look like a
 * fidelity fact. `parsed` is reported beside it precisely so the two can
 * disagree visibly: on the descriptive era the title regex matches nothing, so
 * `blocks` is large and `parsed` is 0 — which is the finding, not a bug.
 */
async function reportFidelity(years, slugs) {
  console.log("\nFIDELITY — measured off raw pages, per edition\n");
  console.log("  edition  blocks  parsed  prereqLines  coreqLines  attrLines  predicted  measured");
  for (const year of years) {
    let blocks = 0, parsed = 0, pre = 0, co = 0, attr = 0, missing = 0;
    for (const slug of slugs) {
      const url = `${BASE}${basePathFor(year)}/course-descriptions/${slug}/`;
      const html = await fetchPage(url);
      await sleep(DELAY_MS);
      if (html == null) { missing++; continue; }
      const root = parseHTML(html);
      blocks += root.querySelectorAll(".courseblock, [class*='courseblock']").length;
      parsed += parseSubjectPage(html, slug.toUpperCase()).length;
      pre    += (html.match(/Prerequisite\(s\):/g)  ?? []).length;
      co     += (html.match(/Corequisite\(s\):/g)   ?? []).length;
      attr   += (html.match(/Attribute\(s\):/g)     ?? []).length;
    }
    const measured = (pre + attr) > 0 ? "full" : "descriptive";
    const predicted = fidelityOfEdition(year);
    const flag = measured === predicted ? "" : "   ← DISAGREES WITH THE TABLE";
    console.log(
      `  ${String(year).padEnd(7)}  ${String(blocks).padStart(6)}  ${String(parsed).padStart(6)}` +
      `  ${String(pre).padStart(11)}  ${String(co).padStart(10)}  ${String(attr).padStart(9)}` +
      `  ${predicted.padEnd(9)}  ${measured}${flag}` +
      (missing ? `   (${missing} subject page(s) absent)` : "")
    );
  }
}

// ── drift ─────────────────────────────────────────────────────────────────────
const COMPARED_FIELDS = ["title", "credits", "creditsMax", "description", "scheduleType"];
const STRUCTURAL_FIELDS = ["prereqs", "coreqs", "nuPath"];

function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Compare two editions over the same subjects.
 *
 * Field drift is reported ONLY over courses both editions publish, and
 * structural fields are reported separately and suppressed when either side is
 * descriptive — comparing a published prereq list against an unpublished one
 * would score every course as "changed" and the number would mean nothing.
 */
async function reportDrift(a, b, slugs) {
  console.log(`\nDRIFT — ${a} → ${b} over ${slugs.length} subject(s)\n`);

  const load = async (year) => {
    const map = new Map();
    let absent = 0;
    for (const slug of slugs) {
      const got = await subjectFor(year, slug);
      if (!got) { absent++; continue; }
      for (const c of got.courses) map.set(keyOf(c), c);
    }
    return { map, absent };
  };

  const A = await load(a);
  const B = await load(b);

  const ak = new Set(A.map.keys()), bk = new Set(B.map.keys());
  const added   = [...bk].filter(k => !ak.has(k)).sort();
  const removed = [...ak].filter(k => !bk.has(k)).sort();
  const stable  = [...ak].filter(k =>  bk.has(k)).sort();

  console.log(`  membership   ${a}: ${ak.size}   ${b}: ${bk.size}   stable: ${stable.length}` +
              `   added: ${added.length}   removed: ${removed.length}`);
  if (A.absent || B.absent) console.log(`  (subject pages absent — ${a}: ${A.absent}, ${b}: ${B.absent})`);
  if (removed.length) console.log(`  removed: ${removed.join(" ")}`);
  if (added.length)   console.log(`  added:   ${added.join(" ")}`);

  const bothFull = fidelityOfEdition(a) === "full" && fidelityOfEdition(b) === "full";
  console.log(`\n  field drift over the ${stable.length} stable course(s):`);
  for (const f of COMPARED_FIELDS) {
    const n = stable.filter(k => !sameValue(A.map.get(k)[f], B.map.get(k)[f])).length;
    const pct = stable.length ? (100 * n / stable.length).toFixed(1) : "0.0";
    console.log(`    ${f.padEnd(14)} ${String(n).padStart(5)}  (${pct}%)`);
  }
  for (const f of STRUCTURAL_FIELDS) {
    if (!bothFull) {
      console.log(`    ${f.padEnd(14)}     -  (not comparable: ` +
                  `${a}=${fidelityOfEdition(a)}, ${b}=${fidelityOfEdition(b)})`);
      continue;
    }
    const n = stable.filter(k => !sameValue(A.map.get(k)[f], B.map.get(k)[f])).length;
    const pct = stable.length ? (100 * n / stable.length).toFixed(1) : "0.0";
    console.log(`    ${f.padEnd(14)} ${String(n).padStart(5)}  (${pct}%)`);
  }

  const anyChange = stable.filter(k =>
    [...COMPARED_FIELDS, ...(bothFull ? STRUCTURAL_FIELDS : [])]
      .some(f => !sameValue(A.map.get(k)[f], B.map.get(k)[f]))).length;
  const pct = stable.length ? (100 * anyChange / stable.length).toFixed(1) : "0.0";
  console.log(`\n  ANY field changed: ${anyChange} of ${stable.length} (${pct}%)`);
  console.log(`  → a snapshot stores ${bk.size}; an overlay stores ${added.length + anyChange}` +
              ` (added + changed) plus ${removed.length} tombstone(s)`);
}

// ── lifespan ──────────────────────────────────────────────────────────────────
async function reportLifespan(courseKey, years) {
  const m = /^([A-Z]{2,6})\s*(\d{4}[A-Z]?)$/i.exec(courseKey.trim());
  if (!m) throw new Error(`--course expects something like CS2500, got ${JSON.stringify(courseKey)}`);
  const subject = m[1].toUpperCase(), number = m[2].toUpperCase();
  const slug = subject.toLowerCase();

  console.log(`\nLIFESPAN — ${subject} ${number}\n`);
  const had = [];
  for (const year of years) {
    const got = await subjectFor(year, slug);
    if (!got) { console.log(`  ${year}  (no ${subject} page in this edition)`); continue; }
    const c = got.courses.find(x => x.number === number);
    const fid = fidelityOfEdition(year);
    if (c) {
      had.push(year);
      console.log(`  ${year}  PRESENT  ${c.credits} SH  ${fid.padEnd(11)}  ${c.title}`);
    } else {
      // Distinguish "the edition did not publish it" from "the parser cannot
      // read this era at all" — otherwise a descriptive edition looks like
      // proof of absence, which is the exact error this whole design guards.
      const note = fid === "descriptive" && got.courses.length === 0 && got.blocks > 0
        ? "absent — BUT this era is unparsed by the current reader, so this is NOT evidence"
        : "absent";
      console.log(`  ${year}  ${note}`);
    }
  }
  if (had.length) {
    console.log(`\n  first: ${Math.min(...had)}   last: ${Math.max(...had)}   editions: ${had.join(" ")}`);
    if (!had.includes(Math.max(...years))) {
      console.log(`  → RETIRED. Last published in the ${Math.max(...had) - 1}-${Math.max(...had)} catalog.`);
    }
  } else {
    console.log("\n  found in no probed edition");
  }
}

// ── snapshot provenance ───────────────────────────────────────────────────────
/**
 * Which edition is a frozen snapshot actually a copy of?
 *
 * A snapshot on disk carries no edition banner — the scrape never recorded one —
 * so `data/northeastern/catalog/editions/<year>/` asserts its year by a filename
 * and a manifest, both of them written by hand. That is a label, not evidence,
 * and mislabelling one is unrecoverable: the whole point of the tree is to hold
 * the only copy of an edition nobody can re-fetch.
 *
 * This compares the snapshot's course SET against each named edition and reports
 * the symmetric difference per subject. A snapshot of edition N should differ
 * from both its neighbours; matching one of them exactly is the finding.
 */
async function reportSnapshot(path, years, slugs) {
  const { readFileSync } = await import("node:fs");
  const rows = JSON.parse(readFileSync(path, "utf8"));
  console.log(`\nSNAPSHOT PROVENANCE — ${path}`);
  console.log(`  ${rows.length} courses; comparing the ${slugs.join(", ")} subset against each edition\n`);

  // Filter on the record's own `subject`, NOT on a prefix of the key. `keyOf`
  // joins subject and number with no separator, so `startsWith("CS")` also
  // claims every CSYE course and `startsWith("ACC")` claims ACCT — the subset
  // silently grew, and the count it reported disagreed with a directly computed
  // one by 12 courses. A subject is a field; matching it as a string prefix is
  // guessing at data that is right there.
  const want = new Set(slugs.map(s => s.toUpperCase()));
  const subset = new Set(rows.filter(c => want.has(String(c.subject).toUpperCase())).map(keyOf));
  console.log(`  snapshot subset: ${subset.size} courses`);
  console.log("\n  edition  shared  only-snapshot  only-edition  verdict");
  for (const year of years) {
    const live = new Set();
    let missingPages = 0;
    const unread = [];
    for (const slug of slugs) {
      let got;
      try {
        got = await subjectFor(year, slug);
      } catch (e) {
        // A subject that could not be read is NOT a subject with no courses.
        // Swallowing it would move every one of its courses into
        // `only-snapshot` and read as a wave of retirements — the same
        // false-absence error the whole design is built around. Record it and
        // refuse to score the run instead.
        unread.push(slug);
        continue;
      }
      if (!got) { missingPages++; continue; }
      for (const c of got.courses) live.add(keyOf(c));
    }
    if (unread.length) {
      console.log(`  ${year}     — ${unread.length} subject(s) UNREADABLE after retries: ${unread.slice(0, 8).join(" ")}`);
      console.log("             not scored: their courses would masquerade as retirements.");
      continue;
    }
    // An unparsed era yields an empty set, which would read as "shares nothing"
    // — the same false-absence trap reportLifespan guards. Say so instead.
    if (fidelityOfEdition(year) === "descriptive" || live.size === 0) {
      console.log(`  ${year}     — unreadable by the current parser; not evidence`);
      continue;
    }
    const shared = [...subset].filter(k => live.has(k)).length;
    const onlySnap = [...subset].filter(k => !live.has(k));
    const onlyEd = [...live].filter(k => !subset.has(k));
    const verdict = onlySnap.length === 0 && onlyEd.length === 0
      ? "IDENTICAL — the snapshot IS this edition"
      : `differs by ${onlySnap.length + onlyEd.length}`;
    console.log(`  ${year}     ${String(shared).padStart(6)}  ${String(onlySnap.length).padStart(13)}  ${String(onlyEd.length).padStart(12)}  ${verdict}`);
    if (onlySnap.length) console.log(`             only-snapshot: ${onlySnap.slice(0, 14).join(" ")}${onlySnap.length > 14 ? " …" : ""}`);
    if (onlyEd.length)   console.log(`             only-edition:  ${onlyEd.slice(0, 14).join(" ")}${onlyEd.length > 14 ? " …" : ""}`);
    if (missingPages)    console.log(`             (${missingPages} subject page(s) absent in this edition)`);
  }
  console.log("\n  Reading it: the snapshot's own edition should appear in NEITHER column as");
  console.log("  a match. If a probed edition comes back IDENTICAL, the label is wrong.");
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const live = await resolveLiveYear();
  console.log(`live edition: ${live}  (read from the page banner, not hardcoded)`);

  const years = (val("--editions")
    ? val("--editions").split(",").map(s => parseInt(s.trim(), 10))
    : [live - 6, live - 4, live - 2, live]).filter(Number.isFinite);

  const slugs = has("--all-subjects")
    ? await allSubjectSlugs(live)
    : (val("--subjects") ? val("--subjects").toLowerCase().split(",").map(s => s.trim()) : SAMPLE_SUBJECTS);

  console.log(`editions: ${years.join(", ")}`);
  console.log(`subjects: ${slugs.length > 12 ? slugs.length + " (all)" : slugs.join(", ")}`);

  if (has("--snapshot")) {
    // `--snapshot` takes an optional path, so a following FLAG is not the value.
    const given = val("--snapshot");
    const path = given && !given.startsWith("--")
      ? given
      : "data/northeastern/catalog/editions/2026/catalog-courses.json";
    await reportSnapshot(path, years, slugs);
  }
  if (has("--course"))   await reportLifespan(val("--course"), years);
  if (has("--fidelity")) await reportFidelity(years, slugs);
  if (has("--drift")) {
    if (years.length < 2) throw new Error("--drift needs at least two --editions");
    for (let i = 0; i < years.length - 1; i++) await reportDrift(years[i], years[i + 1], slugs);
  }
  if (has("--coverage")) reportCoverage(live);
  if (!has("--course") && !has("--fidelity") && !has("--drift") && !has("--snapshot")
      && !has("--coverage")) {
    console.log("\nnothing asked. try --fidelity, --drift, --course CS2500, --snapshot, or --coverage");
  }
}

/**
 * Do we hold the edition NEU is currently publishing?
 *
 * ── The hole this closes ────────────────────────────────────────────
 *
 * `data-staleness.yml` measures the last SUCCESSFUL RUN per pipeline, and that
 * is the right primary signal — CLAUDE.md explains why it is not data age,
 * which would cry wolf on a run that legitimately changed nothing.
 *
 * But it cannot see a run that succeeded and wrote nothing. On 2026-09-01
 * scrape-majors printed "Refusing to write", exited 1, and its step was
 * reported GREEN, because Actions' default shell has no pipefail and the step's
 * status was `tee`'s. The pipefail guard now at the top of every data workflow
 * fixes that going forward — but the damage is already recorded: that run
 * counts as a success, so the 75-day clock restarted on a run that produced
 * nothing, and the majors trees sat two months stale with nothing to say so.
 * They were found by hand, on 2026-09-03, only because someone asked why no
 * course had ever been marked retired.
 *
 * This is the check that would have caught it, and it is deliberately a
 * DIFFERENT KIND of signal rather than a second staleness clock: it compares
 * what NEU is publishing against what is on disk. "We have no program tree for
 * the edition the university is currently teaching" is unambiguous. It cannot
 * cry wolf on a quiet month, because a quiet month does not roll the edition.
 *
 * One HTTP request — the live year is already resolved for every other mode.
 *
 * Exits non-zero when something is missing, so a workflow step can use it.
 */
function reportCoverage(live) {
  const yearsUnder = (dir) => existsSync(dir)
    ? readdirSync(dir).filter(n => /^\d{4}$/.test(n)).map(Number).sort((a, b) => a - b)
    : [];

  // The DIRECTORY is `graduate`. CLAUDE.md's `grad/2026/…` is the program-id
  // prefix a saved plan stores, not the path — reading it as a path made this
  // check report a false "(none)" for the graduate tree the first time it ran.
  const trees = {
    "undergraduate programs": "data/northeastern/programs/undergraduate",
    "graduate programs":      "data/northeastern/programs/graduate",
    "frozen course editions": "data/northeastern/catalog/editions",
  };

  console.log(`\nEDITION COVERAGE — NEU is publishing ${live}\n`);
  const missing = [];
  for (const [label, dir] of Object.entries(trees)) {
    const held = yearsUnder(dir);
    const has  = held.includes(live);
    console.log(`  ${label.padEnd(24)} ${held.length ? held.join(", ") : "(none)"}`
      + `   ${has ? "✓ has " + live : "✗ MISSING " + live}`);
    if (!has) missing.push(label);
  }

  if (!missing.length) {
    console.log(`\n  Every tree carries the live edition.`);
    return;
  }
  console.log(`\n  ::warning::No ${live} data for: ${missing.join("; ")}.`);
  console.log(`  A student entering under the ${live - 1}-${live} catalog has no requirements`);
  console.log(`  of their own year. The pipelines that produce these push straight to main`);
  console.log(`  and refuse to write when a rail trips, so a missing edition means a refusal`);
  console.log(`  nobody answered — check the workflow runs, then re-run with the documented`);
  console.log(`  exit (--accept-shrink for courses; see docs/catalog-editions-design.md).`);
  process.exitCode = 1;
}

/** Every subject slug an edition's index page links to. */
async function allSubjectSlugs(year) {
  const html = await fetchPage(`${BASE}${basePathFor(year)}/course-descriptions/`);
  if (!html) throw new Error(`no course-descriptions index for edition ${year}`);
  const out = new Set();
  for (const a of parseHTML(html).querySelectorAll("a[href]")) {
    const m = (a.getAttribute("href") || "").match(/\/course-descriptions\/([a-z0-9-]+)\/?$/i);
    if (m) out.add(m[1].toLowerCase());
  }
  return [...out].sort();
}

main().catch(e => { console.error(e.message); process.exit(1); });

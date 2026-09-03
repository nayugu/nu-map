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
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "NU-Map-DataBot/1.0 (academic degree planner; contact nayugu@github; respects robots.txt)",
      Accept: "text/html",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
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

  if (has("--course"))   await reportLifespan(val("--course"), years);
  if (has("--fidelity")) await reportFidelity(years, slugs);
  if (has("--drift")) {
    if (years.length < 2) throw new Error("--drift needs at least two --editions");
    for (let i = 0; i < years.length - 1; i++) await reportDrift(years[i], years[i + 1], slugs);
  }
  if (!has("--course") && !has("--fidelity") && !has("--drift")) {
    console.log("\nnothing asked. try --fidelity, --drift, or --course CS2500");
  }
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

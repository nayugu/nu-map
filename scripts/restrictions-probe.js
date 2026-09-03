#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// RESTRICTIONS PROBE — what is actually on Banner's getRestrictions page?
//
// scrape-availability.js has fetched that page once per CRN since Aug 2026, and
// `classesOf` in lib/class-standing.js keeps only the heading matching
// /following Classes:$/. Everything else — Levels, Majors, Colleges, whatever
// else NEU publishes — is parsed and discarded. The HTTP cost is already sunk;
// the loss is a nine-line filter.
//
// It answers two questions, and deliberately no longer more than that:
//
//   1. which restriction KINDS this registrar uses, at what rate, with what
//      code vocabulary — the input to anything that stores or displays them;
//   2. whether `parseRestrictions` actually works on them. It had only ever
//      been exercised against Classes, and a kind rendered with different
//      markup returns {} SILENTLY, which is the worst failure available here:
//      the probe would report that the kind does not exist.
//
// It runs `parseRestrictions` UNCHANGED — the point is to measure the parser we
// have, not a better one — and writes nothing outside the page cache.
//
// ── WHAT WAS REMOVED, and why ──────────────────────────────────────
//
// This file also carried cross-term and within-course stability analysis, a
// stratified sampler and a shared-course-list flow to feed them. All of it was
// built to answer a question nobody asked — whether a restriction could be
// carried forward and gated on — and its headline figure was wrong anyway: it
// compared 202510 against 202530, which are Fall and SPRING, so it measured
// seasonal structure and reported it as instability.
//
// None of those numbers ever changed a line of shipped code. The comma-split
// parser defect, which did, was found by the first 40-page run. Removed rather
// than fixed, because the display stores per-section tallies and reads coverage
// from them directly — it needs no statistics from here.
//
// ── THE CACHE ──────────────────────────────────────────────────────
//
// Pages go to .cache/banner/restrictions/<term>.json.gz (lib/restriction-cache.js),
// shared with the scrape. `--replay` re-runs the analysis with zero Banner
// traffic, which is what makes the next parser question cheap.
//
// ── USAGE ──────────────────────────────────────────────────────────
//
//   node scripts/restrictions-probe.js                  newest completed term
//   node scripts/restrictions-probe.js --term=202530
//   node scripts/restrictions-probe.js --sample=400
//   node scripts/restrictions-probe.js --replay         cache only, no network
//   node scripts/restrictions-probe.js --dump=20        print raw page samples
//
// Exits 0 on a clean run. Exits 3 if a sampled page failed to parse into any
// heading while its raw HTML clearly contained one — failure (2) above, and it
// must be loud.
// ═══════════════════════════════════════════════════════════════════

import { resolve, dirname }                  from "node:path";
import { fileURLToPath }                     from "node:url";

import { parseRestrictions }                 from "./lib/class-standing.js";
import { readTermCache, writeTermCache, cachedTerms, legacyTerms, CACHE_DIR }
                                             from "./lib/restriction-cache.js";
import {
  BASE, getTermList, openTerm, fetchPage, fetchRetry,
  cookieHeader, updateJar, sleep,
} from "./lib/banner-session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, "..");

const DELAY_MS = parseInt(process.env.BANNER_DELAY_MS || "500", 10);
const RESTR_DELAY_MS = parseInt(process.env.BANNER_RESTR_DELAY_MS || "250", 10);

// ── Args ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};
const REPLAY  = !!flag("replay", false);
const SAMPLE  = parseInt(flag("sample", "400"), 10);
const DUMP    = parseInt(flag("dump", "0"), 10);
const TERMS   = String(flag("terms", flag("term", "")) || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// The heading grammar, the code reader and the label reader were prototyped
// here and now live in lib/restrictions.js beside the fold that uses them, so
// the probe and the scrape cannot come to disagree about what a heading means.
//
// Imported AND re-exported, which is not redundant: `export … from` is a
// re-export and does NOT bind the name in this module's scope, so `analyse`
// below threw `splitHeading is not defined` until the import was added.
import { splitHeading, codeOf, labelOf } from "./lib/restrictions.js";
export { splitHeading, codeOf, labelOf, coalesceValues, decodeEntities }
  from "./lib/restrictions.js";

// ── Cache ────────────────────────────────────────────────────────
//
// One gzipped file per term, shared with the scrape — see lib/restriction-cache.js
// for why one file beats one-per-page by 30x on size and 7,400x on inode count.
// The probe wrote its own per-page layout first; that is read transparently and
// folded in by `reparse-restrictions.js --migrate`.
//
// The whole term is held in memory for the run and written once at the end:
// re-serialising a 7,000-entry map per page would be quadratic, and a sampled
// probe run has nothing to gain from an incremental flush.

/** term → { pages, courses }, loaded on first touch. */
const loaded = new Map();

function termCache(term) {
  if (!loaded.has(term)) {
    const c = readTermCache(term);
    loaded.set(term, { pages: { ...(c?.pages ?? {}) }, courses: { ...(c?.courses ?? {}) }, dirty: false });
  }
  return loaded.get(term);
}

const cacheRead   = (term, crn) => termCache(term).pages[crn] ?? null;
const cachedCrns  = (term)      => Object.keys(termCache(term).pages);
const manifestOf  = (term)      => termCache(term).courses;

function cacheStore(term, crn, html, courseId) {
  const c = termCache(term);
  c.pages[crn] = html;
  if (courseId) c.courses[crn] = courseId;
  c.dirty = true;
}

function cacheFlush(term) {
  const c = loaded.get(term);
  if (!c?.dirty) return;
  const n = writeTermCache(term, c.pages, c.courses);
  process.stdout.write(`    cache: ${n.pages} pages, ${n.courses} attributed for ${term}\n`);
  c.dirty = false;
}

// ── Section inventory ────────────────────────────────────────────

/**
 * Paginate a term and return `Map<courseId, string[]>` of CRNs per course.
 * This is the only bulk traffic the probe generates: ~15 pages for a 7.4k
 * section term, about 15 seconds at the default pacing.
 */
async function inventory(termCode) {
  await openTerm(termCode, DELAY_MS);
  const byCourse = new Map();
  let offset = 0, total = null;
  while (true) {
    const data = await fetchPage(termCode, offset);
    if (!data?.success) throw new Error(`searchResults refused for ${termCode}`);
    total ??= data.totalCount;
    const rows = data.data ?? [];
    if (!rows.length) break;
    for (const s of rows) {
      const id = `${(s.subject || "").toUpperCase().trim()}${(s.courseNumber || "").trim()}`;
      if (!id || !s.courseReferenceNumber) continue;
      if (!byCourse.has(id)) byCourse.set(id, []);
      byCourse.get(id).push(String(s.courseReferenceNumber));
    }
    offset += rows.length;
    if (total != null && offset >= total) break;
    await sleep(DELAY_MS);
  }
  if (total === 0) {
    // The documented Banner flake: success:true, totalCount:0 on a term that
    // really has thousands of sections. Refuse rather than report "no data".
    throw new Error(`${termCode} returned totalCount 0 — Banner flake, re-run`);
  }
  return byCourse;
}

/**
 * Choose which CRNs to fetch: a uniform stride over the term's courses, one
 * section each. Deterministic — no RNG, so two runs compare cleanly.
 *
 * Uniform, NOT stratified. An earlier version put half the budget on courses
 * with >= 2 sections so that within-course agreement could be measured; that
 * analysis is gone, and for the prevalence figures this file now reports the
 * stratification was actively wrong. Over-sampling large courses biases every
 * "X% of sections carry this kind" number toward whatever large courses do.
 *
 * One CRN per course rather than per section for the same reason: a 21-section
 * course would otherwise contribute 21 near-identical pages and pull the
 * histogram toward itself.
 */
export function chooseCrns(byCourse, budget) {
  const all = [...byCourse.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const picked = new Map();
  let used = 0;
  const stride = Math.max(1, Math.floor(all.length / Math.max(1, budget)));
  for (let i = 0; i < all.length && used < budget; i += stride) {
    const [id, crns] = all[i];
    if (!crns?.length) continue;
    picked.set(id, [crns[0]]);
    used += 1;
  }
  return { picked, used };
}

// ── Fetch ────────────────────────────────────────────────────────

async function fetchRestrictions(termCode, crn) {
  const res = await fetchRetry(
    `${BASE}/searchResults/getRestrictions?term=${termCode}&courseReferenceNumber=${crn}`,
    { headers: { "Cookie": cookieHeader() } }
  );
  updateJar(res);
  return await res.text();
}

/**
 * Gather `{courseId, crn, html}` for one term, from cache when present.
 * In `--replay` the cache IS the sample — no inventory call, no network.
 */
async function gather(termCode, picked, used) {
  if (REPLAY) {
    const crns = cachedCrns(termCode);
    if (!crns.length) throw new Error(`--replay but nothing cached for ${termCode}`);
    const manifest = manifestOf(termCode);
    const missing = crns.filter(c => !manifest[c]).length;
    if (missing) {
      process.stdout.write(
        `    ${missing} of ${crns.length} cached pages predate the manifest — ` +
        `their course identity is unknown, so they count only toward the kind histogram\n`
      );
    }
    return crns.map(crn => ({ courseId: manifest[crn] ?? null, crn, html: cacheRead(termCode, crn) }));
  }

  const out = [];
  let n = 0;
  for (const [courseId, crns] of picked) {
    for (const crn of crns) {
      let html = cacheRead(termCode, crn);
      if (html == null) {
        html = await fetchRestrictions(termCode, crn);
        await sleep(RESTR_DELAY_MS);
      }
      // Stored even on a cache HIT, because the page may have been captured
      // before the course mapping existed — that is the whole reason 829 of the
      // first run's pages were unattributable.
      cacheStore(termCode, crn, html, courseId);
      out.push({ courseId, crn, html });
      if (++n % 100 === 0) process.stdout.write(`    …${n}/${used}\n`);
    }
  }
  cacheFlush(termCode);
  return out;
}

// ── Analysis ─────────────────────────────────────────────────────

const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "—";

export function analyse(termCode, pages) {
  // Per-kind tallies
  const kinds = new Map();   // "Majors|must" → {pages, values:Map<code,{label,n}>, sizes:[]}
  const perPage = [];        // {courseId, crn, blocks: [{kind, polarity, codes[]}]}
  let withAny = 0, unparsed = 0;
  const unparsedEx = [];
  const unknownHeadings = new Map();

  for (const { courseId, crn, html } of pages) {
    const parsed = parseRestrictions(html);
    const heads = Object.keys(parsed);
    const blocks = [];

    for (const head of heads) {
      const split = splitHeading(head);
      if (!split) { unknownHeadings.set(head, (unknownHeadings.get(head) ?? 0) + 1); continue; }
      const key = `${split.kind}|${split.polarity}`;
      const slot = kinds.get(key) ?? { pages: 0, values: new Map(), sizes: [] };
      slot.pages += 1;
      // Already logical values — parseRestrictions coalesces the comma-split
      // spans now (verified byte-identical for classesOf over 1,027 pages).
      const values = parsed[head];
      slot.sizes.push(values.length);
      const codes = [];
      for (const v of values) {
        const code = codeOf(v) ?? `«${labelOf(v)}»`;
        codes.push(code);
        const rec = slot.values.get(code) ?? { label: labelOf(v), n: 0 };
        rec.n += 1;
        slot.values.set(code, rec);
      }
      kinds.set(key, slot);
      blocks.push({ ...split, codes: codes.sort() });
    }

    if (blocks.length) withAny += 1;

    // (2) the silent-{} check: the raw page clearly carries a heading but the
    // parser produced nothing. This is the failure that would ship in silence.
    const looksLikeHeading = /following\s+[A-Za-z ]+:\s*<\/span>/i.test(html);
    if (looksLikeHeading && !heads.length) {
      unparsed += 1;
      if (unparsedEx.length < 5) unparsedEx.push({ crn, snippet: html.replace(/\s+/g, " ").slice(0, 240) });
    }

    perPage.push({ courseId, crn, blocks });
  }

  return { termCode, pages, kinds, perPage, withAny, unparsed, unparsedEx, unknownHeadings };
}

function reportTerm(a) {
  const n = a.pages.length;
  console.log(`\n══ ${a.termCode} — ${n} sections sampled ══`);
  console.log(`  sections carrying at least one restriction: ${a.withAny} (${pct(a.withAny, n)})`);

  if (!a.kinds.size) { console.log("  NO restriction blocks parsed at all."); return; }

  console.log(`\n  KIND HISTOGRAM  (the question this probe exists for)`);
  const rows = [...a.kinds.entries()].sort((x, y) => y[1].pages - x[1].pages);
  const POL = { must: "must  ", not: "CANNOT", info: "info  " };
  for (const [key, slot] of rows) {
    const [kind, polarity] = key.split("|");
    const sizes = slot.sizes.slice().sort((p, q) => p - q);
    const med = sizes[Math.floor(sizes.length / 2)];
    console.log(
      `    ${POL[polarity] ?? polarity} ${kind.padEnd(18)}` +
      ` ${String(slot.pages).padStart(5)} sections (${pct(slot.pages, n).padStart(6)})` +
      `  ${String(slot.values.size).padStart(4)} distinct codes` +
      `  values/block med ${med}, max ${sizes[sizes.length - 1]}`
    );
  }

  console.log(`\n  CODE VOCABULARY  (is a mapping table feasible?)`);
  for (const [key, slot] of rows) {
    const [kind, polarity] = key.split("|");
    const top = [...slot.values.entries()].sort((x, y) => y[1].n - x[1].n);
    const shown = top.slice(0, 8).map(([c, r]) => `${c}${r.label ? `=${r.label}` : ""}`).join(", ");
    console.log(`    ${kind} (${polarity}): ${slot.values.size} codes — ${shown}${top.length > 8 ? ", …" : ""}`);
  }

  if (a.unknownHeadings.size) {
    console.log(`\n  HEADINGS THE GRAMMAR DID NOT RECOGNISE`);
    for (const [h, c] of [...a.unknownHeadings].sort((x, y) => y[1] - x[1]).slice(0, 10))
      console.log(`    ${c}×  ${JSON.stringify(h)}`);
  }

  if (a.unparsed) {
    console.log(`\n  ⚠ SILENT PARSE FAILURES: ${a.unparsed} pages contain "following …:" but parsed to {}`);
    a.unparsedEx.forEach(e => console.log(`      CRN ${e.crn}: ${e.snippet}`));
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  let terms = TERMS;
  if (!terms.length) {
    if (REPLAY) {
      // Both layouts, so a cache written before the single-file form still replays.
      terms = [...new Set([...cachedTerms(), ...legacyTerms()])].sort();
      if (!terms.length) { console.error("--replay with an empty cache and no --term"); process.exit(1); }
    } else {
      const list = await getTermList(30);
      // Newest term that is plausibly complete: skip the two most recent, which
      // Banner is usually still editing.
      terms = [list.map(t => t.code).sort().reverse()[2]].filter(Boolean);
    }
  }
  console.log(`restrictions-probe — terms ${terms.join(", ")}${REPLAY ? "  (replay, no network)" : ""}`);
  console.log(`cache: ${CACHE_DIR}`);

  const analyses = [];
  for (const t of terms) {
    let picked = new Map(), used = 0;
    if (!REPLAY) {
      process.stdout.write(`  inventory ${t}…\n`);
      const byCourse = await inventory(t);
      ({ picked, used } = chooseCrns(byCourse, SAMPLE));
      process.stdout.write(
        `    ${byCourse.size} courses, ` +
        `${[...byCourse.values()].reduce((a, c) => a + c.length, 0)} sections` +
        ` → sampling ${used} CRNs across ${picked.size} courses\n`
      );
    }
    const pages = await gather(t, picked, used);
    const a = analyse(t, pages);
    reportTerm(a);
    analyses.push(a);
  }

  if (DUMP) {
    console.log(`\n══ RAW PAGES (${DUMP}) ══`);
    const withBlocks = analyses[0].pages.filter(p => /following\s+[A-Za-z ]+:/i.test(p.html));
    for (const p of withBlocks.slice(0, DUMP)) {
      console.log(`\n--- CRN ${p.crn} (${p.courseId ?? "?"}) ---`);
      console.log(p.html.replace(/\s+/g, " ").trim().slice(0, 900));
    }
  }

  const broken = analyses.reduce((s, a) => s + a.unparsed, 0);
  if (broken) {
    console.error(`\nFAILED: ${broken} pages carry a heading the parser did not see.`);
    process.exit(3);
  }
  console.log(`\nOK — ${analyses.reduce((s, a) => s + a.pages.length, 0)} pages, no silent parse failures.`);
}

// Only run when invoked directly — the helpers above are imported by
// test/unit/restrictions-probe.test.js, and firing main() on import would
// mean a unit test hits Banner. Same guard as grad-probe.js:325.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}

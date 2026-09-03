#!/usr/bin/env node
/**
 * scrape-availability.js
 *
 * Queries Northeastern's official Banner SSB system (nubanner.neu.edu) for the
 * last two academic years (~8 terms) to build a per-course offering history.
 *
 * Output 1: public/northeastern/term-history.json  (all queried terms)
 *   {
 *     "CS3500": { "202510": true, "202530": false, "202610": true, ... },
 *     ...
 *   }
 *   true = offered, false = not offered that term.
 *
 * Output 2: public/northeastern/term-details.json  (COMPLETED terms only)
 *   {
 *     "CS3500": {
 *       "202610": { sections, cap, enr, formats[], campuses[], days{pattern:{n,e}}, linked },
 *       ...
 *     }
 *   }
 *   Course-level aggregate across the course's sections: enrollment (cap/enr → fill rate),
 *   instructional formats, campuses, and day-pattern distribution. Each `days` value stores the
 *   raw facts per pattern — n = section count, e = enrolled headcount ({"MWF":{n:9,e:420},...}) —
 *   so the derive step can weight by enrolment (with a section-count fallback) without re-scraping.
 *   Recorded ONLY for terms whose end date has passed, so the numbers are final (nu-map is
 *   stable-only; a running term's seats churn hourly). Waitlist is intentionally omitted —
 *   Northeastern does not expose Banner waitlist capacity/counts (always 0).
 *
 *   With --restrictions, each aggregate also carries `std` (and `stdNot`): a tally of
 *   sections per class-standing gate, {"JR|SR": 24}, from Banner's getRestrictions.
 *   This is the class standing the catalog only ever states in prose — see the
 *   "Class-standing restrictions" section below for why the engine needs it.
 *
 * Keys are Banner term codes (YYYY = AY end year; 10=Fall, 30=Spring,
 * 40=Summer 1, 60=Summer 2).
 *
 * Usage:
 *   node scripts/scrape-availability.js              # dry run — prints summary
 *   node scripts/scrape-availability.js --write      # write both JSON files
 *   node scripts/scrape-availability.js --write --details-only  # write only term-details.json
 *   node scripts/scrape-availability.js --term=202610,202630   # restrict terms (testing)
 *   node scripts/scrape-availability.js --write --restrictions  # + class-standing gates, 1 term
 *
 * Rate limiting: 500 ms between page requests by default.
 * Override: BANNER_DELAY_MS=200 node scripts/scrape-availability.js --write
 * Per-section passes: BANNER_PROF_DELAY_MS, BANNER_RESTR_DELAY_MS (250 ms each).
 *
 * The session flow required by Banner SSB:
 *   1. GET /classSearch/getTerms  →  seed session cookies
 *   2. POST /term/search?mode=search  →  activate session for a specific term
 *   3. POST /classSearch/resetDataForm  →  clear prior search state
 *   4. GET /searchResults/searchResults  →  paginated course sections
 *   Repeat steps 2-4 for each term.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname }                         from "path";
import { fileURLToPath }                            from "url";
import { parseRestrictions, classesOf }             from "./lib/class-standing.js";
import { restrictionsOf, tallySection }             from "./lib/restrictions.js";
import { knownTermCodes, buildTermHistory, mergePreviousHistory }
                                                    from "./lib/term-history.js";
import {
  BASE, PAGE_SIZE, sleep, fetchRetry, cookieHeader, updateJar,
  getTermList, activateTerm, resetForm, fetchPage,
}                                                   from "./lib/banner-session.js";
import { writeTermCache, readTermCache }             from "./lib/restriction-cache.js";

const __dirname      = dirname(fileURLToPath(import.meta.url));
const ROOT           = resolve(__dirname, "..");
const ALL_COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const HISTORY_OUT    = resolve(ROOT, "public/northeastern/term-history.json");
const DETAILS_OUT    = resolve(ROOT, "public/northeastern/term-details.json");
// Restriction code → human label, in its OWN file. term-details.json is a flat
// { courseId: { termCode: … } } map and every consumer iterates its keys as
// course ids, so a root metadata key would be read as a course.
const RESTR_LABELS_OUT = resolve(ROOT, "public/northeastern/restriction-labels.json");
const COLLEGES_OUT   = resolve(ROOT, "public/northeastern/subject-colleges.json");
const CHANGE_LOG     = resolve(ROOT, "public/northeastern/change-log.json");
const CHANGE_LOG_MAX = 600;

const DELAY_MS  = parseInt(process.env.BANNER_DELAY_MS || "500", 10);
// Instructor fetches are one light request per SECTION (Banner strips faculty
// from the bulk search feed), so they get their own, tighter pacing.
const PROF_DELAY_MS = parseInt(process.env.BANNER_PROF_DELAY_MS || "250", 10);
// Class-standing restrictions are the same shape of request — one per section,
// nothing in the bulk feed — so they share the instructor pacing.
const RESTR_DELAY_MS = parseInt(process.env.BANNER_RESTR_DELAY_MS || "250", 10);
// How often the raw-page cache is written during a restrictions pass. 500 is
// ~2 minutes of work at the default pacing, so an interruption costs at most
// that. Measured: a full term gzips to ~200 KB, so 14 flushes per term is a
// few seconds in total — nothing against the 55 minutes of requests.
const RESTR_FLUSH_EVERY = parseInt(process.env.BANNER_RESTR_FLUSH_EVERY || "500", 10);

// ── Term code logic ──────────────────────────────────────────────
// Banner YYYY = AY end year.  Suffixes: 10=Fall, 30=Spring, 40=Sum1, 60=Sum2.
// Fall of AY 2024-25 → code 202510  (YYYY=2025, suffix=10)
// Spring of AY 2024-25 → code 202530 (YYYY=2025, suffix=30)

const STANDARD_SUFFIXES = ["10", "30", "40", "60"];

/**
 * Return Banner term codes for the last `yearsBack` academic years,
 * sorted chronologically (ascending).
 * Today = May 2026 → currentAYEndYear = 2026
 * Returns terms from AY ending 2023 through AY ending 2026.
 */
function recentTermCodes(yearsBack = 3) {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const calYear = now.getFullYear();
  // AY end year: Sep-Dec → next calendar year; Jan-Aug → this calendar year
  const currentAYEnd = month >= 9 ? calYear + 1 : calYear;

  const codes = [];
  for (let ayEnd = currentAYEnd - yearsBack; ayEnd <= currentAYEnd; ayEnd++) {
    for (const suffix of STANDARD_SUFFIXES) {
      codes.push(`${ayEnd}${suffix}`);
    }
  }
  return codes.sort(); // lexicographic = chronological for Banner codes
}

// The Banner SSB session — the cookie jar, the handshake and the paged section
// feed — lives in lib/banner-session.js, shared with restrictions-probe.js.
// It was duplicated here until 2026-09-03; two copies of a stateful handshake
// is how a fix lands in one Banner client and not the other, exactly as a
// byte-identical `scrapeProgram` did across the two program scrapers.

// ── Section-detail helpers ───────────────────────────────────────

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Parse a Banner "MM/DD/YYYY" date into a Date, or null. */
function parseMDY(raw) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((raw || "").trim());
  return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
}

// Banner day flags → single-letter codes (R = Thursday, U = Sunday).
const DAY_KEYS = [
  ["monday", "M"], ["tuesday", "T"], ["wednesday", "W"], ["thursday", "R"],
  ["friday", "F"], ["saturday", "S"], ["sunday", "U"],
];

/** Day pattern ("MWF") for a meetingTime, or "" if it has no fixed days (async/online). */
function dayPattern(mt) {
  if (!mt) return "";
  return DAY_KEYS.filter(([k]) => mt[k]).map(([, c]) => c).join("");
}

/**
 * Fetch a term's offerings plus a per-course section aggregate.
 *
 * Returns:
 *   offered  Set<courseId>                 — courses offered ("CS3500")
 *   detail   Map<courseId, aggregate>      — enrollment/waitlist/format/campus/meeting,
 *                                            summed & unioned across the course's sections
 *   termEnd  Date | null                   — latest section end date seen in the term
 *
 * A course usually has several sections; enrollment/waitlist are summed, while format,
 * campus and meeting pattern are collected as unique sets (a course may run in-person in
 * Boston and online at once). `termEnd` lets the caller keep detail only for terms that have
 * already ended, whose numbers are final — nu-map is stable-only, and a still-running term's
 * seats churn hourly.
 */
/**
 * Fold one Banner section into a part accumulator ({offered, detail, termEnd}).
 * `fullSummer` tags aggregates that received a session-spanning section (the
 * merged summer term's part-of-term "1") — preserved so a future "Full
 * Summer" representation never needs a re-scrape.
 */
function accumulateSection(part, s, { fullSummer = false } = {}) {
  const subject = (s.subject || "").toUpperCase().trim();
  const number  = (s.courseNumber || "").trim();
  if (!subject || !number) return;
  const id = `${subject}${number}`;
  part.offered.add(id);

  const agg = part.detail.get(id) ?? {
    sections: 0, cap: 0, enr: 0,
    formats: new Set(), campuses: new Set(), days: {}, linked: false,
    crns: [], // [crn, enrolled] per section — transient, feeds the instructor pass
  };
  agg.sections += 1;
  agg.cap += num(s.maximumEnrollment);
  agg.enr += num(s.enrollment);
  if (s.courseReferenceNumber) agg.crns.push([s.courseReferenceNumber, num(s.enrollment)]);
  if (fullSummer) agg.fullSummer = true;
  if (s.instructionalMethodDescription) agg.formats.add(s.instructionalMethodDescription.trim());
  if (s.campusDescription)              agg.campuses.add(s.campusDescription.trim());
  if (s.isSectionLinked)                agg.linked = true;

  // Tally each section under its PRIMARY meeting's day pattern (the first meeting is the main
  // class; later ones are recitations/labs that would otherwise dominate). Store BOTH the
  // section count (n) and the enrolled headcount (e) per pattern — the raw facts — so the
  // presentation layer (derive) can weight by enrolment ("where students actually are") yet
  // fall back to section counts when enrolment is missing, all without a re-scrape. Sections
  // with no fixed days (fully async/online) fall under "async".
  let primary = "";
  for (const mf of s.meetingsFaculty ?? []) {
    const p = dayPattern(mf.meetingTime);
    if (p && !primary) primary = p;
    const d = parseMDY(mf.meetingTime?.endDate);
    if (d && (!part.termEnd || d > part.termEnd)) part.termEnd = d;
  }
  const key = primary || "async";
  const slot = (agg.days[key] ??= { n: 0, e: 0 });
  slot.n += 1;                     // sections on this pattern
  slot.e += num(s.enrollment);     // enrolled students on this pattern

  part.detail.set(id, agg);
}

/** Paginate a term's searchResults, feeding each section to `onSection`. */
async function paginateTerm(termCode, onSection) {
  await activateTerm(termCode);
  await sleep(DELAY_MS);
  await resetForm();
  await sleep(DELAY_MS);

  let offset = 0;
  let totalCount = null;
  while (true) {
    let data;
    try {
      data = await fetchPage(termCode, offset);
    } catch (err) {
      console.warn(`  Page fetch failed at offset ${offset}: ${err.message} — stopping`);
      break;
    }
    if (!data.success) {
      console.warn(`  Banner returned success:false for ${termCode} at offset ${offset}`);
      break;
    }
    const sections = data.data ?? [];
    for (const s of sections) onSection(s);
    if (totalCount === null) totalCount = data.totalCount ?? 0;
    if (sections.length === 0 || offset + sections.length >= totalCount) break;
    offset += PAGE_SIZE;
    await sleep(DELAY_MS);
  }
}

async function fetchTermOfferings(termCode) {
  const part = { offered: new Set(), detail: new Map(), termEnd: null };
  await paginateTerm(termCode, (s) => accumulateSection(part, s));
  return part;
}

/**
 * NEU merged the two summer sub-terms into one Banner code from AY2026
 * (e.g. 202650 "Summer 2026 Semester"); the session now lives on each
 * section's partOfTerm: "2A" = Summer 1, "2B" = Summer 2, "1" = full summer
 * (May–Aug, spanning both). Scrape the merged code once and split it back
 * into the synthetic 40/60 term codes everything downstream already
 * understands. Full-summer sections COUNT TOWARD BOTH sessions — a course
 * running May–Aug is genuinely available to someone planning either window —
 * and their aggregates carry a fullSummer tag so the information survives.
 */
async function fetchMergedSummerTerm(termCode) {
  const ay = String(termCode).slice(0, 4);
  const parts = {
    [`${ay}40`]: { offered: new Set(), detail: new Map(), termEnd: null },
    [`${ay}60`]: { offered: new Set(), detail: new Map(), termEnd: null },
  };
  await paginateTerm(termCode, (s) => {
    const pot = (s.partOfTerm ?? "").trim();
    if (pot === "2A")      accumulateSection(parts[`${ay}40`], s);
    else if (pot === "2B") accumulateSection(parts[`${ay}60`], s);
    else if (pot === "1") {
      accumulateSection(parts[`${ay}40`], s, { fullSummer: true });
      accumulateSection(parts[`${ay}60`], s, { fullSummer: true });
    }
    // Other part-of-term values (rare, e.g. "3C") have no session mapping — skipped.
  });
  return parts;
}

/** Serialize a per-course aggregate to the compact stored form (Sets → sorted arrays). */
function serializeDetail(agg) {
  return {
    sections: agg.sections,
    cap: agg.cap, enr: agg.enr,
    formats:  [...agg.formats].sort(),
    campuses: [...agg.campuses].sort(),
    days: agg.days,
    linked: agg.linked,
    ...(agg.fullSummer && { fullSummer: true }),
    ...(agg.prof && { prof: agg.prof }),
    ...(agg.std && { std: agg.std }),
    ...(agg.stdNot && { stdNot: agg.stdNot }),
    // The whole Restrictions pane, per-section tally per kind. `std`/`stdNot`
    // stay alongside rather than being derived from this: they are the one kind
    // the engine gates on, and re-pointing a shipped gate at a new shape would
    // risk a live behaviour change for no benefit.
    ...(agg.restr && { restr: agg.restr }),
  };
}

// ── Instructors ──────────────────────────────────────────────────

// Named HTML entities seen in people's names: punctuation + the Latin-1
// accent set (Muñoz, Théberge, Böhm, …). Numeric forms are decoded
// generically below; this map only has to cover the named spellings.
const NAMED_ENTITIES = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  // Latin-1 punctuation — appears when mojibake bytes get HTML-escaped
  // (observed: "ZoÃ&laquo;" = double-encoded "Zoë"); decode first, then
  // fixMojibake repairs the byte damage.
  laquo: "«", raquo: "»", middot: "·", deg: "°", acute: "´", uml: "¨",
  cedil: "¸", macr: "¯", ordf: "ª", ordm: "º", sup1: "¹", sup2: "²", sup3: "³",
  aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
  ccedil: "ç", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
  iacute: "í", igrave: "ì", icirc: "î", iuml: "ï", ntilde: "ñ",
  oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü", yacute: "ý", yuml: "ÿ", szlig: "ß",
  Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ",
  Ccedil: "Ç", Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë",
  Iacute: "Í", Igrave: "Ì", Icirc: "Î", Iuml: "Ï", Ntilde: "Ñ",
  Oacute: "Ó", Ograve: "Ò", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  Uacute: "Ú", Ugrave: "Ù", Ucirc: "Û", Uuml: "Ü", Yacute: "Ý",
};

/** Decode the HTML entities Banner embeds in names ("O&#39;Kelly" → "O'Kelly", "Mu&ntilde;oz" → "Muñoz"). */
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g,         (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([A-Za-z]+);/g,    (m, name) => NAMED_ENTITIES[name] ?? m);
}

/**
 * Repair UTF-8 read as Latin-1 ("ZoÃ«" → "Zoë") — Banner double-encodes the
 * occasional name. Only fires on the telltale Ã/Â + continuation-byte pair,
 * and keeps the original if reinterpreting produces replacement chars.
 */
function fixMojibake(s) {
  if (!/[\u00C2\u00C3][\u0080-\u00FF]/.test(s)) return s;
  try {
    const repaired = Buffer.from(s, "latin1").toString("utf8");
    return repaired.includes("�") ? s : repaired;
  } catch { return s; }
}

/** Banner's "O&#39;Kelly, Peggy" → display form "Peggy O'Kelly". */
function flipName(displayName) {
  const name = fixMojibake(decodeEntities(displayName || "")).trim();
  const i = name.indexOf(",");
  if (i === -1) return name;
  const last  = name.slice(0, i).trim();
  const first = name.slice(i + 1).trim();
  return first ? `${first} ${last}` : last;
}

/**
 * Fetch PRIMARY instructors for every section of every course in `detail`
 * via getFacultyMeetingTimes — one call per CRN, the only place NEU's Banner
 * exposes faculty (the bulk search feed returns an empty faculty array).
 * Mutates each aggregate: agg.prof = [[name, sections, enrolled], …] sorted
 * by enrolment. Names are deduped within a section (Banner repeats the
 * instructor per meeting block).
 *
 * Only run this for COMPLETED terms: assignments are final, so each term is
 * fetched once ever and then carried forward from the previous file.
 */
async function fetchTermProfessors(termCode, detail) {
  await fetchRetry(`${BASE}/term/search?mode=search`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader() },
    body:    `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  await sleep(DELAY_MS);
  let calls = 0;
  let consecutiveFailures = 0;
  for (const agg of detail.values()) {
    const tally = new Map(); // name → { n: sections, e: enrolled }
    for (const [crn, enr] of agg.crns ?? []) {
      try {
        const res = await fetchRetry(
          `${BASE}/searchResults/getFacultyMeetingTimes?term=${termCode}&courseReferenceNumber=${crn}`,
          { headers: { "Cookie": cookieHeader() } }
        );
        updateJar(res);
        const j = await res.json();
        const names = new Set();
        for (const block of j?.fmt ?? []) {
          for (const f of block.faculty ?? []) {
            if (f.primaryIndicator && f.displayName) names.add(flipName(f.displayName));
          }
        }
        for (const name of names) {
          const slot = tally.get(name) ?? { n: 0, e: 0 };
          slot.n += 1;
          slot.e += enr;
          tally.set(name, slot);
        }
        consecutiveFailures = 0;
      } catch {
        // One section failing must not kill the term — but a long streak
        // means Banner has stopped talking to us: leave NO partial data
        // (a term with prof marks is treated as complete forever after).
        consecutiveFailures += 1;
        if (consecutiveFailures >= 25) {
          for (const a of detail.values()) delete a.prof;
          throw new Error(`aborted after ${consecutiveFailures} consecutive failures (${calls} calls in) — no partial data kept`);
        }
      }
      calls += 1;
      if (calls % 1000 === 0) process.stdout.write(`    …${calls} sections\n`);
      await sleep(PROF_DELAY_MS);
    }
    if (tally.size) {
      agg.prof = [...tally.entries()]
        .map(([name, { n, e }]) => [name, n, e])
        .sort((a, b) => b[2] - a[2] || b[1] - a[1]);
    }
  }
  return calls;
}

// ── Class-standing restrictions ──────────────────────────────────
//
// "Must be enrolled in one of the following Classes: Junior (JR), Senior(SR)" —
// the gate the catalog only ever states in prose, which `RESTRICTION_ONLY` in
// courseNorm.js discards. Parsing, the measured prevalence and the fold rules all
// live in scripts/lib/class-standing.js; this file only captures.
//
// Stored as a section tally per value set — `std: {"JR|SR": 24}` — exactly like
// `days`, and for the same reason: the fold is a presentation decision, and burying
// it here would cost a 29-minute re-scrape per term to revisit. PJM 4850 is gated on
// 1 of its 2 sections and BIOL 4701 carries two different gates across its 7;
// neither fact survives a fold done at capture time.
//
// NOT merged into the instructor walk. Both passes are one call per CRN, so running
// them together saves only the term activation and cooldown, not a single request —
// and it would couple two independently-cached datasets.

/**
 * Fetch class-standing restrictions for every section of every course in `detail`
 * via getRestrictions — one call per CRN. Mutates each aggregate:
 *   agg.std    = { "JR|SR": sections, … }   must be enrolled in
 *   agg.stdNot = { "FR": sections, … }      cannot be enrolled in
 * Absent when the course's sections carry no Classes restriction at all.
 *
 * Only run this for COMPLETED terms, same as the instructor pass: a published
 * term's sections are still being edited, while a finished term is frozen, so it
 * is fetched once ever and carried forward. A capstone's gate does not move
 * year to year, which is what makes the older term an acceptable source.
 */
/**
 * @param {string} termCode  the term to ASK Banner about — for a merged summer
 *   this is the real `…50` code, not the synthetic 40/60 one.
 * @param {Map} detail
 * @param {string} [cacheKey]  the term the pages are FILED under. Must be the
 *   code `term-details.json` uses, or reparse-restrictions.js cannot match a
 *   cached page to the course-term it belongs to and the whole capture is
 *   unusable for precisely the merged summer terms.
 */
async function fetchTermRestrictions(termCode, detail, cacheKey = termCode) {
  await fetchRetry(`${BASE}/term/search?mode=search`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader() },
    body:    `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  await sleep(DELAY_MS);
  let calls = 0;
  let gated = 0;
  let consecutiveFailures = 0;

  // Every page is kept verbatim so a later parser change costs a re-parse
  // instead of another 30 minutes per term (reparse-restrictions.js). Held in
  // memory and written ONCE per term: writing per page would re-serialise the
  // whole map 7,400 times. The course id travels with it because both questions
  // the cache exists to answer — do a course's sections agree, does its gate
  // hold across terms — are per-course, and a CRN alone cannot say.
  const rawPages   = {};
  const crnToCourse = {};

  // ── RESUMING AN INTERRUPTED CAPTURE ────────────────────────────
  //
  // A term is ~7,000 requests and ~55 minutes, so an interruption is normal
  // rather than exceptional — a closed laptop, a dropped connection, a Ctrl-C.
  // Two things make that survivable, and neither was true before:
  //
  //   · the cache is flushed every RESTR_FLUSH_EVERY pages, not only in the
  //     `finally` below. A `finally` does not run when the PROCESS is killed,
  //     so a kill used to discard the whole term;
  //   · `--resume` skips CRNs already cached for this term.
  //
  // `--resume` is OPT-IN, and must stay that way. The scrape otherwise writes
  // the cache and never reads it, so that a live run always sees what Banner
  // says today and a stale cache can never quietly become the source. Resuming
  // trades that for progress, which is correct for a backfill of terms that
  // ended years ago and wrong for the monthly job.
  const resuming = process.argv.includes("--resume");
  // The cached pages are re-PARSED rather than merely counted: the derived
  // `std`/`restr` for a course are folded from all of its sections, so a course
  // half of whose sections came from the cache would otherwise be folded from
  // the other half alone — a false gate, the one failure that can refuse a plan.
  const resumedPages = resuming ? (readTermCache(cacheKey)?.pages ?? {}) : {};
  const alreadyCached = new Set(Object.keys(resumedPages));
  if (resuming && alreadyCached.size) {
    console.log(`  --resume: ${alreadyCached.size} sections already cached for ${cacheKey}, re-parsing those and fetching the rest`);
  }
  let skipped = 0;
  // Labels for every code seen this term, collected once rather than repeated
  // per course-term: a 115-code Majors vocabulary inlined everywhere is how an
  // 8.7 MB file stops being readable. Written at the root of term-details.
  const restrLabels = {};

  const flushCache = (quiet = false) => {
    if (!Object.keys(rawPages).length) return;
    try {
      const n = writeTermCache(cacheKey, rawPages, crnToCourse);
      process.stdout.write(`    cached ${Object.keys(rawPages).length} raw pages (${n.pages} total for ${cacheKey})\n`);
    } catch (err) {
      // The cache is an optimisation, never the data. A disk problem here must
      // not lose a 30-minute scrape.
      if (!quiet) console.warn(`    could not write page cache: ${err.message}`);
    }
  };

  try {
    for (const [courseId, agg] of detail.entries()) {
      const must = new Map();
      const not  = new Map();
      const restr = {};                 // "must:Majors" → { "IEBA|IECS|INDE": 2 }
      for (const [crn] of agg.crns ?? []) {
        // Already captured on an earlier, interrupted run.
        if (alreadyCached.has(String(crn))) {
          const prior = resumedPages[String(crn)];
          if (prior != null) {
            rawPages[String(crn)]    = prior;
            crnToCourse[String(crn)] = courseId;
            const parsed = parseRestrictions(prior);
            const { blocks, labels } = restrictionsOf(parsed);
            tallySection(blocks, restr);
            Object.assign(restrLabels, labels);
            const { must: mk, not: nk } = classesOf(parsed);
            if (mk) { must.set(mk, (must.get(mk) ?? 0) + 1); gated += 1; }
            if (nk) { not.set(nk, (not.get(nk) ?? 0) + 1); }
          }
          skipped += 1;
          continue;
        }
        try {
          const res = await fetchRetry(
            `${BASE}/searchResults/getRestrictions?term=${termCode}&courseReferenceNumber=${crn}`,
            { headers: { "Cookie": cookieHeader() } }
          );
          updateJar(res);
          const html = await res.text();
          rawPages[crn]    = html;
          crnToCourse[crn] = courseId;
          const parsed = parseRestrictions(html);
          // The WHOLE pane, tallied per section exactly like `days` and `std`.
          // `std` stays beside it untouched: it is the one kind the engine
          // already gates on, and re-deriving it from `restr` would couple a
          // shipped gate to a new shape for no gain.
          const { blocks, labels } = restrictionsOf(parsed);
          tallySection(blocks, restr);
          Object.assign(restrLabels, labels);
          const { must: mk, not: nk } = classesOf(parsed);
          if (mk) { must.set(mk, (must.get(mk) ?? 0) + 1); gated += 1; }
          if (nk) { not.set(nk, (not.get(nk) ?? 0) + 1); }
          consecutiveFailures = 0;
        } catch {
          // Same rule as the instructor pass: one section failing must not kill the
          // term, but a long streak means Banner has stopped talking to us. A term
          // with restriction marks is treated as complete forever after, so partial
          // data would permanently understate the gates — leave NONE.
          consecutiveFailures += 1;
          if (consecutiveFailures >= 25) {
            for (const a of detail.values()) { delete a.std; delete a.stdNot; }
            throw new Error(`aborted after ${consecutiveFailures} consecutive failures (${calls} calls in) — no partial data kept`);
          }
        }
        calls += 1;
        if (calls % 1000 === 0) process.stdout.write(`    …${calls} sections\n`);
        // Durable progress. Without this a Ctrl-C or a closed laptop discarded
        // the whole term, because the `finally` below does not run when the
        // process is killed. `writeTermCache` merges and renames atomically, so
        // a flush can never leave the cache worse than it was.
        if (calls % RESTR_FLUSH_EVERY === 0) flushCache(true);
        await sleep(RESTR_DELAY_MS);
      }
      if (must.size) agg.std    = Object.fromEntries([...must].sort());
      if (not.size)  agg.stdNot = Object.fromEntries([...not].sort());
      if (Object.keys(restr).length) agg.restr = restr;
    }
    if (skipped) console.log(`  --resume: reused ${skipped} cached sections, fetched ${calls}`);
  } finally {
    // Kept even on the abort path. Discarding the DERIVED gates is required —
    // a partial fold understates them permanently — but the raw pages are still
    // exactly what Banner said, and keeping them makes the retry cheaper.
    flushCache();
  }
  return { calls, gated, labels: restrLabels };
}

/**
 * Fetch the set of subject codes offered by a given college in a term.
 * Uses Banner's college filter (txt_college) to get only that college's sections.
 */
async function fetchCollegeSubjects(termCode, collegeCode) {
  await activateTerm(termCode);
  await sleep(DELAY_MS);
  await resetForm();
  await sleep(DELAY_MS);

  const subjects = new Set();
  let offset = 0;
  let totalCount = null;

  while (true) {
    const url = `${BASE}/searchResults/searchResults` +
      `?txt_term=${termCode}&txt_college=${encodeURIComponent(collegeCode)}` +
      `&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}&sortColumn=subjectDescription&sortDirection=asc`;
    let data;
    try {
      const res = await fetch(url, { headers: { "Cookie": cookieHeader() } });
      updateJar(res);
      data = await res.json();
    } catch (err) {
      console.warn(`  College fetch failed at offset ${offset}: ${err.message} — stopping`);
      break;
    }
    if (!data.success) break;
    const sections = data.data ?? [];
    for (const s of sections) {
      const subject = (s.subject || "").toUpperCase().trim();
      if (subject) subjects.add(subject);
    }
    if (totalCount === null) totalCount = data.totalCount ?? 0;
    if (sections.length === 0 || offset + sections.length >= totalCount) break;
    offset += PAGE_SIZE;
    await sleep(DELAY_MS);
  }

  return subjects;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const doWrite = process.argv.includes("--write");
  // --details-only: write just term-details.json, leaving the existing term-history.json /
  // subject-colleges.json untouched (isolates the enrollment/format/meeting capture).
  const detailsOnly = process.argv.includes("--details-only");
  // --prof[=N]: fetch primary instructors for up to N completed terms that don't
  // have them yet (newest first, one getFacultyMeetingTimes call per section —
  // expensive, hence the cap; default 1 term per run). Completed terms never
  // change, so instructor data is fetched once ever and carried forward.
  const profArg = process.argv.find(a => a === "--prof" || a.startsWith("--prof="));
  const profTermLimit = profArg
    ? (profArg.includes("=") ? Math.max(0, parseInt(profArg.split("=")[1], 10) || 0) : 1)
    : 0;
  // --restrictions[=N]: same shape and cost as --prof (one getRestrictions call per
  // section, ~29 min a term), capped and cached the same way.
  const restrArg = process.argv.find(a => a === "--restrictions" || a.startsWith("--restrictions="));
  const restrTermLimit = restrArg
    ? (restrArg.includes("=") ? Math.max(0, parseInt(restrArg.split("=")[1], 10) || 0) : 1)
    : 0;

  // Load catalog so we only track courses the app knows about
  if (!existsSync(ALL_COURSES)) {
    console.error(`Catalog not found: ${ALL_COURSES}`);
    process.exit(1);
  }
  const catalog = JSON.parse(readFileSync(ALL_COURSES, "utf8"));
  const catalogIds = new Set(
    catalog
      .filter(c => c.subject && c.number)
      .map(c => `${c.subject.toUpperCase().trim()}${c.number.trim()}`)
  );
  console.log(`Catalog: ${catalogIds.size} courses`);

  // Seed session cookies + fetch real term list from Banner
  console.log("\nFetching term list from Banner...");
  const termList = await getTermList(40);
  const bannerTermCodes = new Set(termList.map(t => t.code));
  console.log(`Banner has ${bannerTermCodes.size} terms available`);

  // Determine which standard terms to query (last 3 AYs, standard suffixes only).
  // --term=CODE[,CODE] restricts the run — handy for testing a single term.
  const termArgs = process.argv
    .filter(a => a.startsWith("--term="))
    .flatMap(a => a.slice("--term=".length).split(","))
    .filter(Boolean);
  const desired = termArgs.length ? termArgs : recentTermCodes(3);

  // Merged-summer detection (AY2026+): the 40/60 codes are gone and a single
  // …50 code carries both sessions (split back apart via partOfTerm below).
  // Guard on 40 being absent: e.g. 202550 "Summer Full 2025" coexists WITH
  // real 40/60 codes and must NOT be treated as a merged term.
  const mergedCodes = [];
  for (const ay of new Set(desired.map(c => String(c).slice(0, 4)))) {
    if (!bannerTermCodes.has(`${ay}40`) && !bannerTermCodes.has(`${ay}60`) && bannerTermCodes.has(`${ay}50`)) {
      mergedCodes.push(`${ay}50`);
    }
  }

  const toQuery = desired.filter(code => bannerTermCodes.has(code) && !mergedCodes.includes(code));

  if (toQuery.length === 0 && mergedCodes.length === 0) {
    console.error("No matching terms found in Banner. Check term code logic.");
    process.exit(1);
  }

  console.log(`\nQuerying ${toQuery.length} terms${mergedCodes.length ? ` + ${mergedCodes.length} merged summer` : ""}:`);
  for (const code of [...toQuery, ...mergedCodes]) {
    const meta = termList.find(t => t.code === code);
    console.log(`  ${code}  ${meta?.description ?? "(no description)"}`);
  }

  // Query each term
  const termResults = {}; // termCode → Set<courseId>
  const termDetail  = {}; // termCode → Map<courseId, aggregate>
  const termEndByCode = {}; // termCode → Date | null (latest section end date)
  for (const termCode of toQuery) {
    const meta = termList.find(t => t.code === termCode);
    process.stdout.write(`\n[${termCode}] ${meta?.description ?? ""} — `);
    try {
      const { offered, detail, termEnd } = await fetchTermOfferings(termCode);
      // A term that yields NO sections is not evidence that nothing was offered.
      // Banner intermittently answers the first page with success:true, totalCount:0
      // — observed twice in a row on 202530, which really has 6,699 sections — and
      // the old code stored the empty set, so every course in the term was written
      // `false`: a wiped semester of real offering history, silently, on a job that
      // pushes to main unattended. Recording NOTHING leaves the term unknown, which
      // is the honest reading and what the history builder now skips.
      if (offered.size === 0) {
        console.log(`NO SECTIONS — treating as unknown, not as "nothing offered"`);
      } else {
        termResults[termCode]   = offered;
        termDetail[termCode]    = detail;
        termEndByCode[termCode] = termEnd;
        const ended = termEnd && termEnd < new Date();
        console.log(`${offered.size} courses${ended ? " (ended — detail kept)" : " (in progress — detail skipped)"}`);
      }
    } catch (err) {
      // Leave the term absent for the same reason — a thrown fetch says nothing
      // about what was offered.
      console.warn(`FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  // Merged summer terms: scrape once, split by part-of-term into the
  // synthetic 40/60 codes (see fetchMergedSummerTerm). The synthetic codes
  // join everything downstream exactly like real terms; bannerCodeOf maps
  // them back for the requests that need a real Banner term (instructors).
  const syntheticCodes = [];
  const bannerCodeOf   = {};
  for (const mcode of mergedCodes) {
    const meta = termList.find(t => t.code === mcode);
    process.stdout.write(`\n[${mcode}] ${meta?.description ?? ""} — splitting by session — `);
    try {
      const parts = await fetchMergedSummerTerm(mcode);
      for (const [syn, part] of Object.entries(parts)) {
        termResults[syn]   = part.offered;
        termDetail[syn]    = part.detail;
        termEndByCode[syn] = part.termEnd;
        bannerCodeOf[syn]  = mcode;
        syntheticCodes.push(syn);
      }
      console.log(Object.entries(parts).map(([syn, p]) => `${syn}: ${p.offered.size} courses`).join("  |  "));
    } catch (err) {
      console.warn(`FAILED: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }
  const allCodes = [...toQuery, ...syntheticCodes];
  // Terms that actually returned sections. Everything that writes a per-term VERDICT
  // ("offered" / "not offered") must range over these, never over allCodes: a term we
  // failed to read is unknown, and `false` is a claim we have no evidence for.
  // Rationale and the observed failure: scripts/lib/term-history.js.
  const knownCodes = knownTermCodes(allCodes, termResults);
  if (knownCodes.length < allCodes.length) {
    console.warn(`\n⚠ ${allCodes.length - knownCodes.length} term(s) returned no sections and are left UNKNOWN: ` +
      allCodes.filter(c => !knownCodes.includes(c)).join(", "));
  }

  // Build subject→college map using Banner's college filter.
  // Uses the most recent successfully-queried term.
  const subjectColleges = {};
  const recentTerm = [...toQuery].reverse().find(c => (termResults[c]?.size ?? 0) > 0);
  if (recentTerm && !termArgs.length && !detailsOnly) { // skip the expensive college map in --term/--details-only mode
    console.log(`\nFetching college→subject map from term ${recentTerm}...`);
    try {
      // Fetch all college codes from Banner, then map subjects per college
      const collegeList = await (await fetch(
        `${BASE}/classSearch/get_college?searchTerm=&term=${recentTerm}&offset=1&max=50`,
        { headers: { "Cookie": cookieHeader() } }
      )).json();
      for (const { code } of collegeList) {
        const subs = await fetchCollegeSubjects(recentTerm, code);
        for (const sub of subs) {
          if (!subjectColleges[sub]) subjectColleges[sub] = code;
        }
        await sleep(DELAY_MS);
      }
      console.log(`  Mapped ${Object.keys(subjectColleges).length} subjects across ${collegeList.length} colleges`);
    } catch (err) {
      console.warn(`  College map fetch failed: ${err.message}`);
    }
  }

  // Build term-history: only for courses in our catalog, only for known terms.
  let termHistory = buildTermHistory(catalogIds, termResults, knownCodes);
  // A --term-restricted run must not wipe the other terms' history — and neither
  // must a term that came back empty.
  if (termArgs.length && !detailsOnly && existsSync(HISTORY_OUT)) {
    try {
      const prevHist = JSON.parse(readFileSync(HISTORY_OUT, "utf8"));
      termHistory = mergePreviousHistory(termHistory, prevHist, knownCodes);
    } catch {}
  }

  // Build term-details: enrollment/format/campus/meeting aggregate, ONLY for terms whose end
  // date has passed (final, stable numbers) and only for catalog courses.
  const now = new Date();
  const completedTerms = knownCodes.filter(c => termEndByCode[c] && termEndByCode[c] < now);

  // Previous file: source for carrying forward instructor data (fetched once per
  // completed term, ever) and for preserving terms outside a --term test window.
  let prevDetails = {};
  if (existsSync(DETAILS_OUT)) {
    try { prevDetails = JSON.parse(readFileSync(DETAILS_OUT, "utf8")); } catch {}
  }
  const termsWithProf = new Set();
  // A course with no class restriction has no `std` key at all — 79% of sections —
  // so presence-on-a-course cannot mark a term done. Presence ANYWHERE in the term
  // can: a scraped term yields hundreds of gated courses, and a term with none would
  // mean Banner published no restriction at all that semester.
  //
  // The restriction marker is `restr`, NOT `std`: terms scraped before the
  // whole pane was captured carry `std` and hold only the `Classes` heading, so
  // treating `std` as "done" would leave them permanently missing Majors,
  // Colleges and the rest.
  //
  // And it is a COVERAGE test, not a presence test. `reparse-restrictions.js`
  // can legitimately write `restr` for a subset of a term — the courses whose
  // sections are wholly in the page cache — and a presence test then reads that
  // term as finished. Measured: 202510 had `restr` on 263 of its 2,455 courses
  // (10.7%) after a re-parse from a sampled cache, which would have pinned it
  // at 19% page coverage forever.
  //
  // 90% is safe because 99% of sections carry at least one restriction (almost
  // always `Levels`), so a fully captured term reaches essentially 100% —
  // 202460 measured 368 of 369 courses. A term below the threshold is read as
  // partially captured and re-read in full.
  const RESTR_DONE_SHARE = 0.9;
  const termsWithRestr = new Set();
  const restrSeen = {};   // termCode → { withRestr, courses }
  for (const byTerm of Object.values(prevDetails)) {
    for (const [tc, d] of Object.entries(byTerm)) {
      if (d.prof) termsWithProf.add(tc);
      const slot = (restrSeen[tc] ??= { withRestr: 0, courses: 0 });
      slot.courses += 1;
      if (d.restr) slot.withRestr += 1;
    }
  }
  for (const [tc, { withRestr, courses }] of Object.entries(restrSeen)) {
    if (courses > 0 && withRestr / courses >= RESTR_DONE_SHARE) termsWithRestr.add(tc);
    else if (withRestr > 0) {
      console.log(`[${tc}] restrictions only ${withRestr}/${courses} courses ` +
        `(${(100 * withRestr / courses).toFixed(1)}%) — treating as INCOMPLETE, will re-read`);
    }
  }
  // Accumulated across every term read this run, then merged over the previous
  // file so a run that touches one term does not drop the other terms' labels.
  const allRestrLabels = {};

  // Instructor pass: newest completed terms that don't have prof data yet, capped per run.
  const profTargets = [...completedTerms]
    .filter(tc => !termsWithProf.has(tc))
    .sort()
    .reverse()
    .slice(0, profTermLimit);
  for (const termCode of profTargets) {
    const sections = [...(termDetail[termCode] ?? new Map()).values()]
      .reduce((s, a) => s + (a.crns?.length ?? 0), 0);
    console.log(`\n[${termCode}] fetching instructors for ${sections} sections (~${Math.round(sections * PROF_DELAY_MS / 60000)} min)…`);
    try {
      // Synthetic summer codes must talk to Banner via their real merged term.
      const calls = await fetchTermProfessors(bannerCodeOf[termCode] ?? termCode, termDetail[termCode] ?? new Map());
      console.log(`  done (${calls} section lookups)`);
    } catch (err) {
      console.warn(`  instructor fetch FAILED: ${err.message}`);
    }
    // Cooldown between terms — sustained volume is what trips Banner's limiter.
    await sleep(30_000);
  }

  // Restriction pass: newest completed terms without restriction data, capped per run.
  const restrTargets = [...completedTerms]
    .filter(tc => !termsWithRestr.has(tc))
    .sort()
    .reverse()
    .slice(0, restrTermLimit);
  for (const termCode of restrTargets) {
    const sections = [...(termDetail[termCode] ?? new Map()).values()]
      .reduce((s, a) => s + (a.crns?.length ?? 0), 0);
    // Delay PLUS round-trip: Banner answers getRestrictions in ~240 ms, so counting
    // only the pacing delay halves the estimate (6,699 sections read "28 min" and
    // took nearly an hour). The workflow log is the only place anyone sees this.
    const perCall = RESTR_DELAY_MS + 240;
    console.log(`\n[${termCode}] fetching class restrictions for ${sections} sections (~${Math.round(sections * perCall / 60000)} min)…`);
    try {
      // Synthetic summer codes must talk to Banner via their real merged term.
      // Ask Banner under the real code; FILE the pages under the code
      // term-details uses, which for a merged summer is the synthetic one.
      const { calls, gated, labels } = await fetchTermRestrictions(
        bannerCodeOf[termCode] ?? termCode, termDetail[termCode] ?? new Map(), termCode);
      Object.assign(allRestrLabels, labels ?? {});
      const pct = calls ? (100 * gated / calls).toFixed(1) : "0.0";
      console.log(`  done (${calls} section lookups, ${gated} class-gated — ${pct}%)`);
    } catch (err) {
      console.warn(`  restriction fetch FAILED: ${err.message}`);
    }
    await sleep(30_000);
  }

  const termDetails = {};
  for (const termCode of completedTerms) {
    for (const [courseId, agg] of (termDetail[termCode] ?? new Map())) {
      if (!catalogIds.has(courseId)) continue;
      const entry = serializeDetail(agg);
      // Carry instructor history forward for terms not (re)fetched this run.
      if (!entry.prof) {
        const prev = prevDetails[courseId]?.[termCode]?.prof;
        if (prev) entry.prof = prev;
      }
      // Restrictions carry forward on whether the TERM was fetched, not on whether
      // this course has a `std` key: absence is the normal case (79% of sections are
      // ungated), so `!entry.std` cannot distinguish "no gate" from "not looked up"
      // and would overwrite a real gate with silence on every subsequent run.
      if (!restrTargets.includes(termCode)) {
        const prev = prevDetails[courseId]?.[termCode];
        if (prev?.std)    entry.std    = prev.std;
        if (prev?.stdNot) entry.stdNot = prev.stdNot;
      }
      (termDetails[courseId] ??= {})[termCode] = entry;
    }
  }
  // A --term-restricted run must not wipe the other terms from the file.
  if (termArgs.length) {
    for (const [courseId, byTerm] of Object.entries(prevDetails)) {
      for (const [tc, d] of Object.entries(byTerm)) {
        // knownCodes for the same reason as the history carry-forward: a term we
        // could not read must keep the detail it already had, not lose it.
        if (!knownCodes.includes(tc)) ((termDetails[courseId] ??= {})[tc] ??= d);
      }
    }
  }

  // Summary
  const covered = Object.keys(termHistory).length;
  const total   = catalogIds.size;
  const uncovered = total - covered;
  console.log(`\n── Summary ──────────────────────────────────────`);
  console.log(`Terms queried: ${allCodes.length}`);
  console.log(`Courses with history: ${covered} / ${total}`);
  if (uncovered > 0) {
    console.log(`Courses with no Banner history (catalog-only): ${uncovered}`);
  }

  // Per-term offering counts
  for (const termCode of allCodes) {
    const meta    = termList.find(t => t.code === (bannerCodeOf[termCode] ?? termCode));
    const count   = termResults[termCode]?.size ?? 0;
    const matched = Object.values(termHistory).filter(h => h[termCode]).length;
    console.log(`  ${termCode}  ${(meta?.description ?? "").padEnd(28)}  ${count} Banner sections  /  ${matched} in catalog`);
  }

  console.log(`\nCompleted terms with detail: ${completedTerms.length} (${completedTerms.join(", ") || "none"})`);
  console.log(`Courses with detail: ${Object.keys(termDetails).length}`);
  for (const cid of ["CS3500", "CS2500", "MATH1341", "ENGW1111"]) {
    if (termDetails[cid]) console.log(`  sample ${cid}: ${JSON.stringify(termDetails[cid])}`);
  }

  if (doWrite) {
    if (!detailsOnly) {
      writeFileSync(HISTORY_OUT, JSON.stringify(termHistory, null, 2));
      console.log(`\nWrote ${HISTORY_OUT}`);
    }

    writeFileSync(DETAILS_OUT, JSON.stringify(termDetails, null, 2));
    console.log(`Wrote ${DETAILS_OUT} (${Object.keys(termDetails).length} courses)`);
    if (Object.keys(allRestrLabels).length) {
      let prevLabels = {};
      if (existsSync(RESTR_LABELS_OUT)) {
        try { prevLabels = JSON.parse(readFileSync(RESTR_LABELS_OUT, "utf8")); } catch {}
      }
      const merged = { ...prevLabels, ...allRestrLabels };
      writeFileSync(RESTR_LABELS_OUT, JSON.stringify(merged, null, 1) + "\n");
      console.log(`Wrote ${RESTR_LABELS_OUT} (${Object.keys(merged).length} codes)`);
    }

    if (!detailsOnly && Object.keys(subjectColleges).length > 0) {
      writeFileSync(COLLEGES_OUT, JSON.stringify(subjectColleges, null, 2));
      console.log(`Wrote ${COLLEGES_OUT} (${Object.keys(subjectColleges).length} subjects)`);
    }

    // Append to dev portal change log
    let changeLog = { runs: [] };
    if (existsSync(CHANGE_LOG)) {
      try { changeLog = JSON.parse(readFileSync(CHANGE_LOG, "utf8")); } catch {}
    }
    changeLog.runs = changeLog.runs ?? [];
    changeLog.runs.unshift({
      type:      "availability",
      subject:   "📅 Term Availability",
      timestamp: new Date().toISOString(),
      terms:     allCodes,
      covered,
      total,
      detailTerms:   completedTerms,
      detailCovered: Object.keys(termDetails).length,
      ...(profTargets.length && { profTerms: profTargets }),
      ...(restrTargets.length && { restrictionTerms: restrTargets }),
    });
    if (changeLog.runs.length > CHANGE_LOG_MAX) changeLog.runs = changeLog.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(changeLog, null, 2) + "\n", "utf8");
    console.log(`Wrote ${CHANGE_LOG}`);
  } else {
    console.log("\nDry run — pass --write to save term-history.json + term-details.json");
  }
}

main().catch(err => { console.error(err); process.exit(1); });

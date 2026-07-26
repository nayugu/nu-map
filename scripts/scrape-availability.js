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
 * Keys are Banner term codes (YYYY = AY end year; 10=Fall, 30=Spring,
 * 40=Summer 1, 60=Summer 2).
 *
 * Usage:
 *   node scripts/scrape-availability.js              # dry run — prints summary
 *   node scripts/scrape-availability.js --write      # write both JSON files
 *   node scripts/scrape-availability.js --write --details-only  # write only term-details.json
 *   node scripts/scrape-availability.js --term=202610,202630   # restrict terms (testing)
 *
 * Rate limiting: 500 ms between page requests by default.
 * Override: BANNER_DELAY_MS=200 node scripts/scrape-availability.js --write
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

const __dirname      = dirname(fileURLToPath(import.meta.url));
const ROOT           = resolve(__dirname, "..");
const ALL_COURSES    = resolve(ROOT, "public/northeastern/all-courses.json");
const HISTORY_OUT    = resolve(ROOT, "public/northeastern/term-history.json");
const DETAILS_OUT    = resolve(ROOT, "public/northeastern/term-details.json");
const COLLEGES_OUT   = resolve(ROOT, "public/northeastern/subject-colleges.json");
const CHANGE_LOG     = resolve(ROOT, "public/northeastern/change-log.json");
const CHANGE_LOG_MAX = 600;

const BASE      = "https://nubanner.neu.edu/StudentRegistrationSsb/ssb";
const PAGE_SIZE = 500;
const DELAY_MS  = parseInt(process.env.BANNER_DELAY_MS || "500", 10);
// Instructor fetches are one light request per SECTION (Banner strips faculty
// from the bulk search feed), so they get their own, tighter pacing.
const PROF_DELAY_MS = parseInt(process.env.BANNER_PROF_DELAY_MS || "250", 10);

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

// ── Cookie jar ───────────────────────────────────────────────────

let jar = {};

function parseCookies(raw) {
  if (!raw) return {};
  const headers = Array.isArray(raw) ? raw : [raw];
  const out = {};
  for (const h of headers) {
    const [pair] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    const val  = pair.slice(eq + 1).trim();
    if (name) out[name] = val;
  }
  return out;
}

function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function updateJar(res) {
  const raw = res.headers.get("set-cookie");
  if (raw) Object.assign(jar, parseCookies(raw));
}

// ── Banner SSB requests ──────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * fetch with backoff retries for transient network refusals. Banner rate-
 * limits sustained request volume (observed: connection refusals after ~7k
 * rapid instructor lookups) — waiting out the window recovers it.
 */
async function fetchRetry(url, opts, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fetch(url, opts); }
    catch (err) {
      if (i >= tries - 1) throw err;
      const wait = [5_000, 30_000, 90_000][i] ?? 90_000;
      console.warn(`    network refusal — backing off ${wait / 1000}s (attempt ${i + 2}/${tries})`);
      await sleep(wait);
    }
  }
}

async function getTermList(max = 30) {
  const url = `${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=${max}`;
  const res = await fetch(url);
  updateJar(res);
  if (!res.ok) throw new Error(`getTerms HTTP ${res.status}`);
  return await res.json(); // [{ code, description }, ...]
}

async function activateTerm(termCode) {
  const res = await fetch(`${BASE}/term/search?mode=search`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookieHeader() },
    body:    `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  updateJar(res);
  if (!res.ok) throw new Error(`term/search HTTP ${res.status} for ${termCode}`);
}

async function resetForm() {
  const res = await fetch(`${BASE}/classSearch/resetDataForm`, {
    method:  "POST",
    headers: { "Cookie": cookieHeader() },
  });
  updateJar(res);
}

async function fetchPage(termCode, offset) {
  const url = `${BASE}/searchResults/searchResults` +
    `?txt_term=${termCode}&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}` +
    `&sortColumn=subjectDescription&sortDirection=asc`;
  const res = await fetch(url, { headers: { "Cookie": cookieHeader() } });
  updateJar(res);
  if (!res.ok) throw new Error(`searchResults HTTP ${res.status}`);
  return await res.json();
}

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
  };
}

// ── Instructors ──────────────────────────────────────────────────

/** Banner's "Aloupis, Gregory" → display form "Gregory Aloupis". */
function flipName(displayName) {
  const i = (displayName || "").indexOf(",");
  if (i === -1) return (displayName || "").trim();
  const last  = displayName.slice(0, i).trim();
  const first = displayName.slice(i + 1).trim();
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
      termResults[termCode]   = offered;
      termDetail[termCode]    = detail;
      termEndByCode[termCode] = termEnd;
      const ended = termEnd && termEnd < new Date();
      console.log(`${offered.size} courses${ended ? " (ended — detail kept)" : " (in progress — detail skipped)"}`);
    } catch (err) {
      console.warn(`FAILED: ${err.message}`);
      termResults[termCode] = new Set();
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

  // Build term-history: only for courses in our catalog
  const termHistory = {};
  for (const courseId of catalogIds) {
    const hist = {};
    for (const termCode of allCodes) {
      hist[termCode] = termResults[termCode]?.has(courseId) ?? false;
    }
    // Only store if the course appeared in at least one queried term
    if (Object.values(hist).some(Boolean)) {
      termHistory[courseId] = hist;
    }
  }
  // A --term-restricted run must not wipe the other terms' history.
  if (termArgs.length && !detailsOnly && existsSync(HISTORY_OUT)) {
    try {
      const prevHist = JSON.parse(readFileSync(HISTORY_OUT, "utf8"));
      for (const [cid, hist] of Object.entries(prevHist)) {
        const kept = Object.fromEntries(Object.entries(hist).filter(([tc]) => !allCodes.includes(tc)));
        termHistory[cid] = { ...kept, ...(termHistory[cid] ?? {}) };
      }
    } catch {}
  }

  // Build term-details: enrollment/format/campus/meeting aggregate, ONLY for terms whose end
  // date has passed (final, stable numbers) and only for catalog courses.
  const now = new Date();
  const completedTerms = allCodes.filter(c => termEndByCode[c] && termEndByCode[c] < now);

  // Previous file: source for carrying forward instructor data (fetched once per
  // completed term, ever) and for preserving terms outside a --term test window.
  let prevDetails = {};
  if (existsSync(DETAILS_OUT)) {
    try { prevDetails = JSON.parse(readFileSync(DETAILS_OUT, "utf8")); } catch {}
  }
  const termsWithProf = new Set();
  for (const byTerm of Object.values(prevDetails)) {
    for (const [tc, d] of Object.entries(byTerm)) if (d.prof) termsWithProf.add(tc);
  }

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
      (termDetails[courseId] ??= {})[termCode] = entry;
    }
  }
  // A --term-restricted run must not wipe the other terms from the file.
  if (termArgs.length) {
    for (const [courseId, byTerm] of Object.entries(prevDetails)) {
      for (const [tc, d] of Object.entries(byTerm)) {
        if (!allCodes.includes(tc)) ((termDetails[courseId] ??= {})[tc] ??= d);
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
    });
    if (changeLog.runs.length > CHANGE_LOG_MAX) changeLog.runs = changeLog.runs.slice(0, CHANGE_LOG_MAX);
    writeFileSync(CHANGE_LOG, JSON.stringify(changeLog, null, 2) + "\n", "utf8");
    console.log(`Wrote ${CHANGE_LOG}`);
  } else {
    console.log("\nDry run — pass --write to save term-history.json + term-details.json");
  }
}

main().catch(err => { console.error(err); process.exit(1); });

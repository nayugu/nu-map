#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// derive-term-windows — measure when NU terms actually start and end
//
// The planner needs to know, from a date alone, which semester is "now"
// and which ones are finished.  That used to be four hand-picked day
// numbers ("typical first day + 1 week"), which cost 2–16 days of lag at
// the start of a term and up to 42 days at the end (a finished Fall still
// read as in-progress right through winter break).
//
// This script derives the thresholds from the registrar's own record
// instead: Banner publishes a startDate/endDate on every section meeting,
// so the first day of classes is the modal start date across a term's
// full-term Boston sections, and the end of finals is the 95th percentile
// of their end dates (the tail past the last day of classes is finals; the
// max alone would follow a single odd section).
//
// It runs over a ROLLING window — the last `--years` academic years,
// 5 by default — because the calendar drifts.  NEU moved Spring to a
// Wednesday start in 2026, and the 2021/22 COVID terms began up to 12 days
// late; constants frozen from one measurement would silently describe a
// calendar the university no longer keeps.
//
// Margin: each threshold is median + 2·MADN of the sampled starts (or ends)
// — the robust twin of mean + 2σ.  Plain mean + 2σ was the first thing tried
// and it does not survive a five-year window: Spring 2022 began Jan 18 under
// COVID, and that ONE point pulled σ from 1.2d to 6.0d and pushed the
// threshold out to Jan 25, later than the hand-picked Jan 22 this is meant to
// replace.  MADN (1.4826 × median absolute deviation, scaled to match σ on
// normal data) discounts a freak year without anyone having to hand-label
// which years were freak — and a genuine calendar shift still moves the
// median once it has happened two or three times running.  σ is reported
// alongside, but nothing is derived from it.
//
// The scale is small — under 1.5d MADN on every term type — so the threshold
// lands 1–4 days after classes really begin, against 7–16 days before.
// Where an exact arithmetic rule fits the whole sample it is preferred over
// the statistics and carries no margin at all: Fall begins the Wednesday
// after Labor Day, which held for every year measured back to 2018.  The
// script re-verifies that rule on every run and falls back to the robust
// estimate the year it stops holding.
//
// Usage:
//   node scripts/derive-term-windows.js            # report only
//   node scripts/derive-term-windows.js --write    # rewrite termWindows.js
//   node scripts/derive-term-windows.js --years 3
// ═══════════════════════════════════════════════════════════════════

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT  = resolve(ROOT, "src/adapters/northeastern/termWindows.js");

const BASE      = "https://nubanner.neu.edu/StudentRegistrationSsb/ssb";
const PAGE_SIZE = 500;
// Sections come back sorted by subject, so a single page is all of ACCT/AFCS.
// Sampling spread-out offsets keeps the date histogram from being one college's.
const OFFSETS   = [0, 1500, 3500, 6000];
const DELAY_MS  = parseInt(process.env.BANNER_DELAY_MS || "400", 10);

const WRITE      = process.argv.includes("--write");
const YEARS_BACK = parseInt(
  process.argv[process.argv.indexOf("--years") + 1] || "5", 10) || 5;

// ── Rails ────────────────────────────────────────────────────────
// Same principle as fetch-nupath's 5% rule and scrape-rails: buffer the
// whole run and refuse to write anything if the shape of it looks like
// upstream breakage rather than a real calendar change.  These thresholds
// are what a NORMAL run clears with room to spare — a run that trips one
// is telling us the sample is junk, not that NU moved a semester.
const MIN_TERMS_PER_TYPE = 3;   // fewer than 3 years is not a distribution
const MIN_SECTIONS       = 40;  // per term, after the Boston/full-term filter
const MAX_SCALE_DAYS     = 7;   // MADN this wide means the sample is not a
                                // calendar; measured values are all under 1.5
const MIN_BUFFER_DAYS    = 1;   // MADN can be exactly 0 when a term type has
                                // not moved; still leave a day of slack
const MAX_BUFFER_DAYS    = 7;   // and cap it: one freak year must not drag us
                                // back to the lag this is fixing
const MAX_ONSET_LAG_DAYS = 7;   // no term may be recognised more than a week
                                // after it began, in any year in the sample
const MIN_GAP_DAYS       = 1;   // consecutive windows must not overlap

// Banner term-code suffixes: 10 = Fall, 30 = Spring, 40 = Summer 1, 60 = Summer 2.
// The merged summer code (…50, AY2026+) carries both sessions and is split by
// partOfTerm, exactly as scrape-availability.js does.
const TYPES = {
  fall:   { suffix: "10", startRef: [9, 1],  endRef: [12, 1], pot: p => p === "1" },
  spring: { suffix: "30", startRef: [1, 1],  endRef: [4, 1],  pot: p => p === "1" },
  sumA:   { suffix: "40", startRef: [5, 1],  endRef: [6, 1],  pot: p => p === "1" || p === "2A" },
  sumB:   { suffix: "60", startRef: [6, 25], endRef: [8, 1],  pot: p => p === "1" || p === "2B" },
};
// Merged-summer fallback: when a year has no standalone 40/60 code, read the
// sessions out of the …50 term by part-of-term.
const MERGED_SUMMER = { sumA: "2A", sumB: "2B" };

// ── Banner session ───────────────────────────────────────────────

let jar = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function updateJar(res) {
  const raw = res.headers.getSetCookie?.() ?? res.headers.get("set-cookie");
  if (!raw) return;
  for (const h of (Array.isArray(raw) ? raw : [raw])) {
    const [pair] = h.split(";");
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

async function primeSession(termCode) {
  jar = {};
  let res = await fetch(`${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=5`);
  updateJar(res); await res.json();
  res = await fetch(`${BASE}/term/search?mode=search`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
    body:    `term=${termCode}&studyPath=&studyPathText=&startDatepicker=&endDatepicker=`,
  });
  updateJar(res); await res.text();
  res = await fetch(`${BASE}/classSearch/resetDataForm`, { method: "POST", headers: { Cookie: cookieHeader() } });
  updateJar(res); await res.text();
}

async function fetchPage(termCode, offset) {
  const url = `${BASE}/searchResults/searchResults?txt_term=${termCode}` +
    `&pageOffset=${offset}&pageMaxSize=${PAGE_SIZE}` +
    `&sortColumn=subjectDescription&sortDirection=asc`;
  const res = await fetch(url, { headers: { Cookie: cookieHeader() } });
  updateJar(res);
  if (!res.ok) throw new Error(`searchResults HTTP ${res.status}`);
  return res.json();
}

/** Banner "MM/DD/YYYY" → "YYYY-MM-DD", or null. */
const mdyToISO = raw => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((raw || "").trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

/** Every section's primary meeting in one term: { start, end, pot, campus }. */
async function sampleTerm(code) {
  await primeSession(code);
  const rows = [];
  let total = null;
  for (const off of OFFSETS) {
    if (total != null && off >= total) break;
    let json;
    try { json = await fetchPage(code, off); }
    catch (err) { console.warn(`    ${code} offset ${off}: ${err.message}`); await sleep(DELAY_MS); continue; }
    total = json.totalCount ?? total;
    for (const s of json.data ?? []) {
      for (const mf of s.meetingsFaculty ?? []) {
        const mt = mf.meetingTime;
        if (!mt?.startDate) continue;
        rows.push({
          start:  mdyToISO(mt.startDate),
          end:    mdyToISO(mt.endDate),
          pot:    (s.partOfTerm ?? "").trim(),
          campus: (s.campusDescription ?? "").trim(),
        });
        break; // the first meeting is the class; later ones are labs/recitations
      }
    }
    await sleep(DELAY_MS);
  }
  return rows;
}

// ── Statistics ───────────────────────────────────────────────────

const DAY = 86400000;
const dayNum   = iso => Date.parse(`${iso}T12:00:00Z`) / DAY;
const refDay   = (year, [m, d]) => Date.UTC(year, m - 1, d, 12) / DAY;
const fromRef  = (year, ref, offset) => new Date(Date.UTC(year, ref[0] - 1, ref[1] + offset, 12));

const median = values => {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Centre, spread and the threshold derived from them.
 *
 * `centre` is the median and `scale` is MADN — 1.4826 × the median absolute
 * deviation, the constant that makes MADN equal σ on normally distributed
 * data.  The threshold is centre + 2·scale, the robust reading of "mean + 2σ".
 * The classical mean/σ are carried along for the report only; a single
 * anomalous year moves σ several days and would defeat the whole point.
 */
function stats(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1
    ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
    : 0;
  const centre = median(values);
  const scale  = 1.4826 * median(values.map(v => Math.abs(v - centre)));
  const buffer = Math.min(MAX_BUFFER_DAYS, Math.max(MIN_BUFFER_DAYS, Math.ceil(2 * scale)));
  return {
    n, mean, sd, centre, scale, buffer,
    threshold: Math.round(centre) + buffer,
    min: Math.min(...values), max: Math.max(...values),
  };
}

/**
 * One term's first class day and end of finals.
 *
 * First day  = the modal start date.  A term's sections overwhelmingly share
 *              one start date (typically 80%+); late-start and half-term
 *              sections make up the rest, and the mode ignores them.
 * Finals end = the 95th percentile of end dates.  The modal end is the last
 *              day of CLASSES; finals run about a week past it, and the p95
 *              lands on the end of the exam period without chasing a single
 *              outlier section the way max would.
 */
function termBounds(rows, potFilter) {
  const sel = rows.filter(r => r.campus === "Boston" && r.start && potFilter(r.pot));
  if (sel.length < MIN_SECTIONS) return { n: sel.length, start: null, end: null };

  const counts = {};
  for (const r of sel) counts[r.start] = (counts[r.start] || 0) + 1;
  const [start] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

  const ends = sel.filter(r => r.end).map(r => r.end).sort();
  const end = ends.length ? ends[Math.min(ends.length - 1, Math.floor(ends.length * 0.95))] : null;

  return { n: sel.length, start, end };
}

/** Labor Day (first Monday of September) for a calendar year, as "YYYY-MM-DD". */
function laborDay(year) {
  for (let d = 1; d <= 7; d++) {
    if (new Date(Date.UTC(year, 8, d)).getUTCDay() === 1) {
      return `${year}-09-${String(d).padStart(2, "0")}`;
    }
  }
}
const addDaysISO = (iso, n) => new Date(dayNum(iso) * DAY + n * DAY).toISOString().slice(0, 10);

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  // AY end year: Sep–Dec → next calendar year; Jan–Aug → this one.  The
  // current AY is INCLUDED: in August its Fall and Spring are long finished,
  // and dropping them would throw away the two most recent — and most
  // representative — terms.  Individual terms that have not ended yet are
  // filtered out below on their measured end date rather than assumed.
  const currentAYEnd = now.getMonth() + 1 >= 9 ? now.getFullYear() + 1 : now.getFullYear();
  const ayEnds = [];
  for (let ay = currentAYEnd - YEARS_BACK + 1; ay <= currentAYEnd; ay++) ayEnds.push(ay);
  // …and one year past that, because Banner publishes roughly a term ahead.
  // Any term it has already scheduled does not need estimating at all — see
  // the pinning step below.
  ayEnds.push(currentAYEnd + 1);

  console.log(`Deriving term windows from AY ${ayEnds[0]}–${ayEnds.at(-1)} ` +
              `(${YEARS_BACK} academic years, rolling).\n`);

  const known = new Map(
    (await (await fetch(`${BASE}/classSearch/getTerms?searchTerm=&offset=1&max=200`)).json())
      .map(t => [t.code, t.description]));

  // observed[type] = [{ year, start, end, n }]   — finished terms, used to fit
  // pinned                = { "fall2026": {...} } — terms Banner has already
  //                         scheduled, used verbatim instead of any estimate
  const observed = { fall: [], spring: [], sumA: [], sumB: [] };
  const pinned = {};
  const termCache = new Map();

  for (const ayEnd of ayEnds) {
    for (const [type, cfg] of Object.entries(TYPES)) {
      // Fall of AY N runs in calendar year N-1; every other term runs in N.
      const year = cfg.suffix === "10" ? ayEnd - 1 : ayEnd;
      let code = `${ayEnd}${cfg.suffix}`;
      let potFilter = cfg.pot;

      if (!known.has(code) && MERGED_SUMMER[type]) {
        // AY2026+: the standalone 40/60 codes are retired into a single …50.
        const merged = `${ayEnd}50`;
        if (!known.has(merged)) { console.log(`  ${type} ${year}: no term code — skipped`); continue; }
        code = merged;
        const want = MERGED_SUMMER[type];
        potFilter = p => p === want;
      }
      if (!known.has(code)) { console.log(`  ${type} ${year}: no term code — skipped`); continue; }

      if (!termCache.has(code)) termCache.set(code, await sampleTerm(code));
      const { n, start, end } = termBounds(termCache.get(code), potFilter);

      if (!start || !end) {
        console.log(`  ${type.padEnd(6)} ${year}  ${code}  only ${n} sections — skipped`);
        continue;
      }
      // A term that has not finished cannot join the fit — its sections are
      // still being edited, and judging that on the measured end date rather
      // than on the calendar we are in the middle of deriving keeps the two
      // from arguing.
      //
      // But it is far MORE useful than a fitted estimate: Banner has already
      // scheduled it, so its start is a published fact rather than a guess
      // off five years of history. Pin it. This is what closes the gap a
      // fitted threshold cannot: an estimate fitted to ordinary years fires
      // early in a year that shifts (Spring 2022 began 12 days late under
      // COVID), whereas a shift shows up in Banner's own dates immediately.
      // The fit stays as the fallback for terms past Banner's horizon.
      if (end >= today) {
        const prefix = type === "spring" ? "spr" : type;
        pinned[`${prefix}${year}`] = { type, year, start, end, n, code };
        console.log(`  ${type.padEnd(6)} ${year}  ${code}  PINNED — Banner has it scheduled ${start} → ${end}  (n=${n})`);
        continue;
      }
      console.log(`  ${type.padEnd(6)} ${year}  ${code}  classes ${start} → finals end ${end}  (n=${n})`);
      observed[type].push({ year, start, end, n });
    }
  }

  // ── Fit each term type ─────────────────────────────────────────
  console.log("");
  const types = {};
  const problems = [];

  for (const [type, cfg] of Object.entries(TYPES)) {
    const list = observed[type];
    if (list.length < MIN_TERMS_PER_TYPE) {
      problems.push(`${type}: only ${list.length} usable terms (need ${MIN_TERMS_PER_TYPE})`);
      continue;
    }

    const startOff = list.map(o => dayNum(o.start) - refDay(o.year, cfg.startRef));
    const endOff   = list.map(o => dayNum(o.end)   - refDay(o.year, cfg.endRef));
    const S = stats(startOff);
    const E = stats(endOff);

    if (S.scale > MAX_SCALE_DAYS) problems.push(`${type}: start scale ${S.scale.toFixed(1)}d exceeds ${MAX_SCALE_DAYS}d`);
    if (E.scale > MAX_SCALE_DAYS) problems.push(`${type}: end scale ${E.scale.toFixed(1)}d exceeds ${MAX_SCALE_DAYS}d`);

    // Fall's arithmetic rule: does "the Wednesday after Labor Day" reproduce
    // every sampled start exactly?  If so it beats any statistical margin —
    // the answer is bounded (Labor Day ∈ Sep 1–7, so the start is Sep 3–9)
    // rather than estimated, and needs no buffer at all.
    const ruleFits = type === "fall" &&
      list.every(o => addDaysISO(laborDay(o.year), 2) === o.start);

    const record = {
      n: list.length,
      years: [list[0].year, list.at(-1).year],
      startScale: +S.scale.toFixed(2),
      endScale:   +E.scale.toFixed(2),
      startSd:    +S.sd.toFixed(2),   // reported, never used — see the header
      endSd:      +E.sd.toFixed(2),
    };

    if (ruleFits) {
      // End tracks the rule, so it is an offset in days from the first class
      // day rather than a fixed date — that keeps the window the right LENGTH
      // in a year the start moves.
      const L = stats(list.map(o => dayNum(o.end) - dayNum(o.start)));
      record.startRule   = "laborDayPlus2";
      record.lengthDays  = L.threshold;
      record.startBuffer = 0;
      record.lengthScale = +L.scale.toFixed(2);
    } else {
      // Cap the threshold at the earliest start ever observed plus
      // MAX_ONSET_LAG_DAYS. The buffer alone does not bound the lag: it is
      // measured from the MEDIAN, so a year that starts early sees the full
      // buffer plus its own distance below the median. Summer 2's threshold
      // sat 8 days past its 2026 start that way — over the budget, from a
      // 5-day buffer.
      // +1 for the same reason a known date gets one (see ONSET_MARGIN_DAYS in
      // calendar.js): median + 2·MADN still lands exactly ON the first class in
      // a year that starts above the median, and "in progress" should mean a
      // class has actually met. The cap below keeps that day from costing.
      const capped = Math.min(S.threshold + 1, S.min + MAX_ONSET_LAG_DAYS);
      if (capped < S.threshold) {
        console.log(`  cap ${type}: threshold pulled in ${S.threshold - capped}d — ` +
                    `no term may be recognised more than ${MAX_ONSET_LAG_DAYS}d late`);
      }
      const startDate = fromRef(2001, cfg.startRef, capped);
      const endDate   = fromRef(2001, cfg.endRef,   E.threshold);
      record.start       = { month: startDate.getUTCMonth() + 1, day: startDate.getUTCDate() };
      record.end         = { month: endDate.getUTCMonth() + 1,   day: endDate.getUTCDate() };
      record.startBuffer = capped - Math.round(S.centre);
    }
    types[type] = record;

    const show = ruleFits
      ? `Labor Day + 2 → +${record.lengthDays}d`
      : `${record.start.month}/${record.start.day} → ${record.end.month}/${record.end.day}`;
    console.log(`${type.padEnd(7)} n=${record.n}  start MADN ${record.startScale}d (σ ${record.startSd}d)  ` +
                `end MADN ${record.endScale}d (σ ${record.endSd}d)   ${show}`);
  }

  // ── Clamp each window against the next term's observed start ───
  //
  // A fitted end is a margin sitting on top of a spread, and nothing in the
  // fit knows about the term that follows.  Summer 1's end fits to Jul 1,
  // but Summer 2 has begun as early as Jun 30 — so for two days the planner
  // would call Summer 1 current while Summer 2 was already teaching.  Where
  // an estimated margin collides with a date we have actually observed, the
  // observation wins: the end is pulled back to the day before.
  //
  // This is the switch point that matters.  Between two windows "now" is the
  // upcoming term, so a term stops being current exactly at its own end —
  // the next term's start threshold never enters into it.
  const probe = 2027;
  const resolveStart = (type, r, year) => r.startRule === "laborDayPlus2"
    ? dayNum(addDaysISO(laborDay(year), 2))
    : refDay(year, [r.start.month, r.start.day]);
  const resolveEnd = (type, r, year) => r.lengthDays != null
    ? resolveStart(type, r, year) + r.lengthDays
    : refDay(year, [r.end.month, r.end.day]);

  // Academic order, and the year offset of the term that follows each one.
  const ORDER = [["fall", "spring", +1], ["spring", "sumA", 0], ["sumA", "sumB", 0], ["sumB", "fall", 0]];
  for (const [type, next, yearShift] of ORDER) {
    const r = types[type], rn = types[next];
    if (!r || !rn) continue;
    const earliestNext = Math.min(...observed[next].map(
      o => dayNum(o.start) - refDay(o.year, TYPES[next].startRef))) + refDay(probe + yearShift, TYPES[next].startRef);
    const end = resolveEnd(type, r, probe);
    if (end < earliestNext) continue;

    const pullBack = end - (earliestNext - 1);
    console.log(`  clamp ${type}: end pulled back ${pullBack}d — ${next} has started this early`);
    if (r.lengthDays != null) r.lengthDays -= pullBack;
    else {
      const d = new Date((earliestNext - 1) * DAY);
      r.end = { month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    }
    r.endClampedBy = next;
  }

  // ── Rail: the windows must stay ordered and disjoint ───────────
  // Resolve a representative year and check that Fall ends before Spring
  // begins, and so on.  Overlapping windows would make "which term is now"
  // ambiguous; an inverted one would make a term end before it starts.
  const resolved = [];
  for (const [type, r] of Object.entries(types)) {
    const start = resolveStart(type, r, probe);
    const end   = resolveEnd(type, r, probe);
    if (end <= start) problems.push(`${type}: window ends on or before it starts`);
    resolved.push({ type, start, end });
  }
  resolved.sort((a, b) => a.start - b.start);
  for (let i = 1; i < resolved.length; i++) {
    const gap = resolved[i].start - resolved[i - 1].end;
    if (gap < MIN_GAP_DAYS) {
      problems.push(`${resolved[i - 1].type} → ${resolved[i].type}: windows overlap (gap ${gap}d)`);
    }
  }

  if (problems.length) {
    console.error("\nRefusing to write — the sample does not look like a calendar:");
    for (const p of problems) console.error(`  • ${p}`);
    process.exitCode = 1;
    return;
  }

  const payload = {
    generatedAt: now.toISOString().slice(0, 10),
    yearsBack:   YEARS_BACK,
    sampledAY:   [ayEnds[0], ayEnds.at(-1)],
    types,
    // Exact published dates, keyed by semId, for the terms Banner had already
    // scheduled at generation time. Consulted BEFORE `types`, so within
    // Banner's horizon nothing is estimated at all.
    pinned: Object.fromEntries(Object.entries(pinned)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([semId, p]) => [semId, { start: p.start, end: p.end }])),
  };
  console.log(`\nPinned ${Object.keys(pinned).length} scheduled term(s): ${Object.keys(pinned).sort().join(", ") || "none"}`);

  if (!WRITE) {
    console.log("\n(dry run — pass --write to update termWindows.js)");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  writeFileSync(OUT, renderModule(payload));
  console.log(`\nWrote ${OUT}`);
}

/** Render the generated ESM module.  Plain JS, not JSON: it is imported by the
 *  browser bundle, the Node MCP server and the Cloudflare worker alike, and a
 *  bare `export default` needs no import attributes or bundler config. */
function renderModule(payload) {
  return `// ═══════════════════════════════════════════════════════════════════
// GENERATED by scripts/derive-term-windows.js — do not edit by hand.
//
// When each NU term begins and ends, measured from Banner section meeting
// dates over a rolling ${payload.yearsBack}-year window (AY ${payload.sampledAY[0]}–${payload.sampledAY[1]}).
// Regenerated by the monthly update-courses workflow, so the thresholds
// follow the registrar's calendar instead of freezing a past one.
//
// Thresholds sit at median + 2·MADN of the sampled dates — the robust
// reading of "mean + 2σ", so one anomalous year (COVID pushed Spring 2022
// twelve days late) widens nothing.  \`startSd\`/\`endSd\` are the classical
// σ, reported for comparison only; nothing is derived from them.
//
// Where an exact arithmetic rule fits the whole sample it wins outright and
// carries no margin, because it is not an estimate: \`startRule\` names it and
// \`lengthDays\` gives the window length measured from it.
//
// Generated ${payload.generatedAt}.
// ═══════════════════════════════════════════════════════════════════

export default ${JSON.stringify(payload, null, 2)};
`;
}

main().catch(err => { console.error(err); process.exitCode = 1; });

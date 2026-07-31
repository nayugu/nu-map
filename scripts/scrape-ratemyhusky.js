#!/usr/bin/env node
/**
 * scrape-ratemyhusky.js
 *
 * Builds a VERIFIED lookup of Northeastern instructor name → RateMyHusky
 * professor-page slug, so NU Map can link every instructor (in the InfoPanel
 * and the bank's professor filter) straight to their RateMyHusky reviews
 * without ever guessing a slug that 404s.
 *
 * Why scrape at all? RateMyHusky's professor slugs are lowercase-hyphenated
 * and OFTEN carry a middle name (e.g. `albert-laszlo-barabasi`), so a naive
 * `first-last` guess silently misses people. We fetch its sitemap.xml (the
 * browsable professor set) and match each instructor NU Map knows (from
 * term-details.json) to its slug by name tokens. The sitemap is INCOMPLETE
 * though — some professors with real reviews aren't listed — so for the names
 * it can't match we hit the search API and confirm via the professor endpoint
 * that the page actually has reviews (totalRatings > 0). We only keep pages
 * with reviews, so a name never links to an empty profile; anything unmatched
 * has no link at all (renders as plain text in the app).
 *
 * It also fetches the AUTHORITATIVE set of course codes RateMyHusky actually
 * has a page for (via /api/courses-catalog) — RateMyHusky only has ~5k of NEU's
 * ~8k catalog courses, and its /courses/<CODE> route is a client-rendered SPA
 * that serves a 200 shell for ANY code (even nonexistent ones), so we cannot
 * tell coverage from the URL. Storing the real set lets the app show the course
 * link only where a page exists, instead of sending students to an empty page.
 *
 * This stores only public URL slugs + course codes — a LINK DIRECTORY — not any
 * TRACE / review content, so it carries none of the republishing weight of the
 * ratings themselves.
 *
 * Output: public/northeastern/ratemyhusky.json
 *   {
 *     "generated": "2026-07-31",
 *     "source": "https://ratemyhusky.com",
 *     "profs": { "Albert-Laszlo Barabasi": "albert-laszlo-barabasi", ... },
 *     "courses": ["AACE6000", "ACCT1201", ...]   // codes with a real RMH page
 *   }
 *
 * A hand-maintained scripts/ratemyhusky-overrides.json can force or suppress
 * individual name → slug mappings (applied after auto-matching, always wins) —
 * the escape hatch for any professor the sitemap match can't reach.
 *
 * Usage:
 *   node scripts/scrape-ratemyhusky.js           # dry run — prints match rate + samples
 *   node scripts/scrape-ratemyhusky.js --write    # write ratemyhusky.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname   = dirname(fileURLToPath(import.meta.url));
const ROOT        = resolve(__dirname, "..");
const DETAILS_IN  = resolve(ROOT, "public/northeastern/term-details.json");
const OVERRIDES_IN = resolve(ROOT, "scripts/ratemyhusky-overrides.json");
const OUT         = resolve(ROOT, "public/northeastern/ratemyhusky.json");
const SITEMAP     = "https://ratemyhusky.com/sitemap.xml";
const COURSES_API = "https://ratemyhusky.com/api/courses-catalog";
const SEARCH_API  = "https://ratemyhusky.com/api/search";
const PROF_API    = "https://ratemyhusky.com/api/professors";

const doWrite   = process.argv.includes("--write");
const noRecover = process.argv.includes("--no-recover");  // skip the slow search pass (local dev)

const UA = { "User-Agent": "nu-map-linkcheck/1.0 (+https://numap.app)" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

// Fold a name to comparable lowercase alphanumeric tokens the same way
// RateMyHusky builds a slug: strip diacritics (Zoë → zoe), lowercase, and
// split on EVERY non-alphanumeric run. Critically, apostrophes split like
// hyphens — RateMyHusky renders "Peggy O'Kelly" as `peggy-o-kelly`, so we must
// tokenize to [peggy, o, kelly] to match (removing the apostrophe → "okelly"
// silently missed every O'/D' name). The whole match hinges on this being
// symmetric with slug.split("-").
function tokens(s) {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // strip accents
    .toLowerCase()
    .split(/[^a-z0-9]+/)                                  // apostrophes/spaces/hyphens all split
    .filter(Boolean);
}

// Is `a` an order-preserving subsequence of `b`? Used to accept a match where a
// middle name is present on only one side (Albert [Laszlo] Barabasi) while
// rejecting a conflicting middle token (Yi-Ting Chen must NOT match yi-da-chen).
function isSubseq(a, b) {
  let i = 0;
  for (const x of b) if (i < a.length && a[i] === x) i++;
  return i === a.length;
}

async function fetchSlugs() {
  const res = await fetch(SITEMAP, {
    headers: { "User-Agent": "nu-map-linkcheck/1.0 (+https://numap.app)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${SITEMAP}`);
  const xml = await res.text();
  // <loc>https://ratemyhusky.com/professors/<slug></loc> — ignore the bare
  // /professors index and any non-professor URLs.
  const slugs = [];
  const re = /\/professors\/([a-z0-9-]+)(?=[<"/?])/g;
  let m;
  while ((m = re.exec(xml))) slugs.push(m[1]);
  return [...new Set(slugs)];
}

// The authoritative set of course codes RateMyHusky has a page for, paged out
// of /api/courses-catalog (code === subject+number, matching NU Map's ids).
async function fetchCourseCodes() {
  const codes = [];
  let page = 1, totalPages = 1;
  do {
    const res = await fetch(`${COURSES_API}?page=${page}&limit=1000`, {
      headers: { "User-Agent": "nu-map-linkcheck/1.0 (+https://numap.app)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${COURSES_API}`);
    const j = await res.json();
    for (const c of j.courses ?? []) if (c.code) codes.push(c.code);
    totalPages = j.total ? Math.ceil(j.total / 1000) : 1;
    page++;
  } while (page <= totalPages);
  return [...new Set(codes)];
}

// Collect every unique instructor name NU Map knows, from the raw per-term
// aggregates (term-details.json → course → term → prof: [[name, secs, enr]]).
function collectInstructorNames() {
  if (!existsSync(DETAILS_IN)) {
    console.error(`Missing ${DETAILS_IN} — run scripts/scrape-availability.js first.`);
    process.exit(1);
  }
  const details = JSON.parse(readFileSync(DETAILS_IN, "utf8"));
  const names = new Set();
  for (const byTerm of Object.values(details)) {
    for (const entry of Object.values(byTerm)) {
      for (const [name] of entry.prof ?? []) {
        if (name) names.add(name);
      }
    }
  }
  return [...names];
}

// Hand-maintained escape hatch: instructor name → slug (force a link) or
// name → null (suppress — no verified page, or a wrong auto-match to drop).
// Takes precedence over auto-matching. Optional file; absent = no overrides.
function loadOverrides() {
  if (!existsSync(OVERRIDES_IN)) return {};
  try {
    const j = JSON.parse(readFileSync(OVERRIDES_IN, "utf8"));
    return (j && typeof j.profs === "object") ? j.profs : {};
  } catch (err) {
    console.warn(`Ignoring unreadable ${OVERRIDES_IN}: ${err.message}`);
    return {};
  }
}

// The sitemap/professor catalog only lists professors with enough data — it
// misses some who DO have a reviewed page (e.g. Andrew Perry, 7 ratings). For
// the names it couldn't match, ask the search API directly, then confirm via
// the professor endpoint that the page actually has reviews (totalRatings > 0)
// so we never link an empty profile. Among compatible reviewed hits (rare
// same-name collisions, incl. numbered `-2` duplicates) keep the most-reviewed.
async function searchRecover(unmatched) {
  const found = {};
  const CONC = 5;
  let idx = 0, done = 0;
  async function worker() {
    while (idx < unmatched.length) {
      const name = unmatched[idx++];
      const t = tokens(name);
      try {
        const hits = (await getJson(`${SEARCH_API}?q=${encodeURIComponent(name)}&`))
          .filter(x => x && x.type === "professor" && x.name && (isSubseq(t, tokens(x.name)) || isSubseq(tokens(x.name), t)));
        let best = null;
        for (const h of hits) {
          const p = await getJson(`${PROF_API}/${encodeURIComponent(h.slug)}`).catch(() => null);
          const r = p?.totalRatings ?? 0;
          if (r > 0 && (!best || r > best.r)) best = { slug: h.slug, r };
          await sleep(15);
        }
        if (best) found[name] = best.slug;
      } catch { /* leave unmatched — it will render as plain text */ }
      if (++done % 100 === 0) console.log(`  …searched ${done}/${unmatched.length}`);
      await sleep(15);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  return found;
}

async function main() {
  const slugs = await fetchSlugs();
  const slugSet = new Set(slugs);
  console.log(`Fetched ${slugs.length} professor slugs from RateMyHusky sitemap.`);

  const courseCodes = await fetchCourseCodes();
  console.log(`Fetched ${courseCodes.length} course codes with a RateMyHusky page.`);

  // Index slugs by "first|last" token. A key mapping to a single slug is an
  // unambiguous match; a key with several slugs (two real people share a
  // first+last name) is only resolved when one candidate's FULL token set
  // equals the instructor's — otherwise we skip rather than link the wrong one.
  const byFirstLast = new Map();
  for (const slug of slugs) {
    const t = slug.split("-").filter(Boolean);
    if (t.length < 2) continue;
    const key = `${t[0]}|${t[t.length - 1]}`;
    if (!byFirstLast.has(key)) byFirstLast.set(key, []);
    byFirstLast.get(key).push({ slug, t });
  }

  const names = collectInstructorNames();
  const profs = {};
  let ambiguous = 0;
  for (const name of names) {
    const t = tokens(name);
    if (t.length < 2) continue;
    const cand = byFirstLast.get(`${t[0]}|${t[t.length - 1]}`);
    if (cand) {
      // Prefer an exact full-token slug; otherwise the one slug whose tokens are
      // subsequence-compatible with the name (a middle name on just one side is
      // fine; a conflicting middle token is not). Two plausible slugs → skip
      // rather than guess a wrong person.
      const exact = cand.find(c => c.t.length === t.length && c.t.every((x, i) => x === t[i]));
      if (exact) { profs[name] = exact.slug; continue; }
      const compat = cand.filter(c => isSubseq(t, c.t) || isSubseq(c.t, t));
      if (compat.length === 1) { profs[name] = compat[0].slug; continue; }
      if (compat.length > 1) { ambiguous++; continue; }
    }
    // Last resort: the full name joined as a slug is a real page (covers a
    // first|last key that had no compatible candidate above).
    const guess = t.join("-");
    if (slugSet.has(guess)) profs[name] = guess;
    else if (cand) ambiguous++;
  }

  // Recover reviewed professors the catalog missed, via the search API.
  let recovered = 0;
  if (!noRecover) {
    const unmatched = names.filter(n => !profs[n] && tokens(n).length >= 2);
    console.log(`Searching ${unmatched.length} unmatched names for reviewed pages the catalog missed…`);
    const found = await searchRecover(unmatched);
    for (const [name, slug] of Object.entries(found)) { profs[name] = slug; recovered++; }
    console.log(`Recovered ${recovered} reviewed professors via search.`);
  }

  // Apply manual overrides last so they always win.
  const overrides = loadOverrides();
  let overridden = 0;
  for (const [name, slug] of Object.entries(overrides)) {
    if (slug === null) { if (name in profs) { delete profs[name]; overridden++; } }
    else if (typeof slug === "string") { profs[name] = slug; overridden++; }
  }

  const matched = Object.keys(profs).length;
  const pct = names.length ? Math.round((matched / names.length) * 100) : 0;
  console.log(`Matched ${matched}/${names.length} instructors (${pct}%) — ${recovered} via search, ${overridden} overrides, ${ambiguous} ambiguous skipped.`);
  console.log("Samples:", Object.entries(profs).slice(0, 8).map(([n, s]) => `${n} → ${s}`).join(", "));

  if (!doWrite) {
    console.log("\nDry run — pass --write to save public/northeastern/ratemyhusky.json");
    return;
  }

  // Stable key order so diffs stay small month to month.
  const sorted = {};
  for (const name of Object.keys(profs).sort()) sorted[name] = profs[name];
  const out = {
    generated: new Date().toISOString().slice(0, 10),
    source: "https://ratemyhusky.com",
    profs: sorted,
    courses: [...courseCodes].sort(),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  console.log(`Wrote ${OUT} (${matched} professors, ${courseCodes.length} courses).`);
}

main().catch(err => {
  console.error(`scrape-ratemyhusky failed: ${err.message}`);
  process.exit(1);
});

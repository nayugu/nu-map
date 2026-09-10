// ═══════════════════════════════════════════════════════════════════
// TERM HISTORY — "not offered" is a claim, and it needs evidence
//
// term-history.json says, per course per term, offered or not. The distinction this
// module exists to keep is between FALSE and ABSENT:
//
//   false    Banner answered for this term, and this course was not in it
//   absent   we do not know — the term was not read
//
// They were the same value before. `fetchTermOfferings` stored whatever it got, and
// a term that came back with zero sections became an empty Set, so every course in
// the catalog was written `false` for that term.
//
// That is not hypothetical. Banner intermittently answers the first page of
// searchResults with `success: true, totalCount: 0` — observed twice consecutively
// on 202530, a term that really has 6,699 sections, with the identical request
// succeeding minutes either side. The old `catch` did the same thing on a thrown
// fetch. On the monthly unattended run that pushes straight to main, either one
// silently replaced a semester of real offering history with "nothing was offered",
// and nothing downstream could tell the difference: a course legitimately absent
// from Spring and a whole Spring we failed to read both read as `false`.
//
// So a term earns a verdict only by returning sections. Everything else is left out
// of the file, where the app already treats a missing term as unknown.
// ═══════════════════════════════════════════════════════════════════

/**
 * How many terms of availability history the app SHIPS.
 *
 * ── The leak this closes ────────────────────────────────────────────
 *
 * `mergePreviousHistory` carries forward every term it did not re-read, which is
 * exactly right for durability and had no bound at all. Terms accrue about four a
 * year (fall, spring, two summer codes), so `term-history.json` and
 * `offering-summary.json` grew forever — and they are in the COLD BLOCKING
 * payload the planner awaits before first paint. Measured 2026-09-10 at 13 terms:
 * the two are 309K gzipped together, and at the observed rate they reach ~785K in
 * five years and ~1,261K in ten, taking the blocking payload 32% and 64% above
 * today's. Nobody would ever see a single bad deploy; it just gets slower for
 * every visitor, unattended, forever.
 *
 * 16 is the stated product need (3 years of availability = 13 terms) plus a year
 * of margin. Bounded, the two files sit at roughly 380K gzipped indefinitely.
 *
 * ⚠ This filters what SHIPS. It does NOT delete anything: the full history lives
 * in `public/northeastern/term-details.json`, which the derive reads, so widening
 * the window is a re-derive rather than a re-scrape. That is the same rule
 * `editionWindow` follows in `catalog-edition.js`, and for the same reason —
 * narrowing is recoverable and deleting is not.
 */
export const KEEP_TERMS = 16;

/**
 * The newest `KEEP_TERMS` term codes, newest first — plus every code whose shape
 * this function does not recognise.
 *
 * Codes are six digits (`202610`), so a lexicographic sort is also chronological
 * — year then term suffix. Deliberately not parsed as numbers: the synthetic
 * summer codes AY2026+ (`…40`/`…60`, split from NEU's merged `…50`) must sort
 * beside their siblings, and `Number` on a malformed code yields NaN and sorts
 * unpredictably.
 *
 * ⚠ An unrecognised code is KEPT, not dropped, and that is the whole point of
 * this shape. The first version filtered to `/^\d{6}$/` and windowed the rest,
 * which meant any code NEU invented in a form we had not seen would be deleted
 * from the shipped file silently — the exact family of mistake this module was
 * written about, where losing data and having none look identical downstream.
 * `term-history.test.js` caught it on a synthetic `"t"`. Retention is a size
 * optimisation; it has no business deciding what is real, so it bounds what it
 * understands and passes through what it does not.
 *
 * @param {Iterable<string>} codes
 * @returns {string[]} recognised codes newest-first, then unrecognised ones
 */
export function termWindow(codes) {
  const all = [...new Set([...(codes ?? [])].map(String))];
  const known = all.filter(c => /^\d{6}$/.test(c))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, KEEP_TERMS);
  return [...known, ...all.filter(c => !/^\d{6}$/.test(c))];
}

/**
 * The terms allowed to produce a verdict: those that actually returned sections.
 *
 * @param {string[]} allCodes            every term code queried this run
 * @param {Record<string, Set<string>>} termResults  code → offered course ids
 * @returns {string[]} subset of allCodes, order preserved
 */
export function knownTermCodes(allCodes, termResults) {
  return (allCodes ?? []).filter(c => (termResults?.[c]?.size ?? 0) > 0);
}

/**
 * Build term-history for the catalog.
 *
 * A course is kept only if it was offered in at least one KNOWN term — a course
 * with nothing but `false` entries carries no information and used to bloat the
 * file with every discontinued course in the catalog.
 *
 * @param {Iterable<string>} catalogIds
 * @param {Record<string, Set<string>>} termResults
 * @param {string[]} knownCodes  from knownTermCodes
 * @returns {Record<string, Record<string, boolean>>}
 */
export function buildTermHistory(catalogIds, termResults, knownCodes) {
  const out = {};
  for (const courseId of catalogIds ?? []) {
    const hist = {};
    for (const termCode of knownCodes ?? []) {
      hist[termCode] = termResults[termCode].has(courseId);
    }
    if (Object.values(hist).some(Boolean)) out[courseId] = hist;
  }
  return out;
}

/**
 * Merge a previous history file over a partial run's result.
 *
 * Only KNOWN terms may be overwritten. A term that was queried and came back empty
 * keeps whatever the file already said about it — the whole point: a failed read
 * must not be able to delete a good verdict, which is what filtering on "queried"
 * rather than "known" did.
 *
 * @param {Record<string, Record<string, boolean>>} fresh  this run's history
 * @param {Record<string, Record<string, boolean>>} prev   the file on disk
 * @param {string[]} knownCodes
 * @returns {Record<string, Record<string, boolean>>} merged (a new object)
 */
export function mergePreviousHistory(fresh, prev, knownCodes) {
  const known = new Set(knownCodes ?? []);
  const out = { ...(fresh ?? {}) };
  for (const [cid, hist] of Object.entries(prev ?? {})) {
    const kept = Object.fromEntries(Object.entries(hist).filter(([tc]) => !known.has(tc)));
    out[cid] = { ...kept, ...(out[cid] ?? {}) };
  }

  // Retention, applied AFTER the merge rather than to `prev` alone. Applying it
  // earlier would let this run's own terms push the total past the window
  // silently; applied here the window describes the file that actually ships.
  // The set of terms is taken from the merged result, so a term the window drops
  // is dropped for every course at once and no course is left with a lone stale
  // verdict its neighbours no longer carry.
  const keep = new Set(termWindow(Object.values(out).flatMap(h => Object.keys(h))));
  for (const cid of Object.keys(out)) {
    const hist = Object.fromEntries(Object.entries(out[cid]).filter(([tc]) => keep.has(tc)));
    // A course with no term left inside the window carries no information, which
    // is the same rule `buildTermHistory` applies to an all-`false` course.
    if (Object.keys(hist).length) out[cid] = hist;
    else delete out[cid];
  }
  return out;
}

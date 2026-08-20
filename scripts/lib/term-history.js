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
  return out;
}

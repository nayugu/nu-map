// ═══════════════════════════════════════════════════════════════════
// RANK RECORDS  (pure — one scorer for every "type a name" box)
//
// Scores a query against one record and returns a number, or -Infinity for
// no match. The tier ladder lives in nameMatch.js; this file is the order the
// tiers are tried in, and nothing else.
//
// ## Why one scorer
//
// This logic used to be `scoreOption` inside searchRank.js, reachable only by
// program search. The data surface (docs/data-search-design.md) needs the same
// matching over courses, professors, subjects and NUpath codes, and the obvious
// route — extract the primitives, write a second ranker on top — is how "cs"
// comes to mean one thing in the planner and another on /data. So there is one
// scorer, and a caller adapts its domain objects into the record shape below.
//
// ## The record shape
//
// Every field is a *role in matching*, never a domain concept, which is what
// lets one ladder serve a degree name and a course title:
//
//   name       the primary string, lowercased. Coverage is measured against it,
//              and the ORDERED / INITIALS tiers see only its words. Required.
//   exact      strings that count as the whole name when equal (a display label)
//   codes      official abbreviations — equal → ACRONYM_CODE. NU's own degree
//              code is stronger evidence than initials we derived ourselves,
//              which is what puts Computer Science above Cinema Studies for "cs"
//   acronyms   derived initials — membership → ACRONYM. Also joined WHOLE into
//              the ANY pool, so "cs oakland" and "cs bscs" resolve
//   poolWords  extra words admitted to the ANY tier only (campus, degree words)
//   loose      last-resort substring fields, each with its own penalty; `slug`
//              also tries the query with spaces turned into underscores
//
// A caller that has none of the secondary fields passes `name` alone. That is
// the whole extensibility story: a new kind of thing becomes searchable by
// describing which of its strings play which role.
// ═══════════════════════════════════════════════════════════════════

import {
  T, words, coverage,
  orderedPrefixes, anyPrefixes, orderedInitials, anyInitials,
} from "./nameMatch.js";

/**
 * Normalize raw input into the query form every tier expects: lowercased,
 * single-spaced, plus its tokens. Both halves are needed by every caller, and
 * splitting them twice is how the two diverge.
 *
 * @returns {{q: string, qTokens: string[]}} `q` is "" when there is nothing to search
 */
export function normalizeQuery(query) {
  const q = (query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return { q, qTokens: q ? words(q) : [] };
}

/**
 * Score one record against a normalized query.
 *
 * Tiers are tried strongest-first and the first hit wins, so the ORDER of these
 * tests is the design. Coverage is added inside the tier and is capped below the
 * tier gap, so it can never promote a weaker match past a stronger one.
 *
 * @param {{name: string, exact?: string[], codes?: string[], acronyms?: string[],
 *          poolWords?: string[], loose?: Array<{text: string, penalty: number, slug?: boolean}>}} rec
 * @param {string} q normalized query
 * @param {string[]} qTokens its tokens
 * @returns {number} score, or -Infinity when the record does not match at all
 */
export function scoreRecord(rec, q, qTokens) {
  const name = rec.name;
  if (!name) return -Infinity;
  const cov = coverage(q, name);

  if (name === q || (rec.exact?.includes(q) ?? false))    return T.EXACT        + cov;

  // An official code settles acronym collisions: for "cs", Computer Science
  // (BSCS) sits above Cinema Studies, whose "cs" is only derived initials.
  if (rec.codes?.includes(q))                             return T.ACRONYM_CODE + cov;
  if (rec.acronyms?.includes(q))                          return T.ACRONYM      + cov;

  if (name.startsWith(q))                                 return T.PREFIX       + cov;

  const nameWords = words(name);
  if (orderedPrefixes(qTokens, nameWords))                return T.ORDERED      + cov;

  // Secondary fields join the pool here, acronyms whole rather than split.
  const pool = [...nameWords, ...(rec.poolWords ?? []), ...(rec.acronyms ?? [])];
  if (anyPrefixes(qTokens, pool))                         return T.ANY          + cov;

  // Name only, and below ANY: an initials run is weaker than a word prefix, so
  // it may add candidates but must never reorder ones that already matched.
  if (orderedInitials(qTokens, nameWords))                return T.INITIALS     + cov;

  // Word prefixes get an order-free tier (ORDERED → ANY) and initials get the
  // same, so "cs and ie" finds what "ie and cs" finds. Keeping it a tier lower
  // preserves the ordering signal where a name actually carries one.
  if (anyInitials(qTokens, nameWords))                    return T.INITIALS_ANY + cov;

  if (name.includes(q))                                   return T.LOOSE        + cov;

  for (const f of rec.loose ?? []) {
    if (!f.text) continue;
    if (f.text.includes(q) || (f.slug && f.text.includes(q.replace(/\s+/g, "_"))))
      return T.LOOSE - f.penalty + cov;
  }

  return -Infinity;
}

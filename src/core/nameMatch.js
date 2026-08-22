// ═══════════════════════════════════════════════════════════════════
// NAME MATCHING  (pure — no React, no I/O, no institution knowledge)
//
// The primitives behind every "type a name, get the thing" box in NU Map:
// how a query token matches a word, how initials stand for a run of words,
// and how much of a name a query accounts for.
//
// They were written for program search (src/core/searchRank.js) and measured
// there over 7,146 queries. They moved here VERBATIM when the data surface
// needed the same matching over courses, professors, subjects and NUpath
// codes — see docs/data-search-design.md. Nothing in this file knows what a
// program, a course or Northeastern is; it matches strings against strings.
//
// Two rules for anything added here:
//   1. It must be a function of (query, candidate strings) and nothing else.
//      A tiebreak that reads a domain field belongs with that domain's ranker.
//   2. The tier table is shared. A new tier reorders every search in the app
//      at once, so it needs the same kind of measurement the existing ones got.
// ═══════════════════════════════════════════════════════════════════

/**
 * Tier floors. The gaps are wide enough that coverage (0–COV_MAX) never lets a
 * weaker tier overtake a stronger one.
 *
 * Named for what the query DID, not for what kind of thing it matched, so the
 * same ladder serves a course title and a degree name.
 */
export const T = {
  EXACT:        8000,  // the whole name
  ACRONYM_CODE: 7500,  // "cs" backed by an official code (BSCS)
  ACRONYM:      7000,  // "cs" as derived initials
  PREFIX:       6000,  // "computer sci" → Computer Science…
  ORDERED:      5000,  // every query word starts a name word, in order
  ANY:          4000,  // …in any order, secondary fields included ("cs boston")
  INITIALS:     3000,  // a token stands for a run of name words ("ie and cs")
  INITIALS_ANY: 2500,  // …in any order ("cs and ie")
  LOOSE:        2000,  // mid-word, or a hit on a slug / grouping label
  FUZZY:       -1000,  // dropped-letter fallback
};

/** Ceiling on the within-tier coverage bonus; must stay under the tier gap. */
export const COV_MAX = 400;

/** Are all chars of q present in s in order (allows dropped/extra letters)? */
export function isSubsequence(q, s) {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

export function words(s) {
  return s.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Is every query token the start of some word in `pool`, in order? */
export function orderedPrefixes(qTokens, pool) {
  let i = 0;
  for (const w of pool) {
    if (i < qTokens.length && w.startsWith(qTokens[i])) i++;
  }
  return i === qTokens.length;
}

/** Is every query token the start of some word in `pool`, in any order? */
export function anyPrefixes(qTokens, pool) {
  return qTokens.every(t => pool.some(w => w.startsWith(t)));
}

/**
 * Words that carry no initial. Deliberately a copy of programNaming's set
 * rather than an import: core may not reach into an adapter, and this list is
 * about English, not about Northeastern's slugs.
 */
export const CONNECTORS = new Set(['and', 'of', 'in', 'with', 'for', 'the', 'to', 'a', 'an', 'on', 'at']);

/**
 * Like orderedPrefixes, but a token may instead be the initials of a run of
 * consecutive name words — "ie and cs" over Industrial Engineering and
 * Computer Science. Gaps between tokens are allowed, as in orderedPrefixes.
 *
 * Memoised over (token, word) because a token can be spent two ways, so the
 * search backtracks; the grid is at most ~6 × ~15, and the whole rank stays
 * near a millisecond over ~1.5k options.
 */
export function orderedInitials(qTokens, nameWords) {
  const seen = new Map();
  const go = (qi, wi) => {
    if (qi === qTokens.length) return true;
    if (wi >= nameWords.length) return false;
    const key = `${qi},${wi}`;
    if (seen.has(key)) return seen.get(key);
    const t = qTokens[qi];
    let ok = nameWords[wi].startsWith(t) && go(qi + 1, wi + 1);

    // A run must open on a real word: without this, "…and Biology" reads "ab".
    if (!ok && t.length >= 2 && !CONNECTORS.has(nameWords[wi]) && nameWords[wi][0] === t[0]) {
      let li = 1, wj = wi + 1;
      while (wj < nameWords.length && li < t.length) {
        // Skipped inside a run, so "ece" spans "Electrical and Computer Engineering".
        if (CONNECTORS.has(nameWords[wj])) { wj++; continue; }
        if (nameWords[wj][0] !== t[li]) break;
        li++; wj++;
        if (li === t.length && go(qi + 1, wj)) { ok = true; break; }
      }
    }

    if (!ok) ok = go(qi, wi + 1);   // this word matches nothing; move past it
    seen.set(key, ok);
    return ok;
  };
  return go(0, 0);
}

/** orderedInitials without the ordering: each token has to land somewhere. */
export function anyInitials(qTokens, nameWords) {
  return qTokens.every(t => orderedInitials([t], nameWords));
}

/**
 * How much of the name the query accounts for, 0–COV_MAX.
 * The bonus that pushes combined and qualified names down inside a tier.
 * It rounds, so equal-ish names tie here and the caller's own tiebreak
 * settles them — which matters most for two-letter acronyms, where every
 * candidate's ratio is small and close.
 */
export function coverage(q, name) {
  if (!name) return 0;
  return Math.round(COV_MAX * Math.min(q.length / name.length, 1));
}

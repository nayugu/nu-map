// ═══════════════════════════════════════════════════════════════════
// SEARCH RANK  (pure — order program search results by closeness)
//
// A plain substring filter returns matches in catalog order, so searching
// "computer science" buries "Computer Science, BSCS" under every combined
// "Computer Science and …" program — two thirds of the undergrad catalog.
//
// ## Coverage, not label length
//
// The fix is to score how much of a program's *name* the query accounts for:
// "computer science" covers all of "Computer Science" but 57% of "Computer
// Science and Biology" and 30% of "…and Speech-Language Pathology and
// Audiology". Coverage orders within a tier, so the plain program wins.
//
// This deliberately replaces an earlier `- label.length` tiebreak. That sank
// combined majors only because their labels happen to be longer, which is a
// proxy: a long plain name lost to a short combined one. Coverage also demotes
// "…with Concentration in Music Technology" and "…with Three Seas" for free,
// with no need to classify a program as combined — worth stressing, because
// combined majors cannot be reliably identified from the data we hold. The
// obvious rule ("split on and, is the left half a program?") misreads "Game
// Art and Animation, BFA" as combined and misses every "Business
// Administration and …", whose left half exists only as a minor.
//
// ## Acronyms
//
// Options carry an `acronyms` list (see programNaming.parseProgram). They all
// share one tier rather than resolving to a single program, because derived
// initials collide hard here — "cs" is equally Cinema Studies, Communication
// Studies and Computer Science. Inside the tier, an acronym that came from
// NU's own degree code (BSCS → cs) outranks one derived from initials, which
// is what puts Computer Science above Cinema Studies for "cs".
//
// Without this tier, "cs" matched mid-word: physi**cs**, economi**cs**,
// linguisti**cs** all outranked Computer Science.
//
// ## Abbreviated components
//
// An option's `acronyms` describe the program as a whole, so they only ever
// abbreviate one thing. That made combined majors inconsistent: "cs and math"
// found Computer Science and Mathematics (its BSCS code supplies "cs") while
// "ie and cs" found nothing at all — Industrial Engineering and Computer
// Science is BSIE, so "ie" resolved and "cs" matched no word. Worse, "ie and c"
// *did* work, because a bare "c" prefixes "Computer": typing one more letter
// made the program vanish. 19.1% of two-part programs were unreachable this way.
//
// So a query token may also stand for a *run* of consecutive name words, taken
// by their initials: "ie" ⇒ Industrial Engineering, "cs" ⇒ Computer Science.
// Two rules keep it honest, both of which cost real precision when measured
// without them:
//   1. a run may not START on a connector, or "…and Biology" reads as "ab";
//   2. runs are drawn from the name only — pooling in the degree and campus
//      let "bt" match Boston+Transfer and "bc" match Boston+cs.
// Connectors inside a run are skipped, so "ece" still spans "Electrical and
// Computer Engineering".
//
// It gets its own tier below ANY rather than joining ORDERED, because initials
// are weaker evidence than a word prefix and a lower tier can only add rows,
// never demote a match that already works. Over 7,146 queries this moves the
// top result for 0.5% of them, and spot-checking those says they are fixes:
// "ir" → International Relations, "cv" → Computer Vision, "jj" → Criminal
// Justice and Journalism.
//
// Word prefixes have always had an order-free tier (ORDERED → ANY), which is
// why "math and cs" worked as well as "cs and math"; initials mirror that with
// INITIALS → INITIALS_ANY, so "cs and ie" finds what "ie and cs" finds. That
// took reversed queries from 5% found to 100% and changed no top result at all.
// Order is kept as a *tier*, not a filter, because it still carries a little
// information: the catalog has exactly one reversed pair (Chemical Engineering
// and Environmental Engineering vs its mirror image) out of 298.
//
// Light typo tolerance: when strict matching is sparse, in-order subsequence
// matches ("compter science" → "computer science") are added, ranked below
// every strict match. Cheap — a few string ops over ~1.5k short labels.
// ═══════════════════════════════════════════════════════════════════

// Tier floors. The gaps are wide enough that coverage (0–100) never lets a
// weaker tier overtake a stronger one.
const T = {
  EXACT:        8000,  // the whole program name
  ACRONYM_CODE: 7500,  // "cs" backed by the BSCS degree code
  ACRONYM:      7000,  // "cs" as derived initials
  PREFIX:       6000,  // "computer sci" → Computer Science…
  ORDERED:      5000,  // every query word starts a name word, in order
  ANY:          4000,  // …in any order, campus and degree included ("cs boston")
  INITIALS:     3000,  // a token stands for a run of name words ("ie and cs")
  INITIALS_ANY: 2500,  // …in any order ("cs and ie")
  LOOSE:        2000,  // mid-word, or a hit on the folder slug / group heading
  FUZZY:       -1000,  // dropped-letter fallback
};

/** Ceiling on the within-tier coverage bonus; must stay under the tier gap. */
const COV_MAX = 400;

/** Are all chars of q present in s in order (allows dropped/extra letters)? */
function isSubsequence(q, s) {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}

function words(s) {
  return s.split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The fields to score against. Options that predate parseProgram (concentration
 * entries are just {path, label}) fall back to the label, so they still rank.
 */
function fieldsOf(o) {
  const label = (o.label ?? "").toLowerCase();
  return {
    label,
    name:     (o.name ?? "").toLowerCase() || label,
    degree:   (o.degree ?? "").toLowerCase(),
    location: (o.location ?? "").toLowerCase(),
    acronym:  (o.acronym ?? "").toLowerCase(),
    acronyms: (o.acronyms ?? []).map(a => a.toLowerCase()),
  };
}

/** Is every query token the start of some word in `pool`, in order? */
function orderedPrefixes(qTokens, pool) {
  let i = 0;
  for (const w of pool) {
    if (i < qTokens.length && w.startsWith(qTokens[i])) i++;
  }
  return i === qTokens.length;
}

/** Is every query token the start of some word in `pool`, in any order? */
function anyPrefixes(qTokens, pool) {
  return qTokens.every(t => pool.some(w => w.startsWith(t)));
}

/**
 * Words that carry no initial. Deliberately a copy of programNaming's set
 * rather than an import: core may not reach into an adapter, and this list is
 * about English, not about Northeastern's slugs.
 */
const CONNECTORS = new Set(['and', 'of', 'in', 'with', 'for', 'the', 'to', 'a', 'an', 'on', 'at']);

/**
 * Like orderedPrefixes, but a token may instead be the initials of a run of
 * consecutive name words — "ie and cs" over Industrial Engineering and
 * Computer Science. Gaps between tokens are allowed, as in orderedPrefixes.
 *
 * Memoised over (token, word) because a token can be spent two ways, so the
 * search backtracks; the grid is at most ~6 × ~15, and the whole rank stays
 * near a millisecond over ~1.5k options.
 */
function orderedInitials(qTokens, nameWords) {
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
function anyInitials(qTokens, nameWords) {
  return qTokens.every(t => orderedInitials([t], nameWords));
}

/**
 * How much of the program's name the query accounts for, 0–COV_MAX.
 * The bonus that pushes combined and qualified programs down inside a tier.
 * It rounds, so equal-ish names tie here and the name-length tiebreak in
 * rankOptions settles them — which matters most for two-letter acronyms,
 * where every candidate's ratio is small and close.
 */
function coverage(q, name) {
  if (!name) return 0;
  return Math.round(COV_MAX * Math.min(q.length / name.length, 1));
}

function scoreOption(o, q, qTokens) {
  const f = fieldsOf(o);
  if (!f.name) return -Infinity;
  const cov = coverage(q, f.name);

  if (f.name === q || f.label === q)                      return T.EXACT   + cov;

  // The degree code is NU's own abbreviation, so it settles acronym
  // collisions: for "cs", Computer Science (BSCS) sits above Cinema Studies,
  // whose "cs" is only the initials we derived.
  if (f.degree === q || f.acronym === q)                  return T.ACRONYM_CODE + cov;
  if (f.acronyms.includes(q))                             return T.ACRONYM      + cov;

  if (f.name.startsWith(q))                               return T.PREFIX  + cov;

  const nameWords = words(f.name);
  if (orderedPrefixes(qTokens, nameWords))                return T.ORDERED + cov;

  // Acronyms join the pool here so "cs oakland" and "cs bscs" resolve.
  const all = [...nameWords, ...words(f.degree), ...words(f.location), ...f.acronyms];
  if (anyPrefixes(qTokens, all))                          return T.ANY     + cov;

  // Name only, and below ANY: an initials run is weaker than a word prefix,
  // so it may add candidates but must never reorder ones that already matched.
  if (orderedInitials(qTokens, nameWords))                return T.INITIALS + cov;

  // Word prefixes get an order-free tier (ORDERED → ANY) and initials now get
  // the same, so "cs and ie" finds what "ie and cs" finds. Keeping it a tier
  // lower preserves the ordering signal where a name actually carries one.
  if (anyInitials(qTokens, nameWords))                    return T.INITIALS_ANY + cov;

  if (f.name.includes(q))                                 return T.LOOSE   + cov;
  const folder = (o.folder ?? "").toLowerCase();
  if (folder && (folder.includes(q) || folder.includes(q.replace(/\s+/g, "_"))))
    return T.LOOSE - 100 + cov;
  if ((o.grp ?? "").toLowerCase().includes(q))            return T.LOOSE - 200 + cov;

  return -Infinity;
}

/** Exact form of what coverage approximates, for resolving its rounding ties. */
function nameLen(o) {
  return (o.name ?? o.label ?? "").length;
}

/** Boston is the main campus, so it leads; the rest stay alphabetical. */
function campusRank(o) {
  return (o.location ?? "").toLowerCase() === "boston" ? 0 : 1;
}

/**
 * A degree outranks a certificate when everything else ties. Searching
 * "computer science" on the grad side otherwise opens on the graduate
 * certificate purely because "C" sorts before "M" and "P".
 */
function credentialRank(o) {
  return /certificate|minor/i.test(o.degree ?? "") ? 1 : 0;
}

/**
 * Among otherwise-equal matches, prefer BS (Bachelor of Science) over BA
 * (Bachelor of Arts); neutral for every other degree type. Reads the parsed
 * degree when there is one, else sniffs the label/folder for a degree token.
 */
function degreePref(o) {
  const d = (o.degree ?? "").toLowerCase();
  if (d) return d.startsWith("bs") ? 1 : d.startsWith("ba") ? -1 : 0;
  const s = `${o.label ?? ""} ${o.folder ?? ""}`.toLowerCase();
  if (/(^|[\s_])bs/.test(s)) return 1;
  if (/(^|[\s_])ba/.test(s)) return -1;
  return 0;
}

/**
 * Rank search options against a query, best first.
 * @param {Array<{path, label, name?, degree?, acronyms?, location?, folder?, grp?}>} options
 * @param {string} query
 * @param {number} [limit=60]
 * @returns {Array} the matching options, ordered by closeness (capped at limit)
 */
export function rankOptions(options, query, limit = 60) {
  const q = (query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const qTokens = words(q);

  const scored = [];
  for (const o of options) {
    const s = scoreOption(o, q, qTokens);
    if (s > -Infinity) scored.push({ o, s });
  }

  // Typo fallback only when strict matches are sparse, so normal searches stay clean.
  if (scored.length < 5 && q.length >= 3) {
    const seen = new Set(scored.map(x => x.o.path));
    for (const o of options) {
      if (seen.has(o.path)) continue;
      const hay = (o.name ?? o.label ?? "").toLowerCase();
      if (isSubsequence(q, hay)) scored.push({ o, s: T.FUZZY - hay.length });
    }
  }

  scored.sort((a, b) =>
    b.s - a.s
    || nameLen(a.o) - nameLen(b.o)                              // tighter match first
    || campusRank(a.o) - campusRank(b.o)                        // Boston first,
    || (a.o.location || "").localeCompare(b.o.location || "")   // then by campus
    || credentialRank(a.o) - credentialRank(b.o)                // degrees over certificates
    || degreePref(b.o) - degreePref(a.o)                        // then BS before BA
    || (a.o.label || "").localeCompare(b.o.label || ""));
  return scored.slice(0, limit).map(x => x.o);
}

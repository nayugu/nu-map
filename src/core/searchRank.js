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

// ## Where the matching itself lives
//
// The tier ladder and the primitives (word prefixes, initial-runs, coverage)
// moved to core/nameMatch.js, and the order the tiers are tried in moved to
// core/rankRecords.js, when the /data surface needed the same matching over
// courses, professors, subjects and NUpath codes. Everything measured above
// still holds — the extraction was behaviour-neutral, and this file's unit
// test is unchanged from before it, which is the proof.
//
// What stays here is the part that is genuinely about PROGRAMS: which of a
// program's strings play which matching role, and the tiebreak chain that
// settles otherwise-equal matches (Boston first, degrees over certificates,
// BS over BA).
import { T, words, isSubsequence } from "./nameMatch.js";
import { normalizeQuery, scoreRecord } from "./rankRecords.js";

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

/**
 * A program, described as matching ROLES rather than as a program — the record
 * shape scoreRecord understands (see core/rankRecords.js for what each role
 * does). This mapping is the whole of what makes program search program-shaped.
 *
 * `degree` and `acronym` are codes because they are NU's own abbreviations;
 * derived initials go in `acronyms`, one tier below. Campus and degree words
 * are admitted to the ANY tier only, so "cs boston" resolves without letting
 * "boston" match a program on its own.
 */
function recordOf(o) {
  const f = fieldsOf(o);
  return {
    name:      f.name,
    exact:     [f.label],
    codes:     [f.degree, f.acronym],
    acronyms:  f.acronyms,
    poolWords: [...words(f.degree), ...words(f.location)],
    loose: [
      { text: (o.folder ?? "").toLowerCase(), penalty: 100, slug: true },
      { text: (o.grp ?? "").toLowerCase(),    penalty: 200 },
    ],
  };
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
  const { q, qTokens } = normalizeQuery(query);
  if (!q) return [];

  const scored = [];
  for (const o of options) {
    const s = scoreRecord(recordOf(o), q, qTokens);
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

// ═══════════════════════════════════════════════════════════════════
// Repeatability parser — extracts "May be repeated …" from catalog text.
//
// The catalog's cb_desc element (scraped verbatim into `description`) is
// the only place repeatability appears — verified against live pages of
// several subjects: it is never a separate courseblockextra row. ~12% of
// courses carry the sentence, in ~100 distinct phrasings that decompose
// into a count clause and an optional credit-hour cap clause.
//
// Semantics: "may be repeated N times" means N repeats BEYOND the first
// take. The catalog states this itself ("May be repeated once for a total
// of two completions"), so `max` below is TOTAL completions = N + 1.
//
// Shared by scripts/scrape-catalog.js (writes repeatable/repeatMax/
// repeatMaxSH at scrape time — the canonical path per CLAUDE.md) and by
// courseNorm.js (derives the same fields from the description of already-
// shipped data until a scrape that includes them lands).
// ═══════════════════════════════════════════════════════════════════

const UNITS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50 };

/** "3" | "three" | "thirty two" | "thirty-two" → number (or null). */
function toNumber(s) {
  const w = s.toLowerCase().replace(/-/g, " ").trim();
  if (/^\d+$/.test(w)) return parseInt(w, 10);
  const parts = w.split(/\s+/);
  if (parts.length === 1) return UNITS[parts[0]] ?? TENS[parts[0]] ?? null;
  if (parts.length === 2 && TENS[parts[0]] != null && UNITS[parts[1]] != null) {
    return TENS[parts[0]] + UNITS[parts[1]];
  }
  return null;
}

const NUM_WORD = String.raw`\d+|[a-z]+(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?`;

// Count clause, anchored on "repeated" so the "once" in "taken more than
// once" can never be misread as a limit. "repeated\s*" (not "\s+") also
// absorbs the catalog's own typo "May be repeatedwithout limit".
const RE_UNLIMITED = /repeated\s*without limit/i;
const RE_COUNT = new RegExp(
  String.raw`repeated\s*(?:up to\s+)?(?:(once|twice|thrice)\b|(${NUM_WORD})\s+times?\b)`,
  "i"
);

// Credit-hour cap clause: "for a maximum of 12 semester hours", "for up to
// 4 total credits", "up to a total of 12 SH", "for a maximum of six hours",
// "for a maximum of thirty two semester hours"… The unit word is required,
// so counts like "up to three times" can never match. (The single "quarter
// hours" course is stored as-is — no unit conversion.)
const RE_CAP = new RegExp(
  String.raw`(?:maximum of|total of|up to)\s+(?:a\s+)?(${NUM_WORD})\s+(?:total\s+)?(?:semester|credit|quarter)?\s*(?:hours?|credits?|sh)\b`,
  "i"
);

/**
 * Parse repeatability from catalog description text.
 *
 * @param {string} description
 * @returns {{ max: number|null, maxSH: number|null } | null}
 *   null                → not repeatable (no repeat sentence found)
 *   { max: null, … }    → repeatable without a stated completion limit
 *   { max: N, … }       → repeatable up to N TOTAL completions (first take included)
 *   { maxSH: N }        → stated ceiling on total credit hours earned, if any
 */
export function parseRepeatability(description) {
  const d = (description || "").replace(/\s+/g, " ");
  const trig = d.match(/may be (?:repeated|taken more than once)/i);
  if (!trig) return null;

  // Work on the sentence containing the trigger, so a repeat sentence in one
  // course can't pick up numbers from neighbouring sentences.
  const tail = d.slice(trig.index);
  const sentence = (tail.match(/^[^.]*\./) ?? [tail])[0];

  let max = null; // total completions; null = no stated limit
  if (!RE_UNLIMITED.test(sentence)) {
    const m = sentence.match(RE_COUNT);
    if (m) {
      const repeats = m[1]
        ? { once: 1, twice: 2, thrice: 3 }[m[1].toLowerCase()]
        : toNumber(m[2]);
      if (repeats != null) max = repeats + 1;
    }
  }

  const cap = sentence.match(RE_CAP);
  const maxSH = cap ? toNumber(cap[1]) : null;

  return { max, maxSH };
}

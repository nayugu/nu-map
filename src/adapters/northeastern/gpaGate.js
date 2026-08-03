// ═══════════════════════════════════════════════════════════════════
// Description GPA-gate parser — "Requires a 3.500 GPA" and friends.
//
// A handful of courses state a cumulative-GPA prerequisite in the course
// DESCRIPTION rather than the Prerequisite(s) line, so the ref-level
// `minGrade` model can't express them. Exactly 3 of 7,966 courses corpus-
// wide (2026-08): BNSC 4971 at 3.500, ECON 4965 and PSYC 4965 at 3.333
// (which is B+ on NEU's scale — verified against the live descriptions,
// NOT a misparse). Two phrasings:
//     "Requires a 3.500 GPA."
//     "Requires minimum overall GPA of 3.333 and grade of A– or better…"
//
// Lives in src/, mirroring repeatability.js, and is shared by
// scripts/scrape-catalog.js (writes `minGPA` at scrape time — the
// canonical path per CLAUDE.md) and by courseNorm.js (derives the same
// value from the description of already-shipped data). That fallback is
// not redundant: when a subject's fetch fails, the scraper deliberately
// carries the PREVIOUS record forward, so a newly added field would stay
// missing on those courses until a later run happened to succeed —
// exactly what happened to BNSC on the first scrape after this shipped.
//
// The companion "and a grade of A– or better in <course>" clause on the
// two 4965s is deliberately not modelled: it gates on a specific other
// course, which belongs to the prereq tree, not to a GPA threshold.
// ═══════════════════════════════════════════════════════════════════

/**
 * @param {string} description  the catalog's course description
 * @returns {number|null} the required cumulative GPA, or null
 */
export function parseDescriptionGpaGate(description) {
  if (!description) return null;
  const m = /[Rr]equires?(?:\s+a)?(?:\s+minimum)?(?:\s+overall)?\s+(?:GPA\s+of\s+)?([0-9](?:\.[0-9]{1,3})?)\s*(?:GPA)?/
    .exec(description);
  if (!m) return null;
  // The matched span must actually name a GPA — "Requires 3 credits" must
  // never become a 3.0 gate.
  if (!/GPA|grade[- ]point/i.test(m[0])) return null;
  const v = parseFloat(m[1]);
  // Outside the scale it is a misparse, not a gate.
  return v >= 1 && v <= 4 ? v : null;
}

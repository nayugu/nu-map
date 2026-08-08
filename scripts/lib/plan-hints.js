/**
 * plan-hints.js — Northeastern's plan wording, read as evidence.
 *
 * Everything English- and CourseLeaf-shaped lives here, which is why it is not
 * in plan-binding.js: the solver must run correctly with no hints at all, just
 * less often decisively.
 *
 * The corpus these are cut against is 9,629 cells worded 1,353 distinct ways.
 * That number is the argument for every one of them being a HINT. Case is never
 * meaningful — one plan writes "MATH elective" and "Math elective" in adjacent
 * cells, and Mathematics and Philosophy writes "MATH 3001 to Math 4999" inside
 * a single sentence.
 *
 * Two kinds, and plan-binding.js treats them very differently:
 *
 *   admits   checkable against a requirement's actual course set, so it can
 *            delete an edge outright — "the Khoury bucket contains no MATH
 *            course" is a fact, not a guess
 *   prefers  wording only, so it is applied when free and dropped the moment
 *            it costs the assignment anything
 */

/**
 * Wording naming no requirement at all — roughly a quarter of the corpus.
 *
 * Parentheticals are advice, not constraint ("Elective (Dialogue of
 * Civilizations possible)"), so they are stripped before testing. "NUpath or
 * elective" belongs here too: NUpath is an attribute carried by courses rather
 * than a course list, so as a *course* requirement the cell is a free choice.
 */
const FREE_ELECTIVE = new RegExp(
  "^(?:(?:general|open|free|unrestricted|upper[\\s-]*division)?\\s*electives?"
  + "|nupath\\s+or\\s+elective)\\s*$", "i");

/** A leading subject code: "MATH elective", "PSYC interdisciplinary cluster". */
const LEADING = /^([A-Za-z]{2,6})\b/;

/**
 * A cell that states its own rule. Rare, and worth reading precisely because it
 * is not inference — the catalog printed the constraint. Both subject mentions
 * are matched independently and the second is optional, so "MATH 3001 to Math
 * 4999" and "MATH 3001-4999" are the same rule.
 */
const STATED_RANGE =
  /\b([A-Z]{2,6})\s*(\d{3,4})\s*(?:to|through|-|–|—)\s*(?:([A-Z]{2,6})\s*)?(\d{3,4})\b/i;

/**
 * Words carrying no identity. Every requirement is a "course" and half are an
 * "elective", so leaving these in matches "Concentration course" to "Supporting
 * Course" on the strength of the word they share.
 *
 * This is a hand-written approximation of inverse document frequency. Deriving
 * IDF from the corpus of section titles would self-maintain through monthly
 * scrapes and grade the evidence rather than making it boolean — noted in
 * docs/sample-plan-design.md §4 as the intended replacement.
 */
const STOPWORDS = new Set([
  "course", "courses", "elective", "electives", "requirement", "requirements",
  "and", "or", "of", "the", "in", "a", "an", "for", "with", "any",
  "credits", "hours", "sh", "approved", "required", "additional", "other",
]);

const tokens = (s) => new Set(
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(/\s+/).filter(w => w && !STOPWORDS.has(w)));

const stripParenthetical = (s) => String(s ?? "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

/**
 * @param {Iterable<string>} subjects  the catalog's real subject codes
 * @param {{specAdmitsSubject: Function, specAdmitsRange: Function}} spec
 */
export function createPlanHints(subjects, { specAdmitsSubject, specAdmitsRange }) {
  const known = new Set([...subjects].map(s => String(s).toUpperCase()));

  const subjectOf = (label) => {
    const m = LEADING.exec(String(label ?? "").trim());
    if (!m) return null;
    const up = m[1].toUpperCase();
    // Validated against the real subject list rather than trusted from shape.
    // "Khoury Elective" and "Business elective" both look like this and neither
    // is a subject code; binding them to one that does not exist would filter
    // every requirement out and strand the cell.
    return known.has(up) ? up : null;
  };

  const rangeOf = (label) => {
    const m = STATED_RANGE.exec(String(label ?? ""));
    if (!m) return null;
    const subject = m[1].toUpperCase();
    if (!known.has(subject)) return null;
    // A second subject disagreeing with the first would be a cross-subject
    // range, which no requirement expresses — safer to read nothing.
    if (m[3] && m[3].toUpperCase() !== subject) return null;
    const start = parseInt(m[2], 10), end = parseInt(m[4], 10);
    return end >= start ? { subject, start, end } : null;
  };

  return {
    isFreeElective: (label) => FREE_ELECTIVE.test(stripParenthetical(label)),
    subjectOf,
    rangeOf,

    /** Facts. These delete edges. */
    admits(cell, obligation) {
      const label = cell.text ?? "";
      if (FREE_ELECTIVE.test(stripParenthetical(label))) return obligation.target === "~general";
      const range = rangeOf(label);
      if (range && obligation.spec) return specAdmitsRange(obligation.spec, range);
      const subject = subjectOf(label);
      if (subject && obligation.spec) return specAdmitsSubject(obligation.spec, subject);
      return true;
    },

    /**
     * Wording. Generous enough to catch "Khoury Elective" ~ "Khoury Approved
     * Electives" and strict enough to reject "Computing and social issues" ~
     * "Supporting Course", which share nothing but stopwords.
     */
    prefers(cell, obligation) {
      const a = tokens(cell.text), b = tokens(obligation.title);
      if (!a.size || !b.size) return false;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared += 1;
      return shared > 0 && shared >= Math.min(a.size, b.size) * 0.5;
    },
  };
}

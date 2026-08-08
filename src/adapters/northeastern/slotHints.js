// ═══════════════════════════════════════════════════════════════════
// NORTHEASTERN SLOT HINTS
//
// Reads Northeastern's Sample Plan of Study wording. Everything in here is
// English- and CourseLeaf-shaped, which is exactly why it is here and not in
// src/core/slotBinding.js: the solver must be able to run with no hints at all
// and still be correct, just less often decisive.
//
// The corpus these are cut against: 9,629 placeholder cells across 385 plans,
// worded 1,353 distinct ways. That number is the argument for keeping every
// one of these a HINT. They narrow a slot's domain and are dropped the moment
// they contradict the arithmetic — none of them is ever allowed to decide.
//
//   "General Elective"                                 → free
//   "MATH elective" / "Math elective" / "PSYC elective" → subject
//   "Course in the following range: MATH 3001 to Math 4999" → stated range
//   "Khoury Elective" ~ "Khoury Approved Electives"     → title
//
// Case is not meaningful and must not be treated as such: the same plan writes
// "MATH elective" and "Math elective" in adjacent cells, and Math and
// Philosophy writes "MATH 3001 to Math 4999" inside a single sentence.
// ═══════════════════════════════════════════════════════════════════

/**
 * Wording that names no requirement at all — a quarter of the corpus.
 *
 * "NUpath or elective" is here on purpose. NUpath is an attribute carried by
 * courses rather than a course list, so the cell is telling the student to
 * pick anything that fills a remaining attribute — which as far as a course
 * requirement goes is a free choice.
 */
const FREE_ELECTIVE = new RegExp(
  "^(?:"
  + "(?:general|open|free|upper[\\s-]*division|unrestricted)?\\s*electives?"
  + "|nupath\\s+or\\s+elective"
  + ")"
  // Departments append parenthetical advice — "Elective (Dialogue of
  // Civilizations possible)" — which changes nothing about the requirement.
  + "\\s*(?:\\([^)]*\\))?\\s*$",
  "i",
);

/**
 * A leading subject code: "MATH elective", "PSYC interdisciplinary cluster".
 *
 * Validated against the real subject list rather than trusted from shape
 * alone. "Khoury Elective" and "Business elective" both look like this and
 * neither is a subject code, and binding them to a subject that does not exist
 * would filter every requirement out and silently strand the slot.
 */
const LEADING_TOKEN = /^([A-Za-z]{2,6})\b/;

/**
 * A cell that states its own constraint. Rare, and worth reading exactly
 * because it is not inference at all — the catalog printed the rule.
 *
 * The two subject mentions are matched independently and the second is
 * optional: "MATH 3001 to Math 4999" and "MATH 3001-4999" are the same rule.
 */
const STATED_RANGE =
  /\b([A-Z]{2,6})\s*(\d{3,4})\s*(?:to|through|-|–|—)\s*(?:([A-Z]{2,6})\s*)?(\d{3,4})\b/i;

/**
 * Words that carry no identity. Every requirement is a "course" and half are
 * an "elective", so leaving these in would match "Concentration course" to
 * "Supporting Course" on the strength of the word they share.
 */
const STOPWORDS = new Set([
  "course", "courses", "elective", "electives", "requirement", "requirements",
  "and", "or", "of", "the", "in", "a", "an", "for", "with", "any",
  "credits", "hours", "sh", "approved", "required", "additional", "other",
]);

const tokens = (s) =>
  new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w)));

/**
 * NUpath codes a cell asks for, e.g. "General elective (NUpath DD)".
 *
 * Roughly 150 cells name one, and they are a constraint of a different KIND to
 * everything else here: an attribute the course must carry, not a set of
 * courses. "General elective (IC, DD)" is a free elective plus two attributes,
 * so it layers on top of a binding rather than replacing one.
 *
 * The reason this is not a bare two-letter search: **CE collides**. Ninety-odd
 * cells read "EE or CE fundamentals", "CE Fundamentals", "EE/CE Fundamental" —
 * Computer and Civil Engineering, not NUpath's Capstone code. A naive match is
 * wrong on about four in five of its CE hits.
 *
 * So codes are read in only two situations, both of which say "these are
 * attributes" out loud:
 *   1. the cell names NUpath, in which case codes anywhere in it count;
 *   2. a parenthetical made ENTIRELY of codes — "(EI, WI, CE)", "(SI)". The
 *      all-of-it test is what keeps "Elective (Dialogue of Civilizations
 *      possible)" from being read as anything at all.
 *
 * "COMM WI course" is deliberately missed. A bare code with no parenthetical
 * and no mention of NUpath is not distinguishable from a subject or an
 * abbreviation, and a false attribute silently narrows a picker to nothing.
 */
const NAMES_NUPATH = /nu\s*path/i;
const PARENTHETICAL = /\(([^)]*)\)/g;

function readAttributes(label, codes) {
  const text = String(label ?? "");
  const found = [];
  const take = (s) => {
    for (const w of s.toUpperCase().match(/\b[A-Z]{2}\b/g) ?? []) {
      if (codes.has(w) && !found.includes(w)) found.push(w);
    }
  };

  if (NAMES_NUPATH.test(text)) {
    take(text);
    return found;
  }
  for (const [, inner] of text.matchAll(PARENTHETICAL)) {
    const parts = inner.split(",").map(p => p.trim()).filter(Boolean);
    // Every part must be a code, or this parenthetical is prose.
    if (parts.length && parts.every(p => codes.has(p.toUpperCase()))) take(inner);
  }
  return found;
}

/**
 * Build the hint set.
 *
 * @param {Iterable<string>} subjects    the catalog's real subject codes
 * @param {Iterable<string>} attributes  the institution's attribute codes (NUpath)
 * @returns {import('../../core/slotBinding.js').SlotHints}
 */
export function createSlotHints(subjects = [], attributes = []) {
  const known = new Set([...subjects].map(s => String(s).toUpperCase()));
  const attrCodes = new Set([...attributes].map(a => String(a).toUpperCase()));

  return {
    isFreeElective: (label) => {
      const t = String(label ?? "").trim();
      // "General elective (NUpath DD)" is still a free elective — the codes
      // constrain which one, not whether the requirement is open.
      return FREE_ELECTIVE.test(t)
        || FREE_ELECTIVE.test(t.replace(PARENTHETICAL, "").replace(/\s+/g, " ").trim());
    },

    attributesOf: (label) => readAttributes(label, attrCodes),

    subjectOf: (label) => {
      const m = LEADING_TOKEN.exec(String(label ?? "").trim());
      if (!m) return null;
      const up = m[1].toUpperCase();
      return known.has(up) ? up : null;
    },

    rangeOf: (label) => {
      const m = STATED_RANGE.exec(String(label ?? ""));
      if (!m) return null;
      const subject = m[1].toUpperCase();
      if (!known.has(subject)) return null;
      // A second subject that disagrees with the first is a range across
      // subjects, which no requirement expresses — safer to read nothing.
      if (m[3] && m[3].toUpperCase() !== subject) return null;
      const start = parseInt(m[2], 10);
      const end   = parseInt(m[4], 10);
      return end >= start ? { subject, start, end } : null;
    },

    /**
     * Do the slot's words and the requirement's title name the same thing?
     *
     * Deliberately generous on one side and strict on the other: it must catch
     * "Khoury Elective" ~ "Khoury Approved Electives" while rejecting
     * "Computing and social issues" ~ "Supporting Course". Shared content
     * words carry it, and being the weakest rung it is the first one dropped
     * when it disagrees with the arithmetic.
     */
    titleMatches: (label, title) => {
      const a = tokens(label);
      const b = tokens(title);
      if (!a.size || !b.size) return false;
      let shared = 0;
      for (const w of a) if (b.has(w)) shared += 1;
      if (!shared) return false;
      return shared >= Math.min(a.size, b.size) * 0.5;
    },
  };
}

export default createSlotHints;

// ═══════════════════════════════════════════════════════════════════
// COURSE CODE PARSING  (pure — no React, no I/O)
//
// Turns whatever a student types into course codes. Separators are
// irrelevant because letters and digits already delimit each other, so
// all of these mean the same thing:
//
//   "phys 1163 phys1173"      "PHYS1163,PHYS1173"
//   "phys1163 phys 1173"      "phys1163/phys1173"
//   "phys 1163 1173"          ← subject carries forward
//
// This is what lets ONE input serve both jobs in the substitutions
// panel: one code asks "what can I take instead of this?", two codes
// state a substitution outright, which is what the old two-field form
// existed to collect.
// ═══════════════════════════════════════════════════════════════════

/**
 * A subject is 2–5 letters; a course number is exactly 4 digits.
 *
 * Both parts are optional-ish on purpose: the subject may be absent when it
 * carries forward from the previous code ("phys 1163 1173"), and a bare subject
 * with no number is a partial the student is still typing.
 */
const TOKEN = /([A-Za-z]{2,5})|(\d{4})/g;

/**
 * Extract course codes, in order, de-duplicated.
 *
 * Returns `["PHYS 1163", "PHYS 1173"]`. A trailing subject with no number yet
 * — mid-typing — is reported separately as `partialSubject` so the caller can
 * fall back to fuzzy title search instead of showing nothing.
 *
 * Numbers are never invented: a 4-digit number with no subject anywhere before
 * it is dropped, because "1163" alone is ambiguous across ~200 subjects.
 */
export function parseCourseCodes(text) {
  const src = String(text ?? "");
  const codes = [];
  const seen = new Set();
  let subject = null;          // most recent subject, for carry-forward
  let pendingSubject = null;   // a subject still waiting for its number
  let sawNumberFor = false;

  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(src))) {
    if (m[1]) {
      subject = m[1].toUpperCase();
      pendingSubject = subject;
      sawNumberFor = false;
      continue;
    }
    const number = m[2];
    if (!subject) continue;                 // bare number, nothing to attach it to
    const code = `${subject} ${number}`;
    if (!seen.has(code)) { seen.add(code); codes.push(code); }
    sawNumberFor = true;
    pendingSubject = null;
  }

  return {
    codes,
    // Only a *trailing* subject counts as partial — "phys 1163 ch" is still
    // typing a second code, while "phys 1163" is complete.
    partialSubject: pendingSubject && !sawNumberFor ? pendingSubject : null,
  };
}

/**
 * Interpret the parse as an intent for the substitutions panel.
 *
 *   0 codes  → "search"      fall back to fuzzy matching on code and title
 *   1 code   → "suggest"     show what can be taken instead
 *   2+ codes → "pair"        the student stated a substitution: first → rest
 *
 * With three or more codes the extras become additional pairs from the first
 * course, which is how a set-to-set rule gets typed in one go.
 */
export function readSubstitutionIntent(text) {
  const { codes, partialSubject } = parseCourseCodes(text);
  if (codes.length === 0) return { kind: "search", codes, partialSubject };
  if (codes.length === 1) return { kind: "suggest", from: codes[0], codes, partialSubject };
  return { kind: "pair", from: codes[0], to: codes.slice(1), codes, partialSubject };
}

/**
 * Normalise a search query so a code typed without a space still matches.
 *
 * Course haystacks are built as "phys 1111", so a student typing "phys1111"
 * matches nothing under a plain substring test. Inserting the boundary makes
 * both spellings equivalent — the same tolerance `parseCourseCodes` already has,
 * extended to fuzzy title/code search.
 *
 *   "phys1111"  -> "phys 1111"
 *   "phys 1111" -> "phys 1111"   (unchanged)
 *   "organic"   -> "organic"     (untouched)
 */
export function normalizeCodeQuery(text) {
  return String(text ?? "")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * prereq-parse.js — catalog prerequisite/corequisite text → structured trees.
 *
 * Extracted from scrape-catalog.js so the logic is importable by tests
 * (test/unit/scrape-catalog-merge.test.js had to MIRROR the merge logic
 * inline, and mirrored copies drift — the nupath.js lesson). Pure text
 * functions, no DOM, no deps.
 *
 * Pipeline per course block:
 *   extractConcurrentCourses(text)  → marks "(may be taken concurrently)" as [CONC]
 *   parsePrereqText(cleaned)        → flat token array for evalPrereqTree
 *
 * Grade gates: the catalog states a minimum grade on ~95% of prereq clauses
 * ("CS 3500 with a minimum grade of C-"), and 49% gate above a bare pass —
 * NRSG is mostly B/C, co-op gates are "minimum grade of S". These used to be
 * DELETED here; they now ride each ref as `minGrade` and are evaluated only
 * against grades the user has entered (src/core/gradeSystem.js) — an
 * unentered grade satisfies everything, so shipping minGrade changes nothing
 * by default.
 *
 * The catalog's word order is invariably
 *   "SUBJ 1234 (may be taken concurrently) with a minimum grade of X"
 * (verified across CS/MATH/CHEM/PHYS/BIOL, zero counter-examples), so the
 * [CONC] marker always lands adjacent to the number and [MIN:X] follows it.
 */

// ── Mark "(may be taken concurrently)" prereqs inline ────────────────────────
// Concurrent prereqs stay in the prereq tree (not coreqs) but get flagged with
// concurrent:true so the evaluator allows same-semester co-placement.
// Returns { cleaned: string, concurrent: [] }  (concurrent[] kept for call-site compat)
export function extractConcurrentCourses(text) {
  const cleaned = text
    .replace(/([A-Z]{2,6}\s+\d{4}[A-Z]?)\s*\(may be taken concurrently\)/gi, '$1[CONC]')
    .replace(/\s+/g, ' ').trim();
  return { cleaned, concurrent: [] };
}

// ── Prerequisite text → structured array (best-effort) ───────────────────────
export function parsePrereqText(text) {
  if (!text) return [];

  // Keep grade requirements as [MIN:X] markers; unknown symbols fall back to
  // the old delete-it behaviour rather than corrupting the course match.
  let cleaned = text
    .replace(/with a minimum grade of ([A-FS][+-]?)(?![a-z])/gi,
             (_, g) => `[MIN:${g.toUpperCase()}]`)
    .replace(/with a minimum grade of [A-Z][+-]?/gi, '')
    // Drop the catalog's grade-scope qualifier "(Graduate)" (and its
    // "(Undergraduate)" twin). It trails a grade on ~30 courses — "IE 5374
    // with a minimum grade of C (Graduate)" — to say which student level the
    // gate applies to, which we don't model. Left in, it became an empty "( )"
    // group joined by a spurious "And". It is the ONLY non-course parenthetical
    // in the catalog (verified 2026-08 across all subjects), so stripping the
    // literal token is safe and removes the empty-group artifact at its source.
    .replace(/\((?:Graduate|Undergraduate)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing period if present
  cleaned = cleaned.replace(/\.\s*$/, '');

  // Phrase-only prereq (no course code): keep the whole thing as ONE note.
  // Splitting on "and"/"or" here would fragment a natural phrase — "junior or
  // senior standing" would lose "junior" — so only the course-bearing path
  // below treats and/or as boolean operators.
  if (!COURSE_CODE.test(cleaned)) {
    const note = cleanNote(cleaned);
    return note && isCondition(note) ? [{ note }] : [];
  }

  // Tokenize: split on "and"/"or" while preserving them, and handle parens.
  // [CONC] (from extractConcurrentCourses) sets concurrent:true on the ref;
  // [MIN:X] sets minGrade.
  const coursePattern = /([A-Z]{2,6})\s+(\d{4}[A-Z]?)(\[CONC\])?(?:\s*\[MIN:([A-FS][+-]?)\])?/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = coursePattern.exec(cleaned)) !== null) {
    // Check text between last match and this match for operators and parens
    const between = cleaned.slice(lastIndex, match.index);
    extractOperators(between, parts);

    const ref = { subject: match[1], number: match[2] };
    if (match[3]) ref.concurrent = true;
    if (match[4]) ref.minGrade = match[4];
    parts.push(ref);
    lastIndex = coursePattern.lastIndex;
  }

  // Check for trailing operators after last course ref
  if (lastIndex < cleaned.length) {
    extractOperators(cleaned.slice(lastIndex), parts);
  }

  // Post-process: insert implicit "And" between adjacent ) and ( with no operator
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(parts[i]);
    if (i < parts.length - 1) {
      const cur  = parts[i];
      const next = parts[i + 1];
      const curIsEnd  = cur === ')' || (typeof cur === 'object' && cur.subject);
      const nextIsStart = next === '(' || (typeof next === 'object' && next.subject);
      if (curIsEnd && nextIsStart) {
        result.push('And');
      }
    }
  }
  return result;
}

// A prereq clause is often satisfiable by something that is NOT a course —
// "permission of instructor", "instructor's approval", "graduate program
// admission", "consent of the department". These used to be dropped, which
// is exactly what left an empty "( )" group when the phrase sat inside
// parens (e.g. "ACCT 6230 and (permission of the graduate program
// director)"). We now keep them as informational { note } leaves so the
// expression stays balanced and the condition is shown. The signal words
// gate capture so ordinary connective text isn't turned into noise.
// Words that reliably mark a non-course GATING condition. Deliberately the
// action/status vocabulary (permission/consent/approval/admission/standing/
// candidacy/…), NOT loose nouns like bare "department" or "faculty" — those
// appear in ordinary prose ("See department for details") and caused false
// notes. Real department/dean/faculty conditions still match via the action
// word they pair with ("consent of the department" → consent).
const NOTE_SIGNAL = /\b(permission|consent|approv|admission|admitted|instructor|professor|program\s+director|advis|coordinator|standing|candidacy|enrollment)/i;

// Some gating conditions are stated as a named check/test with a required
// score rather than a keyword — "Dissertation Check with a score of REQ" (the
// PhD dissertation-continuation gate on ~30 courses), "French Placement Test
// with a score of 411", "Biotechnology Lab Skills with a score of 80". They
// carry no NOTE_SIGNAL word, so they used to drop; and when one was the last
// OR-branch ("BIOE 9991 … or Dissertation Check with a score of REQ") that
// left a dangling "Or" in the tree. Capture the whole phrase as a note.
// Anchored (^…$) and with a letters-only name so it matches ONLY a standalone
// score gate: an embedded course code ("Placement in SPNS 3101 with a score
// of 3101") keeps SPNS 3101 as a real alternative course ref, and the bare
// "with a score of 3101" fragment left beside it is not itself captured.
const SCORE_GATE = /^[A-Za-z][A-Za-z '&/-]*\s+with a score of\s+\S+$/i;

// A phrase worth keeping as an informational { note } leaf: a recognized
// gating keyword, or a whole named-score gate.
const isCondition = (note) => NOTE_SIGNAL.test(note) || SCORE_GATE.test(note);

// Whether a prereq string is worth parsing at all. The catalog scraper used to
// gate ONLY on a course-code pattern, so a prereq that is nothing but a
// non-course condition — very common for grad courses whose sole prerequisite
// is "Graduate program admission" — was discarded before it could reach the
// { note } path, leaving those courses with no prereq shown. Parse when the
// text names a course OR carries a recognized non-course phrase.
const COURSE_CODE = /[A-Z]{2,6}\s+\d{4}/;
export function hasPrereqSignal(text) {
  return !!text && (COURSE_CODE.test(text) || NOTE_SIGNAL.test(text) || /with a score of/i.test(text));
}

function cleanNote(raw) {
  const s = (raw || '')
    .replace(/\[(?:CONC|MIN:[^\]]*)\]/g, ' ')   // stray parse markers
    .replace(/[;,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Drop a leading field label if the catalog text carried one through.
    .replace(/^(?:prerequisites?|prereqs?|corequisites?|coreqs?)\s*:?\s*/i, '')
    .replace(/^[-–—:.\s]+/, '')
    .replace(/[-–—:.\s]+$/, '');
  return /[a-z]{3,}/i.test(s) ? s : null;       // needs real words, not punctuation
}

function extractOperators(text, parts) {
  const normalized = text.replace(/;/g, ' ').trim();
  if (!normalized) return;
  const opPattern = /(\(|\)|(?:^|\s)(and|or)(?:\s|$))/gi;
  let m;
  let last = 0;
  const emitNote = chunk => {
    const note = cleanNote(chunk);
    if (note && isCondition(note)) parts.push({ note });
  };
  while ((m = opPattern.exec(normalized)) !== null) {
    emitNote(normalized.slice(last, m.index));   // non-course words before this operator
    const token = (m[2] || m[1]).trim();
    if (token === '(') parts.push('(');
    else if (token === ')') parts.push(')');
    else if (/^or$/i.test(token)) parts.push('Or');
    else if (/^and$/i.test(token)) parts.push('And');
    last = opPattern.lastIndex;
  }
  emitNote(normalized.slice(last));              // …and any trailing phrase
}

export function parseCoreqText(text) {
  if (!text) return [];
  const refs = [];
  const coursePattern = /([A-Z]{2,6})\s+(\d{4}[A-Z]?)/g;
  let match;
  while ((match = coursePattern.exec(text)) !== null) {
    refs.push({ subject: match[1], number: match[2] });
  }
  return refs;
}

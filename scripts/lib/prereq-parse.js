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
    .replace(/\s+/g, ' ')
    .trim();

  // Strip trailing period if present
  cleaned = cleaned.replace(/\.\s*$/, '');

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
const NOTE_SIGNAL = /\b(permission|consent|approv|admission|admitted|instructor|professor|faculty|department|program\s+director|dean|advis|coordinator|standing|enrollment)/i;

function cleanNote(raw) {
  const s = (raw || '')
    .replace(/\[(?:CONC|MIN:[^\]]*)\]/g, ' ')   // stray parse markers
    .replace(/[;,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
    if (note && NOTE_SIGNAL.test(note)) parts.push({ note });
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

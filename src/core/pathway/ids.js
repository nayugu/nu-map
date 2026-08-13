// ═══════════════════════════════════════════════════════════════════
// PATHWAY IDS — the one place the three course-id spellings meet.
//
// Three conventions exist in this codebase and all three are load-bearing:
//
//   "CS 5800"   catalog / equivalence-index / every published PlusOne source
//   "CS5800"    planner id — the key of `placements`, drag ids, share links
//   "CS5800#2"  repeat instance (see core/repeatInstances.js)
//
// Pathway DATA is authored in the first form, because that is how every
// college prints it and a reviewer has to be able to check a file against a
// PDF. Everything downstream of the loader speaks the second. Mixing them is
// the obvious way for a share to silently never match a placement, so the
// conversion lives here and nowhere else.
//
// Pure module: no React, no I/O.
// ═══════════════════════════════════════════════════════════════════

/** NEU codes are letters then exactly four digits. Nothing else is a code. */
const CODE = /^\s*([A-Za-z]{2,6})\s*(\d{4})\s*$/;

/**
 * "CS 5800" | "cs5800" | " CS  5800 " → "CS5800". Returns null when the input
 * is not a course code at all, so callers can tell "unparseable" from "absent"
 * rather than propagating a string that will never match anything.
 *
 * @param {string} code
 * @returns {string|null}
 */
export function plannerId(code) {
  const m = CODE.exec(String(code ?? ""));
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

/**
 * "CS5800" → "CS 5800", for display and for messages that quote a source.
 * Falls back to the input unchanged rather than throwing: a label is never
 * worth a crash.
 *
 * @param {string} id
 * @returns {string}
 */
export function displayCode(id) {
  const m = /^([A-Za-z]{2,6})(\d{4})$/.exec(String(id ?? ""));
  return m ? `${m[1].toUpperCase()} ${m[2]}` : String(id ?? "");
}

/** Subject of a code in either spelling, or null. */
export function subjectOf(code) {
  const m = CODE.exec(String(code ?? "")) ?? /^([A-Za-z]{2,6})(\d{4})$/.exec(String(code ?? ""));
  return m ? m[1].toUpperCase() : null;
}

/** Catalog number as an integer, or null. */
export function numberOf(code) {
  const m = CODE.exec(String(code ?? "")) ?? /^([A-Za-z]{2,6})(\d{4})$/.exec(String(code ?? ""));
  return m ? parseInt(m[2], 10) : null;
}

/**
 * Graduate level. 5000 is the boundary the university uses everywhere —
 * `crossesGradBoundary` in scripts/lib/equivalence.js draws the same line, and
 * the two must not drift.
 */
export function isGradCode(code) {
  const n = numberOf(code);
  return n != null && n >= 5000;
}

/** Undergraduate level. Explicit rather than `!isGradCode`, which is also true of junk. */
export function isUgCode(code) {
  const n = numberOf(code);
  return n != null && n < 5000;
}

/**
 * True when `code` falls inside a pathway `gradDomain`, e.g.
 * `{ subject: "CS", min: 5000, max: 7980 }` or
 * `{ excludeSubject: "EECE", min: 5000 }` (ECE's non-EECE sub-budget).
 *
 * An absent bound is unbounded; an absent subject matches any subject. A
 * domain that specifies nothing matches every graduate course, which is what
 * CEE/SBS actually publishes ("any graduate course that contributes to the MS
 * degree requirements").
 *
 * @param {string} code
 * @param {{subject?:string, excludeSubject?:string, subjects?:string[], min?:number, max?:number}} domain
 */
export function inDomain(code, domain) {
  if (!domain) return false;
  const subj = subjectOf(code);
  const num = numberOf(code);
  if (subj == null || num == null) return false;
  if (domain.subject && subj !== domain.subject.toUpperCase()) return false;
  if (domain.subjects && !domain.subjects.some(s => s.toUpperCase() === subj)) return false;
  if (domain.excludeSubject && subj === domain.excludeSubject.toUpperCase()) return false;
  if (Number.isFinite(domain.min) && num < domain.min) return false;
  if (Number.isFinite(domain.max) && num > domain.max) return false;
  return true;
}

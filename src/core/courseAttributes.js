// ═══════════════════════════════════════════════════════════════════
// COURSE ATTRIBUTES  (pure — no React, no I/O)
//
// One predicate: does this course carry the attributes being asked for?
//
// It lives here rather than inline in whatever is asking because two very
// different callers need the same answer and must not drift. The course bank's
// filter had it as a line inside a React component; slot suggestions need the
// identical test, and importing it from a .jsx would run the wrong way across
// the hexagon while copying it would leave two definitions of "matches".
//
// Attributes are institution-neutral here on purpose. Northeastern's are
// NUpath, normalized into `course.attributes` by the adapter's courseNorm, so
// nothing in core has to know that — or that there are thirteen of them, or
// that one is spelled CE.
//
// AND, not OR: a course must carry every attribute asked for. That is what the
// bank filter has always meant, and the plans agree — the one program that
// names several in a cell ("Senior design elective (EI, WI, CE)") wants a
// single course carrying all three, not one course each.
// ═══════════════════════════════════════════════════════════════════

/**
 * Does this course carry all of these attributes?
 *
 * An empty request matches everything, so callers can pass their filter
 * straight through without a length check.
 *
 * @param {{attributes?: string[]}|null} course
 * @param {string[]} codes
 * @returns {boolean}
 */
export function hasAttributes(course, codes) {
  if (!codes?.length) return true;
  const have = course?.attributes;
  if (!have?.length) return false;
  return codes.every(c => have.includes(c));
}

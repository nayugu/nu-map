// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/courseOffering  (implements ICourseOffering)
//
// The single answer to "does this course run in that season", for every caller: the course
// card's badge, the offering popover, and CHART's availability constraint.
//
// Deliberately thin — it delegates to `offeringStats`, which is where the rule lives.
// Restating the rule here would recreate exactly the problem this port exists to remove.
// See ICourseOffering for the four divergent copies that preceded it, and what the
// divergence cost.
//
// ── A PURE rule, taking the course rather than looking it up ────────
//
// The first draft closed over a course map and an overrides map, and that was wrong twice
// over: the catalog loads asynchronously, so a port wired at startup holds an empty map for
// the session; and the student's overrides change as they edit, so a snapshot answers with
// a stale verdict. Both are the same mistake — a rule reaching for state it does not own.
//
// So every caller passes what it already has. `CourseCard` and `InfoPanel` both hold the
// course object and `offeredOverrides` from context; CHART holds a course map and looks up
// once. The port stays a function of its arguments, which is also what makes it testable
// without constructing an app.
//
// ── Overrides are a fact, not a probability ────────────────────────
//
// A student who knows a course runs in the summer outranks four years of history saying
// otherwise — they may have asked the department, or the department may have changed its
// mind. `effectiveOffered` already applies that precedence, which is another reason to call
// it rather than reimplement the threshold beside it.
// ═══════════════════════════════════════════════════════════════════

import { semTypeProb, effectiveOffered, seatStats } from "./offeringStats.js";
import calendar from "./calendar.js";

/**
 * Open seats per section in the most recent term of that season on record.
 *
 * Newest rather than an average: a course that was roomy three years ago and is packed now
 * is packed. Null when it has never run in that season with recorded capacity, which reads
 * as "no information" rather than as good or bad news.
 */
function latestSeatPressure(course, semTypeId) {
  const off = course?.offering;
  if (!off?.c) return null;
  const codes = Object.keys(off.c)
    .filter(code => calendar.decodeTermCode(code) === semTypeId)
    .sort((a, b) => b.localeCompare(a));
  for (const code of codes) {
    const s = seatStats(off.e?.[code], off.c?.[code], off.s?.[code]);
    if (s) return s.perSec;
  }
  return null;
}

/** @type {import("../../ports/ICourseOffering.js").CourseOfferingPort} */
export default {
  /**
   * The verdict the UI draws and CHART obeys.
   *
   * @param {object|null} course        the normalised course object
   * @param {string} semTypeId
   * @param {Record<string, boolean>|undefined} [overrides]
   *   this course's entry of `offeredOverrides` — `{ fall: true, sumB: false }`
   */
  offered(course, semTypeId, overrides) {
    // Not a catalog course at all: no evidence, so no objection. The same call the depth
    // index and `registrable` make for an id the catalog renumbered away.
    if (!course) return true;
    return effectiveOffered(course.termHistory, course.birthTermCode ?? null,
                            semTypeId, overrides).offered;
  },

  /** The evidence. Null means "not enough of it", and is never a zero. */
  probability(course, semTypeId, overrides) {
    if (!course) return null;
    const ovr = (overrides && !Array.isArray(overrides)) ? overrides[semTypeId] : undefined;
    // An override is a verdict, not a measurement, so it reports as certainty rather than
    // as a rate — and 0 is the only value that blocks a placement.
    if (ovr === true) return 1;
    if (ovr === false) return 0;
    return semTypeProb(course.termHistory, course.birthTermCode ?? null, semTypeId);
  },

  seatPressure(course, semTypeId) {
    return latestSeatPressure(course, semTypeId);
  },
};

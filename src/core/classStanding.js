// ═══════════════════════════════════════════════════════════════════
// CLASS STANDING — the registrar's gate, as a position in a plan  (pure)
//
// Northeastern states some courses' real prerequisite as class standing rather
// than as a course: "Must be enrolled in one of the following Classes: Junior
// (JR), Senior(SR)". The catalog prints that only in prose, where
// `courseNorm.RESTRICTION_ONLY` discards it, so until this existed the engine
// stood in the course-level DIGIT for it — and that proxy is wrong in both
// directions. ENGW 3302 is level 3, so `levelFloor[3]` allowed it 0.22 through
// the plan (term 2 of 8) while every one of its 24 sections requires junior
// standing; 4000-level courses were held to 0.67 where a JR/SR gate is 0.50.
//
// The gate itself is scraped from Banner (scripts/lib/class-standing.js parses it,
// derive-offering-summary folds it to one code per course) and arrives at runtime
// on `course.offering.std`. This module is the domain half: what the codes mean
// and where each one sits in a plan. It is in core, not engine, because the course
// card and the MCP tools read it too.
// ═══════════════════════════════════════════════════════════════════

/**
 * The standing ladder, most junior first. Position IS the ordering — `indexOf`
 * on this array is what makes "most lenient" computable.
 *
 * GR is deliberately NOT on it. Graduate standing is not a rung above senior; it
 * is a different ladder, reached by admission rather than by accumulating terms.
 * `prereqDepth` measures the p10 of a graduate placement at 0.00 for every level
 * 5xxx–8xxx: a student admitted to a master's takes 5000-level courses in their
 * first term, and mapping GR onto an undergraduate floor is exactly how they get
 * barred from it.
 */
export const STANDING_LADDER = ["FR", "SH", "JR", "SR"];

/** Every code Banner is known to print in a Classes restriction. */
export const KNOWN_STANDINGS = new Set([...STANDING_LADDER, "GR"]);

/**
 * Fraction of an undergraduate plan completed before each standing is reached.
 *
 * A standing is earned with credits, not terms, so the honest mapping for a
 * 4-year/8-term plan is quarter markers: sophomore at 1/4, junior at 1/2, senior
 * at 3/4. Deliberately NOT fitted to observed placements — `levelFloor` already
 * is a fit, and the entire point of this data is to replace a fit with the
 * registrar's stated rule. Expressed as a position 0..1 to match
 * `cellLevelFloor`'s contract, so a plan of any length converts the same way.
 */
export const STANDING_FLOOR = Object.freeze({ FR: 0.00, SH: 0.25, JR: 0.50, SR: 0.75 });

/**
 * Canonical English names, for surfaces that are not localized — the MCP tools
 * answer in English regardless of the app's locale. The UI must NOT use these:
 * every user-facing string exists in all 8 locales, so `CourseCard` reads
 * `t.classStanding[code]` instead.
 */
export const STANDING_NAMES = Object.freeze({
  FR: "Freshman", SH: "Sophomore", JR: "Junior", SR: "Senior",
});

/**
 * The most lenient standing in a `|`-joined key, or null.
 *
 * "Most lenient" is the earliest rung the key admits, because a student holding it
 * satisfies the restriction. GR is skipped for the reason on STANDING_LADDER: a
 * `GR|JR|SR` section is open to juniors, so its floor is junior, while a GR-ONLY
 * section has no undergraduate floor at all and returns null.
 *
 * @param {string} key
 * @returns {string|null} a STANDING_LADDER member
 */
export function lenientStanding(key) {
  let best = null;
  for (const code of String(key ?? "").split("|")) {
    const i = STANDING_LADDER.indexOf(code);
    if (i === -1) continue;
    if (best === null || i < STANDING_LADDER.indexOf(best)) best = code;
  }
  return best;
}

/**
 * The earliest position 0..1 a course's class-standing gate allows, or null when
 * there is no gate to read.
 *
 * Null rather than 0 on purpose: the caller has to distinguish "the registrar says
 * this is open from day one" from "we have no restriction data", because only the
 * second should fall back to the level-digit estimate.
 *
 * @param {{offering?: {std?: string}}|null|undefined} course  a normalized Course
 * @returns {number|null}
 */
export function standingFloorOf(course) {
  const code = course?.offering?.std;
  if (typeof code !== "string") return null;
  const floor = STANDING_FLOOR[code];
  return typeof floor === "number" ? floor : null;
}

// ═══════════════════════════════════════════════════════════════════
// PORT: ICourseOffering
// When a course actually runs, and how full it is when it does.
//
// ── Why this port exists ───────────────────────────────────────────
//
// It exists because the same judgement was implemented FOUR times and the copies
// disagreed. "Is this course offered in the spring" is one question, and it was answered by:
//
//   offeringStats.effectiveOffered   the rule, with the override and evidence handling
//   CourseCard.jsx                   the same rule restated inline, drawing the badge
//   InfoPanel.jsx                    a local `semTypeProb`, for the offering popover
//   the engine                       `offeringProbability(...) !== 0`, a WEAKER question
//
// The last one is the one that cost something. `effectiveOffered` flags a course offered in
// half or fewer of the recorded instances of a season; the engine barred it only from a
// season it had never run in at all. `CS 3800` is recorded in Summer B once in four years,
// so CHART placed it in a Summer B and the card came up `offered?` beside it — a plan the
// app itself marked up, produced by an engine that thought it was following the rules.
//
// There was no port to hold the rule, so the UI could not reach it without importing an
// adapter, and the hexagonal boundary made four copies the path of least resistance. That
// is the failure mode this file removes: with one port, "the UI and the engine disagree
// about availability" stops being expressible.
//
// ── The distinction that matters, and must not be flattened ─────────
//
//   `probability` is EVIDENCE: 0..1, or null when there is not enough of it. Null is not
//   zero. 40.8% of the catalog has no usable history, and reading that as "never offered"
//   would make two fifths of the catalog unschedulable.
//
//   `offered` is a VERDICT: a boolean, and the one the UI draws. It folds in the student's
//   own override (which outranks history — they may know a course runs), the ≥2-entries
//   evidence bar, and the 50% threshold.
//
// Both are here because they answer different questions. Legality is a verdict; the
// robustness objective wants the number, since a 1% chance and a 99% chance are the same
// legal answer and very different plans.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const ICourseOffering = "courseOffering";

/**
 * Every member takes the COURSE OBJECT, not an id, and the caller's own overrides.
 *
 * A rule that looked courses up would have to hold a course map and an overrides map, and
 * both are moving targets: the catalog loads asynchronously, so a port wired at startup
 * holds an empty map for the session, and overrides change as the student edits, so a
 * snapshot answers with a stale verdict. Every caller already has the course in hand.
 * Keeping it a function of its arguments is also what makes it testable without an app.
 *
 * @typedef {Object} CourseOfferingPort
 *
 * @property {(course: object|null, semTypeId: string, overrides?: Record<string, boolean>) => boolean} offered
 *   The VERDICT, and the same one the UI draws. Folds in the student's override, the
 *   evidence bar and the threshold. Absent data reads as offered: no evidence is not
 *   evidence of absence, and the alternative bars two fifths of the catalog.
 *
 * @property {(course: object|null, semTypeId: string, overrides?: Record<string, boolean>) => number|null} probability
 *   The EVIDENCE — the share of recorded instances of that season in which the course
 *   ran, or null when there are fewer than two post-birth records. Never conflate a null
 *   with a zero; see the header.
 *
 * @property {(course: object|null, semTypeId: string) => number|null} [seatPressure]
 *   Open seats per section in the most recent term of that season on record, or null.
 *   Newest rather than averaged: a course that was roomy three years ago and is packed
 *   now is packed.
 */

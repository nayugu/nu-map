// ═══════════════════════════════════════════════════════════════════
// DERIVATION · the vocabulary  (pure — no logic, only names)
//
// What the engine can say about its own search, as data. It lives in `src/core/` and
// not in `src/engine/` for one structural reason: `src/engine/trace.js` produces these
// values and `src/core/derivation/reduce.js` consumes them, and core must not import
// the engine. The engine already imports core (`requirementDemand`, `coreqGroups`), so
// this is the direction that already holds.
//
// Nothing here decides anything. A view that needs a rule — which fate wins when a term
// is excluded twice, what counts as a drawable tree — states it in the module that
// draws, so the enumeration cannot quietly acquire a policy.
// ═══════════════════════════════════════════════════════════════════

/**
 * What ended a node.
 *
 * `PENDING` is the initial value, and a node still holding it at the end of a run is one
 * the search never came back to. That happens on the SUCCESSFUL path: the winning spine
 * returns `SOLVED` from the bottom up, and the siblings above it are simply never
 * revisited. So `PENDING` means "abandoned when the answer was found", which is
 * information, not a gap.
 */
export const NODE = Object.freeze({
  PENDING: 0,
  /** Returned true: this node, and everything under it, is part of the answer. */
  SOLVED: 1,
  /** Every term in the domain was tried and none survived. A backtrack. */
  EXHAUSTED: 2,
  /** The node budget ran out here. */
  BUDGET: 3,
  /** The wall clock ran out here. */
  TIME: 4,
  /** The card arrived with no legal term at all — nogood learning narrowed it away. */
  EMPTY_DOMAIN: 5,
  /** A COMPLETE assignment, refused by the prereq-aware witness. */
  GOAL_WITNESS: 6,
  /** A complete assignment, refused by the four-course bar. */
  GOAL_BAR: 7,
});

/** The node codes that mean "this subtree failed", for a reader counting dead ends. */
export const DEAD = Object.freeze([
  NODE.EXHAUSTED, NODE.EMPTY_DOMAIN, NODE.GOAL_WITNESS, NODE.GOAL_BAR,
]);

/**
 * Every reason a branch is cut, as one enumeration.
 *
 * These are the engine's own strings — `block()`'s five cheap rejects, the three
 * propagator kills, and the witness's failure kinds — collected in one place so a
 * recorded cause can be an index rather than a string, and so a cause nobody adds here
 * lands in `other` rather than silently in bucket zero.
 *
 * The order is the order a branch MEETS them, which is also cheapest-first: it is the
 * engine's own evaluation order in `step()`, so a reader following the list is following
 * the code. The cause matrix sorts by count instead, because significance is measured.
 */
export const CAUSES = Object.freeze([
  "term-at-credit-cap",
  "term-at-slot-cap",
  "too-many-of-one-requirement",
  "term-at-its-course-ceiling",
  "prereq-order-with-what-is-placed",
  "chain-has-no-room-left",
  "no-room-left-for-the-rest",
  "full-term-cannot-reach-four",
  // The witness's own four, taken from `witness.js` rather than from memory: a first draft
  // of this list invented `coreq-split`, which the witness never emits, and omitted
  // `concentration-unfillable`, which it does — so a real cause would have been counted as
  // `other` while a column stood permanently empty.
  "no-candidate",
  "over-subscribed",
  "named-prereq",
  "concentration-unfillable",
  "other",
]);

const CAUSE_INDEX = new Map(CAUSES.map((c, i) => [c, i]));
/** The bucket for a cause this file has not been told about. Never a silent 0. */
export const CAUSE_OTHER = CAUSES.indexOf("other");
export const causeCode = (kind) => CAUSE_INDEX.get(kind) ?? CAUSE_OTHER;

/**
 * Why a term is not in a card's domain.
 *
 * Recorded by `buildDomains` and by the critical-path narrowing, both of which compute
 * exactly this today and throw it away — the domain that comes out says which terms are
 * legal and nothing about which narrowing removed the rest. This is the one part of the
 * derivation that cannot be reconstructed from any existing engine output.
 */
export const EXCLUSION = Object.freeze({
  /** Its prerequisites cannot be finished by then (`minDepth`, or the plan's own depth). */
  BEFORE_PREREQS: "before-prereqs",
  /** No whole option runs in that season. */
  NOT_OFFERED: "not-offered-then",
  /** Co-op preparation must precede the co-op (`coopBoundary`). */
  COOP_PREP_BOUND: "coop-prep-bound",
  /** Outside the window the precedence chains leave (`criticalPath`). */
  PRECEDENCE_WINDOW: "outside-precedence-window",
  /**
   * The department published this course in one of the first four terms, so that term is
   * the only one left (`earlyTerms.js`).
   *
   * Distinct from every reason above, and it has to be: those are all the ENGINE ruling a
   * term out, and this is the engine standing aside. A card drawn with one legal term and
   * no explanation reads as a bug in a view whose entire purpose is showing the process.
   */
  DEPARTMENT_TERM: "department-plans-this-term",
  /** Removed between restarts because an earlier attempt failed there. */
  LEARNED: "learned-nogood",
});

/**
 * How many cut POSITIONS one attempt records before it stops keeping them.
 *
 * 2,000, and the reasoning is that a position is only ever used to draw a tree. Cuts
 * outnumber nodes about nine to one — International Business records 13,019 nodes and
 * 115,950 cuts across five attempts — and an attempt with 20,000 cuts is one nobody can
 * draw, so keeping their positions is 116,000 entries in service of nothing.
 *
 * What is NOT capped is the per-card cause COUNT. That is one increment into a fixed array,
 * it is what the saturated population's whole view is built from, and it stays exact however
 * many branches are cut. So the cap degrades the tree (which was unavailable at that size
 * anyway) and never the cause matrix.
 *
 * Per ATTEMPT rather than per run, because the attempt that can be drawn is often not the
 * first: International Business answers on rung 1, after the strict tier has burned 12,000
 * nodes. A single run-wide cap would be spent before the interesting tree started.
 *
 * INVARIANT: this must be at least `DRAWABLE_MARKS` in `tree.js`, or an attempt could be
 * declared drawable and be missing leaves. Asserted in the unit suite.
 */
export const CUT_POSITIONS_PER_ATTEMPT = 2000;

/**
 * A term's fate for one card, as the narrowing matrix reads it.
 *
 * The four exclusions plus two states the domain cannot express on its own: a term that
 * was legal and not taken, and the one that was. `CHOSEN` is drawn with a ring rather
 * than by hue alone, so the one cell that matters is never colour-only.
 */
export const FATE = Object.freeze({
  CHOSEN: "chosen",
  LEGAL: "legal",
  ...EXCLUSION,
});

/**
 * Which exclusion is reported when more than one applies.
 *
 * A term can be excluded twice over — before its prerequisites AND in a season the course
 * never runs — and the matrix has one cell to say so in. The rule is EARLIEST BINDING
 * WINS, in the engine's own evaluation order: a card whose prerequisites are not done by
 * term 2 is not "not offered in term 2", because the season question was never reached.
 *
 * This is a decision, so it is stated once, here, rather than falling out of whichever
 * reason happened to be pushed first.
 */
export const EXCLUSION_PRIORITY = Object.freeze([
  EXCLUSION.BEFORE_PREREQS,
  EXCLUSION.NOT_OFFERED,
  EXCLUSION.COOP_PREP_BOUND,
  EXCLUSION.PRECEDENCE_WINDOW,
  // Above `LEARNED` and below every hard reason. A term the department did not choose was
  // still legal, so this must never outrank an explanation of why a term was impossible —
  // but it is a better answer than "an attempt failed there".
  EXCLUSION.DEPARTMENT_TERM,
  EXCLUSION.LEARNED,
]);

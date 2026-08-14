// ═══════════════════════════════════════════════════════════════════
// PATHWAY RULE VOCABULARY — and the safety classification.
//
// An accelerated pathway (Northeastern brands it "PlusOne") is a set of
// candidate course SHARES plus a set of RULES over whichever shares the
// student actually takes. This module is the vocabulary of those rules.
//
// ── The safety property, which is the reason this file exists ──────
//
// Every rule is classified by WHAT WE CAN KNOW, not by what it is about:
//
//   computable     we hold the data and can decide it       → may say "violated"
//   assertable     only the student knows (GPA, co-op count) → never "violated"
//   unknowable     a person decides it (advisor, admission)  → never "violated"
//   informational  nothing to decide; just say it            → never "violated"
//
// Only `computable` may ever fail a student. This is inherited, deliberately,
// from core/prereqConditions.js, whose invariant 1 was written anticipating
// exactly this feature:
//
//   "an undergrad in a combined BS/MS legitimately takes 5000-level courses on
//    permission we cannot see, so a note must not manufacture a red card"
//
// The classification lives in CODE, not in pathway data, so an author writing
// a new pathway file cannot promote an unknowable rule into one that fails a
// student. `evaluate.js` asserts the invariant at runtime rather than trusting
// each evaluator to remember it.
//
// ── Adding a rule kind ────────────────────────────────────────────
//
// 1. add an entry here with its class,
// 2. add an evaluator and register it in rules/index.js.
// The engine does not change. That is the whole point: the inventory in
// docs/plusone-design.md §2 found 73 published rules across seven colleges and
// is certainly still incomplete.
//
// Before adding a kind, check whether an existing kind plus different DATA
// covers it — a kind with exactly one instance is a smell. `subBudget` alone
// expresses ECE's seven per-concentration non-EECE budgets and Bouvé's four
// pharmacology elective top-ups: eleven published rules, one evaluator.
//
// Pure module: no React, no I/O, no strings the user sees.
// ═══════════════════════════════════════════════════════════════════

/** What we can know about a rule. Drives whether it may report a failure. */
export const RULE_CLASS = Object.freeze({
  COMPUTABLE: "computable",
  ASSERTABLE: "assertable",
  UNKNOWABLE: "unknowable",
  INFORMATIONAL: "informational",
});

/** The four outcomes an evaluator may return. */
export const STATUS = Object.freeze({
  SATISFIED: "satisfied",
  VIOLATED: "violated",
  UNKNOWN: "unknown",
  INFO: "info",
});

/**
 * The only class permitted to return STATUS.VIOLATED.
 * A set rather than a comparison so the intent survives someone adding a class.
 */
export const MAY_VIOLATE = Object.freeze(new Set([RULE_CLASS.COMPUTABLE]));

const { COMPUTABLE, ASSERTABLE, UNKNOWABLE, INFORMATIONAL } = RULE_CLASS;

/**
 * The vocabulary. `cls` is the safety class; `doc` records which published
 * rule(s) the kind exists to express, keyed to docs/plusone-design.md §2 so a
 * reader can get from code back to the source that justifies it.
 */
export const RULE_KINDS = Object.freeze({
  // ── Budgets ─────────────────────────────────────────────────────
  shareCap: {
    cls: COMPUTABLE,
    doc: "§2.1 #1–#3. DISJUNCTIVE: `courses <= n || sh <= m`, because the " +
         "university policy reads 'four graduate courses or 16 semester hours, " +
         "whichever is greater'. Bouvé ships 5 courses (15 SH) and the College " +
         "of Science ships 17 SH (4 courses); both are legal and a flat 16 SH " +
         "ceiling is wrong for both.",
  },
  transferCap: {
    cls: COMPUTABLE,
    doc: "A SECOND, independent 16 SH limit, easy to conflate with shareCap's " +
         "but not the same number. The COE FAQ, verbatim: 'Additional graduate " +
         "coursework beyond 16 hours cannot transfer to MS, even if not applied " +
         "to BS.' shareCap caps what may be SHARED with the bachelor's; this caps " +
         "how much graduate credit taken as an undergraduate may ever transfer " +
         "to the master's AT ALL — a graduate course taken beyond what any " +
         "bachelor's requirement needs still spends against this cap. Also " +
         "carries the registrar's floor (KB000020031): 'a minimum of 14 semester " +
         "hours at the graduate level, after completion of the undergraduate " +
         "requirements, are required for the master's degree' — so for a " +
         "master's smaller than 30 SH the floor binds before 16 SH does. See " +
         "rules/transferCap.js and shareSet.pathwayGradCreditSH.",
  },
  subBudget: {
    cls: COMPUTABLE,
    doc: "§2.1 #5, #7. A semester-hour ceiling over a course DOMAIN, optionally " +
         "scoped to an MS concentration. ECE: non-EECE SH max per concentration " +
         "(CCSP 8, CSYS 12, CVLA 12, ELPO 8, HSMI 12, MSMD 8, POWR 8). Bouvé " +
         "pharmacology: elective top-ups of 3/5/8/10 SH over a subject set.",
  },

  // ── Membership of the share set ─────────────────────────────────
  mandatoryShares: {
    cls: COMPUTABLE,
    doc: "§2.2 #17, #18. Shares flagged `mandatory` must be taken; shares " +
         "flagged `mandatoryUnless` become mandatory only when the condition " +
         "fails. Khoury CE→MSCS: CS 5010 always, CS 5800 unless CS 3000 is done.",
  },
  chooseK: {
    cls: COMPUTABLE,
    doc: "§2.2 #19. How many OPTIONAL shares may be taken. Differs per pathway: " +
         "Khoury BSCS→MSCS takes four, CE→MSCS chooses two beside its mandatory " +
         "courses.",
  },
  excludedFromShare: {
    cls: COMPUTABLE,
    doc: "§2.2 #20, #21. Graduate courses that may never count toward the " +
         "bachelor's. ECE: EECE 5698 / 7398 / 6400. Bouvé MSHI: the capstone " +
         "HINF 7701, though every other MSHI course is shareable.",
  },

  // ── Exclusivity and sequencing ──────────────────────────────────
  noGradIfUgDone: {
    cls: COMPUTABLE,
    doc: "§2.3 #29. Khoury, verbatim: 'A student may not take the graduate-level " +
         "version of a course if they have already completed the undergraduate " +
         "version.' The share is WITHDRAWN, not merely flagged — see shareSet.js.",
  },
  maxGradCoursesPerTerm: {
    cls: COMPUTABLE,
    doc: "§2.3 #33. Khoury allows 1 per term; CSSH History allows 2, and COE's " +
         "ChE curriculum sheet shows 2 in one term. NOT universal — encoding 1 " +
         "globally would invent errors for most of the university.",
  },
  earliestTerm: {
    // INFORMATIONAL, not computable — deliberately demoted after driving the
    // real app showed the ordinal comparison was wrong for every cohort. Summer
    // terms occupy ordinals (fall of year two is the 5th term, not the 3rd) and
    // the mapping shifts for a spring entrant, so no single threshold is right.
    // Doing this properly needs the term's season and academic year, which is
    // ICalendar's knowledge rather than a pure evaluator's. See rules/earliestTerm.js.
    cls: INFORMATIONAL,
    doc: "§2.3 #34. Khoury: a first-year student may not take a graduate course " +
         "in the summer, so the earliest is the fall of year two. Stated, not " +
         "checked — re-promote to COMPUTABLE once ctx carries term season/year.",
  },

  // ── Gates on facts only the student holds ───────────────────────
  gpaMin: {
    cls: ASSERTABLE,
    doc: "§2.4 #46–#51. Several pathways gate on more than one SCOPE at once " +
         "with different thresholds — D'Amore-McKim wants cumulative 3.0 AND " +
         "accounting-coursework 3.25. NU Map does not hold GPA, so this is " +
         "stated and never evaluated, exactly like the co-op GPA gate.",
  },
  coopCompleted: {
    cls: ASSERTABLE,
    doc: "§2.4 #52. D'Amore-McKim Accounting requires one completed six-month " +
         "co-op before entry — a non-course prerequisite.",
  },
  gradCourseCompletedFirst: {
    cls: ASSERTABLE,
    doc: "§2.4 #45. Khoury requires one graduate course to be completed " +
         "successfully BEFORE the application. Whether it was passed depends on " +
         "a grade the student may not have entered.",
  },

  // ── Gates a person decides ──────────────────────────────────────
  admissionNotGuaranteed: {
    cls: UNKNOWABLE,
    doc: "§2.4 #56, #57. Khoury, verbatim: 'Admission into the PlusOne program " +
         "does not guarantee admission into the master's program.' Must be said " +
         "and must never be evaluated.",
  },
  advisorApproval: {
    cls: UNKNOWABLE,
    doc: "§2.4 #55. Bouvé's Course Review Form, COE's Plan of Study Form. Also " +
         "covers §2.2 #23, the open tail Bouvé leaves to advisor discretion.",
  },
  registrationOverride: {
    cls: UNKNOWABLE,
    doc: "§2.4 #53, #54. SCCJ needs a registration override above 5000 level " +
         "and permission for electives outside its subject set.",
  },

  // ── Things to say, with nothing to decide ───────────────────────
  noDeferral: {
    cls: INFORMATIONAL,
    doc: "§2.5 #58. Enrol the semester after the bachelor's or lose the place.",
  },
  fullTimeGradMin: {
    cls: INFORMATIONAL,
    doc: "§2.5 #59. Khoury states 8 SH; the MSDS page states the same rule as " +
         "'two courses per fall/spring'.",
  },
  noTransferCredit: {
    cls: INFORMATIONAL,
    doc: "§2.5 #60. University policy: (external) transfer credit — from " +
         "another institution, AP, IB — may not apply to a master's earned " +
         "through a PlusOne. Not to be confused with `transferCap`, #62's " +
         "SEPARATE limit on how much of the student's OWN graduate coursework " +
         "may transfer to the master's.",
  },
  scholarshipIneligible: {
    cls: INFORMATIONAL,
    doc: "§2.5 #67. Double Husky (Khoury, CoS, COE); New Program and Location " +
         "Launch (COE).",
  },
  applicationDeadline: {
    cls: INFORMATIONAL,
    doc: "§2.3 #41. D'Amore-McKim: 15 November. Bouvé varies by term and " +
         "program. Dates rot, so this is data with a source date, never logic.",
  },
  tuitionRate: {
    cls: INFORMATIONAL,
    doc: "§2.5 #70. D'Amore-McKim states shared courses are billed at " +
         "undergraduate tuition rates. Only one college states it, so it is " +
         "quoted with attribution rather than generalised.",
  },
});

/** @returns {string|null} the safety class of a kind, or null if unknown. */
export function ruleClass(kind) {
  return RULE_KINDS[kind]?.cls ?? null;
}

/**
 * May a rule of this kind report a failure?
 *
 * An UNKNOWN kind returns false. That is the safe direction: pathway data that
 * names a kind we have not implemented yet degrades to "we cannot say", never
 * to a red card. `scripts/verify-pathways.js` is what stops such data from
 * shipping in the first place — this is the belt to its braces.
 */
export function mayViolate(kind) {
  return MAY_VIOLATE.has(ruleClass(kind));
}

/** Every kind name, for tests that must cover the whole vocabulary. */
export const ALL_RULE_KINDS = Object.freeze(Object.keys(RULE_KINDS));

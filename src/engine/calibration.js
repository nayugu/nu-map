// ═══════════════════════════════════════════════════════════════════
// CHART · CALIBRATION — the institution's conventions, injected
//
// ── Why these cannot live in the engine ─────────────────────────────
//
// `src/engine/` is meant to hold no institution knowledge. It already honours that for the
// things that are obviously local — availability, seat pressure, co-op legality and the
// calendar all arrive through `ports.js` — and then quietly broke it for a second class of
// fact that is just as local and much easier to mistake for arithmetic:
//
//   "a full fall or spring carries four courses"          Northeastern, measured
//   "a 3 SH course is a real course"                      Northeastern's credit scale
//   "a 3000-level course sits 64% through the plan"       Northeastern's numbering
//   "6000-level and above is graduate-only"               Northeastern's numbering
//   "an elective pool is placed once 69% of it is open"   Northeastern's departments
//
// Every one of those is a measurement over Northeastern's published plans. None of them is a
// property of scheduling. A quarter-system institution has no "four-course fall"; a
// university numbering courses 100–400 has no 6000-level; one on 3-credit courses has a
// different notion of a real course. Hard-coded in the core they are invisible assumptions,
// and CHART cannot be licensed as a unit while it silently believes them.
//
// It is not a hypothetical, either. `FULL_TERM_MIN_COURSES` was applied to master's degrees
// for exactly as long as it was a constant: measured, 95.8% of undergraduate full terms carry
// four or more courses and only 16.4% of graduate ones do, with 129 of 329 carrying none at
// all. The bar was an undergraduate habit enforced on degrees that do not have it, and the
// hard-rule gate reported a defect where the departments agreed with CHART. A value that
// looks like arithmetic gets applied like arithmetic.
//
// ── What is NOT here, and why ───────────────────────────────────────
//
// Engine mechanics stay in the engine, because they are properties of the algorithm rather
// than of the university: node and time budgets, `NODES_PER_MS`, `HALL_SLACK`,
// `MAX_PREREQ_SUBSTITUTIONS`, `POOL_MIN_CANDIDATES`, `MAX_DEPTH`. Moving those would invite a
// caller to tune the search, which is not a decision an institution adapter should be making.
//
// The line is: if re-measuring the corpus could change it, it belongs here. If only profiling
// the search could change it, it does not.
//
// ── The defaults are Northeastern's, and that is stated ─────────────
//
// `DEFAULT_CALIBRATION` holds the measured Northeastern values, so nothing changes for the
// existing caller and no behaviour depends on this file being wired up. That is a deliberate
// trade rather than an oversight: a neutral default (no four-course bar, no level positions)
// would silently produce worse plans for the only institution currently using it, and a
// missing-calibration failure would be a worse first experience than an accurate one.
//
// What it buys is that every one of these is now declared in ONE place, with its provenance,
// and a second institution overrides rather than forks.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} Calibration
 *
 * @property {number} fullTermMinCourses
 *   Courses of at least `realCourseSH` a full term should carry. MEASURED over 3,941
 *   published undergraduate full terms: 54.8% hold exactly four, 95.8% hold four or more.
 * @property {number} graduateFullTermMinCourses
 *   The same for a graduate plan. ZERO at Northeastern, and that is a finding rather than a
 *   default: 329 graduate full terms do not cluster at all — 39% carry zero or one course,
 *   which is what a thesis term looks like — and a master's 16 SH cap makes four 4 SH
 *   courses the entire envelope. Two would cover 54.4%, which is not a convention.
 * @property {number} halfTermCourses
 *   What a half term (Summer A or B) holds. Median 2 in the published summers.
 * @property {number} realCourseSH
 *   The credit floor at which a cell counts toward the above. A one-credit lab and a course
 *   are not two courses; the corpus bar is explicitly four of >= 3 SH (95.8%, against 97.7%
 *   for four cells of any size — the difference is terms padded with small labs).
 *
 * @property {number} sameRequirementPerTerm
 *   How many cells of ONE requirement a term should carry, as an ordering target. MEASURED:
 *   16.3% of published terms carry two, and departments hold 3+ in 0.7% of terms.
 * @property {number} sameRequirementPerTermMax
 *   The hard bound. Published plans reach 4 at the extreme.
 *
 * @property {number} poolReachMin
 *   How much of an elective pool must be prereq-reachable before a term is a good place for
 *   it. MEASURED over 742 major-subject pools: mean 0.92 of the pool is open where
 *   departments place it, median 1.00, p10 0.69. The p10 is used, not the median — at the
 *   median a pool cannot be placed until its last prerequisite is done, which puts every
 *   major elective in the final year.
 *
 * @property {Record<number, number>} levelPosition
 *   Where a course of each level conventionally sits, as a fraction through the plan.
 *   MEASURED over 12,848 placements, Pearson r = 0.809 — the strongest relationship in the
 *   corpus. MEDIANS, not means: a distribution bounded at zero with a long right tail has a
 *   mean above its median, and using the means pushed first-year courses out of term one.
 * @property {Record<number, number>} levelFloor
 *   The earliest a real plan has ever put a course of each level (p10). Stands in for class
 *   standing, which the catalog states only in prose.
 * @property {number} graduateOnlyLevel
 *   The level at and above which a course is graduate-only, so an undergraduate's elective
 *   pool is not answered by a doctoral seminar. SIX at Northeastern, not five: 5000-level is
 *   genuinely open to undergraduates and combined BS/MS degrees are built on it.
 * @property {number} graduateStudyLevel
 *   The level at and above which a course IS graduate study, for targeting. FIVE, and
 *   distinct from `graduateOnlyLevel` — 5000-level is graduate work that an undergraduate may
 *   nevertheless take, so one number decides where to aim it and the other whether it is
 *   allowed at all. Collapsing them is how every 5000-level course got barred from the first
 *   two thirds of a master's.
 * @property {number} graduateLevelTarget
 *   Where to aim a graduate course in a graduate plan. 0.3 — the central tendency of the
 *   medians (5xxx 0.21, 6xxx 0.33, 7xxx 0.75, 8xxx 0.27). NOT the p10, which is 0.00 and is
 *   the floor: a master's student takes 5000-level courses in their first term.
 *
 * @property {number} slotCapFull
 *   The most courses a full term may hold, as a fallback when no published plan says.
 *   The corpus maximum, so it forbids only what no real plan does.
 * @property {number} slotCapHalf
 *   The same for a half term.
 */

/**
 * Northeastern's measured conventions.
 *
 * Every number here is a measurement with its sample size in the typedef above. None is a
 * guess, and none should be edited without re-measuring — `sequencing-calibration.test.js`
 * re-derives four of them from the shipped plans and fails if they have drifted.
 */
export const DEFAULT_CALIBRATION = Object.freeze({
  fullTermMinCourses: 4,
  graduateFullTermMinCourses: 0,
  halfTermCourses: 2,
  realCourseSH: 3,

  sameRequirementPerTerm: 2,
  sameRequirementPerTermMax: 4,

  poolReachMin: 0.69,

  levelPosition: Object.freeze({ 1: 0.00, 2: 0.36, 3: 0.64, 4: 0.91 }),
  levelFloor: Object.freeze({ 1: 0.00, 2: 0.09, 3: 0.22, 4: 0.67, 5: 0.57 }),
  graduateOnlyLevel: 6,
  graduateStudyLevel: 5,
  // 0.3, and the first draft of this file said 0.0 — a mistake worth leaving recorded,
  // because it is the same confusion twice. The p10 of a graduate placement is 0.00, which
  // is the FLOOR: a student admitted to a master's takes 5000-level courses in their first
  // term, so nothing is barred from the front of the plan. The TARGET is a different
  // statistic, and the medians are 5xxx 0.21, 6xxx 0.33, 7xxx 0.75, 8xxx 0.27 — no usable
  // ladder (the non-monotonicity is 33 observations at 8xxx, not signal), so graduate study
  // gets one central target and no floor rather than a fabricated ladder.
  graduateLevelTarget: 0.3,

  // NUPath's Capstone Experience designation, and the earliest a published plan puts one. See
  // the adapter for the measurement; null disables the rule for an institution with no such
  // designation, which is the honest default rather than a guess about its curriculum.
  capstoneAttribute: null,
  capstoneFloor: 0.85,

  // Designations carrying a positional convention, applied by `attributePlacement.js` after
  // everything else has settled. EMPTY by default, for the same reason `capstoneAttribute` is
  // null: an institution's designations are not something to guess. See the Northeastern adapter
  // for the declared rules and the measurements behind them.
  attributePlacement: [],

  slotCapFull: 9,
  slotCapHalf: 5,
});

/**
 * Fill in anything a caller left out.
 *
 * Merged shallowly per key, so a caller may override `fullTermMinCourses` alone without
 * having to restate every level position — the common case for a second institution is that
 * most conventions match and one or two do not.
 *
 * @param {Partial<Calibration>} [given]
 * @returns {Calibration}
 */
export function withCalibration(given = {}) {
  return { ...DEFAULT_CALIBRATION, ...(given ?? {}) };
}

/**
 * The four-course bar for a student type.
 *
 * A function rather than two fields at the call sites, because "which bar applies" is the
 * question that was got wrong: the undergraduate value was read directly in six places and
 * every one of them applied it to master's degrees too.
 */
export const minCoursesFor = (cal, studentType) =>
  (studentType === "graduate" ? cal.graduateFullTermMinCourses : cal.fullTermMinCourses);

/**
 * Is a full term FULL? Four real courses, or no room left for another one.
 *
 * ── Why the second clause is not a relaxation ───────────────────────
 *
 * "Four courses in every full fall and spring" was enforced as a course COUNT, and that made
 * it unsatisfiable for a degree it should never have applied to. Architecture BS studio courses
 * are 8–16 SH: a term holding one cannot reach four courses inside the 19 SH registration cap,
 * because 16 + 3 + 3 + 3 is 25. CHART refused the program.
 *
 * The mistake was in the metric, not the plan. A term carrying a 16 SH studio is not thin — it
 * is FULL, and calling it thin describes it wrongly. What the rule is actually for is that no
 * full term is left with room the student is not using, and that is what this asks: either four
 * real courses, or adding one more would break the cap.
 *
 * So the rule stays HARD, and gets stronger rather than weaker. It now also catches a term with
 * three 4 SH courses and space for a fourth, which a pure count caught, AND correctly passes a
 * term with three 6 SH courses at 18 SH, which a pure count called a defect while the
 * registrar would refuse to add anything to it. The 4.2% of published full terms that miss the
 * count are exactly the ones this second clause explains.
 *
 * @param {number} bigCourses  cells of at least `realCourseSH` in the term
 * @param {number} loadSH      credits already in the term
 * @param {number} capSH       the registration cap for this term
 */
export function termIsFull(bigCourses, loadSH, capSH, cal, studentType, bigSH = null) {
  const min = minCoursesFor(cal, studentType);
  if (min <= 0) return true;                       // no convention here — graduate plans
  if (bigCourses >= min) return true;
  // ── Measured against REAL courses, not against everything present ──
  //
  // Room for one more real course means room the student is not using — but the room has to
  // be judged by what is occupying it. Read against the TOTAL load, this clause could not
  // tell a term that is genuinely full of substantial work from one padded with labs:
  //
  //   three 6 SH courses, 18 SH          full — the registrar would refuse a fourth
  //   three 4 SH courses + 5 SH of labs  NOT full — the labs belong in a term that has
  //   and seminars, 17 SH                its four already, and the fourth course fits
  //                                      once they move
  //
  // Both read as 17–18 SH with three real courses, and the second is International Business
  // Spring 2027: `BUSN 1103`, `INTB 2205` and `INTB 2206` take five credits and the fourth
  // real course no longer fits. The credit ceiling was excusing a shortfall the small courses
  // had caused, and `gatePlan` inherited the excuse — 53 full terms corpus-wide were reported
  // as fine on exactly this basis.
  //
  // So the slack is measured against the credit held by REAL courses. This changes nothing
  // for a term with no small courses, which is why Architecture is unaffected: a 16 SH studio
  // is 16 SH of real course either way. It only bites where padding created the fullness.
  const substantial = bigSH == null ? loadSH : bigSH;
  return substantial + cal.realCourseSH > capSH + 0.01;
}

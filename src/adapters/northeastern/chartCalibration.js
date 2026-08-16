// ═══════════════════════════════════════════════════════════════════
// ADAPTER: northeastern/chartCalibration
//
// Northeastern's scheduling conventions, measured over its published Sample Plans of Study
// and stated here rather than inside CHART.
//
// ── Why this file exists even though the engine has the same defaults ──
//
// `src/engine/calibration.js` ships these values as `DEFAULT_CALIBRATION`, so CHART works
// without this file. That is deliberate — a neutral default would silently produce worse
// plans for the only institution currently using it — but it leaves the provenance in the
// wrong place: they are Northeastern measurements sitting in an institution-agnostic core.
//
// So this is where they are OWNED. Passing them explicitly means the engine's copy is a
// fallback rather than the truth, and a second institution writes its own file here instead
// of editing the core. That is the difference between a default and an assumption.
//
// ── Every number is a measurement, with its sample ──────────────────
//
// Nothing here is chosen for tidiness, and the sample sizes are in
// `src/engine/calibration.js`'s typedef so a reader can judge each one. Four of them are
// re-derived from the shipped plans by `test/invariant/sequencing-calibration.test.js`, which
// fails if the corpus has moved — the same rolling-derivation discipline the term windows
// use, and for the same reason: this data is re-scraped monthly.
//
// The one value that is a JUDGEMENT rather than a median is `poolReachMin`, and it is the p10
// on purpose. Departments place an elective pool once a mean of 0.92 of it is reachable
// (median 1.00); using the median would forbid placing a major elective until its last
// prerequisite is complete, which puts every one of them in the final year. The p10 lets them
// come early while still meaning something.
// ═══════════════════════════════════════════════════════════════════

/** @type {import("../../engine/calibration.js").Calibration} */
export default {
  // 3,941 published undergraduate full terms: 54.8% hold exactly four courses of >= 3 SH,
  // 95.8% hold four or more. Credits per full term are p10 16, median 17, p90 18 —
  // consistent with four courses of four.
  fullTermMinCourses: 4,
  // ZERO, and this is a finding rather than an absent value. 329 published GRADUATE full
  // terms do not cluster: 39% carry zero or one course, only 16.4% carry four, and the
  // median is 2 against the undergraduate 4. A master's 16 SH cap makes four 4 SH courses
  // its entire envelope. Two would cover 54.4%, which is not a convention.
  graduateFullTermMinCourses: 0,
  // Median 2 in the published Summer A / Summer B halves.
  halfTermCourses: 2,
  // A one-credit lab and a course are not two courses. The corpus bar is explicitly four of
  // >= 3 SH (95.8%), against 97.7% for four cells of any size; the gap is terms padded with
  // small labs.
  realCourseSH: 3,

  // 16.3% of published terms carry two cells of one requirement; departments hold three or
  // more in 0.7% of terms, against CHART's 14.3% before this was enforced.
  sameRequirementPerTerm: 2,
  // The extreme the corpus actually reaches, for both general electives (p90 4, max 6) and
  // same-requirement stacks (max 4, one term in 988).
  sameRequirementPerTermMax: 4,

  // 742 major-subject pools: mean 0.92 of the pool is prereq-reachable where the department
  // places it, median 1.00, p10 0.69. Even for pools of 40+ candidates the p10 is 0.79.
  poolReachMin: 0.69,

  // 12,848 placements across 661 published plans. Pearson r = 0.809 between level and
  // position — the strongest relationship in the corpus, monotone at every step. MEDIANS:
  // the means are 0.10 / 0.36 / 0.61 / 0.88, and using them pushed first-year courses out of
  // term one, because a distribution bounded at zero has a mean above its median.
  levelPosition: { 1: 0.00, 2: 0.36, 3: 0.64, 4: 0.91 },
  // The p10 — the earliest a real plan has ever put a course of each level. Stands in for
  // class standing, which the catalog states only in prose and `RESTRICTION_ONLY` discards.
  levelFloor: { 1: 0.00, 2: 0.09, 3: 0.22, 4: 0.67, 5: 0.57 },
  // SIX, not five. 5000-level courses are genuinely open to Northeastern undergraduates and
  // combined BS/MS degrees are built on that; 6000 and above is doctoral. Measured, 178
  // cells across 92 of 529 undergraduate programs had pools admitting 6000+ courses — median
  // 39% of the pool, and one cell where it was 100%.
  graduateOnlyLevel: 6,
  // Measured p10 is 0.00 at every graduate level: a master's has no low-to-high ladder to
  // imitate, and clamping graduate courses to the undergraduate 4000-level target barred
  // every 5000-level course from the first two-thirds of the degree.
  graduateLevelTarget: 0.0,

  // ── The capstone, which the registrar designates and the corpus confirms ──
  //
  // NUPath's "Capstone Experience" is a real designation carried on 161 courses, so this is an
  // institutional fact rather than a heuristic about titles. Measured over the 23 of them the
  // published plans place, it is the sharpest positional signal in the whole attribute set:
  //
  //     code   median position   p10    p90
  //     CE         1.000        0.85   1.00      <- capstone
  //     WI         0.692        0.08   1.00
  //     EI         0.308        0.00   1.00
  //     ALL        0.308        0.00   0.86
  //
  // Nine in ten capstone placements sit in the last 15% of a plan; every other code is
  // scattered across the whole range. `capstoneFloor` is that p10, used the same way
  // `levelFloor` is — the earliest a real plan has ever put one — and never as a target.
  capstoneAttribute: "CE",
  capstoneFloor: 0.85,

  // The worst any published plan does — 9 courses in a full term, 5 in a summer half, across
  // both corpora. The observed MAXIMUM rather than the p90 of 6, because a seven-course term
  // is unusual and real while an eleven-course one is not.
  slotCapFull: 9,
  slotCapHalf: 5,
};

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

  // ── Designations that carry a POSITIONAL convention, as data ───────
  //
  // Read by `src/engine/attributePlacement.js`, which runs after every hard constraint, every
  // ranked objective and the threshold repair have settled. The engine knows the rule GRAMMAR
  // (`notBefore`, `swapWith`, both closed vocabularies); the codes and the reasons live here,
  // because they are facts about Northeastern's curriculum and not about planning.
  //
  // Adding a designation is a line in this array. That is the point: the engine used to carry
  // exactly one of these as a hard-coded field pair (`capstoneAttribute` / `capstoneFloor`, still
  // read by `settleCapstones`), which is fine for one and duplicates a swap loop for two.
  attributePlacement: [
    // ── `WD` — advanced writing belongs after a co-op ────────────────
    //
    // NUPath competency 9 is awarded as three codes — `WF` first-year writing, `WD` writing in
    // the disciplines, `WI` writing-intensive — and only `WD` is the advanced writing requirement
    // a student meets once, late. It is carried by exactly **16 courses** across 6 subjects
    // (ENGW 10, ENG 2, COMM/HIST/JRNL/THTR 1 each), all 2000- and 3000-level, so it identifies
    // the requirement precisely where a title match would not: `ENGW 1111` carries `WF`.
    //
    // The reason it goes after employment is a fact about the course, not a corpus artefact: it
    // is the writing course taken *while on co-op*, about the work. Before the first co-op it is
    // usually legal — its real gate is junior standing, which the plan may satisfy — and
    // backwards, because there is nothing to write about yet. `domains.js` records the same
    // convention from the other side: in 30 of 33 strictly-coded mixed terms, the course sharing
    // a term with employment is an advanced writing course. The departments agree — of the
    // programs that place them, 45 put `ENGW 3315` at 0.727 through the plan and 25 put
    // `ENGW 3302` at 0.778, after the co-op in every co-op program.
    //
    // MEASURED on `computer_science_and_physics`: `ENGW 3302 or 3307 or 3315` landed in Year 2
    // Spring, study term 5 of 9, with the first co-op starting that summer. `reclaimFromFiller`
    // would refuse to *pull* it there — it reads those same positions as a floor — but the search
    // placed it there and nothing removed it, because every other swap in `objective.js` moves
    // cells for a different reason.
    //
    // `swapWith: generalElective` and nothing else. The general form of this rule — "any cell
    // earlier than its corpus position gets pushed back" — was built and measured, and it is
    // worse: it fires on dozens of cells per plan, and since a swap moves two things it pays for
    // each push by dragging something else forward. On this program it shoved `PHYS 3602`
    // (departments 0.636) and `CS 4530` into the final term and pulled three general electives
    // back to terms 4 and 5, which is precisely what `reclaimFromFiller` exists to undo.
    { attribute: "WD", notBefore: "firstWork", swapWith: "generalElective" },
  ],

  // ── The first-year seminar: the sharpest positional signal here ──────
  //
  // 31 courses, one per college, all 1 SH, all titled "<Subject> at Northeastern". Where the
  // published plans put them: Year 1 Fall 418 (99.3%), Year 1 Spring 2, Year 2 Spring 1.
  // Sharper than the capstone and than any level target, and the only one of the three with a
  // registrar behind it — ANTH/ARCH/ARTF/BIOL 1000 and others carry a Banner `FR` gate, so a
  // late placement is unregistrable rather than merely odd.
  //
  // CHART placed it first in 126 of 134 programs (94.0%) before this rule; the misses included
  // Mathematics and Physics BS, which parked INSC 1000 in Year 1 Spring behind a published
  // plan that never printed the course at all.
  firstYearSeminarTitle: / at Northeastern\b/i,

  // ── Co-op prep: no later than sophomore fall ─────────────────────────
  //
  // A deadline, and the only value in this file that is a JUDGEMENT rather than a measured
  // central tendency — so it is marked as one. Departments publish these at Year 2 Spring
  // 41.6%, Year 2 Fall 35.7%, Year 1 Spring 20.8%, Year 3 Fall 1.6% (485 placements), so
  // sophomore year is a 77.3% convention and not a rule. Nothing enforces even that: EESC,
  // EEAM and SLPA 2000 carry no prerequisite and no standing gate, so Year 1 Fall is legal.
  // ENCP 2000 is the exception and needs no help — its prerequisite IS the seminar family
  // above, so the prerequisite graph already bars it from term 0.
  //
  // A bound rather than a slot because the requirement is purely relational: any term before
  // the work term satisfies it, `coopBoundary` already enforces that, and the only real risk
  // is leaving it too late — the failure co-op advisors report students regretting. Pinning
  // would additionally have fought the 62.4% who publish somewhere other than sophomore fall.
  // The 43.5% who publish later than this bound keep their own arrangement, via
  // `departmentPlaced`.
  coopPrepBy: { yearIndex: 1, semTypeId: "fall" },

  // The worst any published plan does — 9 courses in a full term, 5 in a summer half, across
  // both corpora. The observed MAXIMUM rather than the p90 of 6, because a seven-course term
  // is unusual and real while an eleven-course one is not.
  slotCapFull: 9,
  slotCapHalf: 5,
};

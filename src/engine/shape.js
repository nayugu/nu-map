// ═══════════════════════════════════════════════════════════════════
// CHART · SHAPE — the skeleton a generated plan is poured into
//
// A published plan encodes two different things, and only one of them is
// defective. The SHAPE — how many years, which terms are used, where the co-ops
// fall, roughly how loaded each term is — is real departmental intent, checked by
// advisors and recognisable to them. The CONTENT and its ORDER are what testing
// found wanting: general electives spent before the first co-op, prereq chains
// with real errors, courses scheduled in seasons they are not offered.
//
// So CHART inherits the skeleton and regenerates what goes in it. Far less risky
// than inventing a calendar, and the result stays legible to an advisor.
//
// ── Shape means exactly four things ────────────────────────────────
//
//   1. which terms exist and in what order
//   2. which of them the plan USES, and of those which are WORK terms
//   3. a per-term credit TARGET — soft, because whole cells rarely hit a number
//   4. the variant's label, since the UI keys display on `pattern`
//
// It does NOT include per-term cell counts or per-term content. Inheriting those
// would re-import the very sequencing this engine exists to replace, so the type
// simply cannot express them.
//
// ── Three kinds of term, not two ───────────────────────────────────
//
// A term can be a study term, a work term, or UNUSED — a summer the department
// deliberately left empty. Collapsing the third into the first is not a rounding
// error: the first plan this engine generated scheduled 8 SH into a Summer 2 the
// catalog prints as vacation, because "no co-op cells" was being read as "study
// term". A published shape saying a term is empty is departmental intent, the
// same kind of intent as where the co-ops fall, and CHART inherits it.
//
// ── Accepted consequence ───────────────────────────────────────────
//
// CHART cannot move a first co-op that is scheduled too early; it fixes what
// PRECEDES the co-op, which is the reported complaint. Shape overrides (move a
// co-op, add a summer, extend to five years) are deferred — but shape is an
// explicit INPUT from the start, so adding them later is a new caller rather
// than a rewrite.
//
// ── 385 programs publish a plan; 1,014 have requirements ───────────
//
// So a default skeleton is not an edge case, it is the majority path, and it has
// to be derived rather than guessed: term count from the degree's own credit
// total, at a load the credit envelope allows.
// ═══════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ShapeTerm
 * @property {string} semTypeId   "fall" | "spring" | "sumA" | "sumB"
 * @property {number} yearIndex   0-based academic year
 * @property {string} label       the year label the source plan used
 * @property {string} termLabel   the term label the source plan used
 * @property {boolean} work       a co-op term: no course credit, no cells
 * @property {boolean} unused     the plan leaves it empty — vacation, not study
 * @property {number} targetSH    soft target, 0 for a work or unused term
 * @property {number} weight      1.0 full term, 0.5 summer half
 */

/**
 * @typedef {Object} Shape
 * @property {string} pattern     variant label, e.g. "Four Years, Two Co-ops…"
 * @property {ShapeTerm[]} terms  in plan order, work terms included
 * @property {"published"|"derived"} source
 */

import { DEFAULT_CALIBRATION, minCoursesFor } from "./calibration.js";

/** NU's calendar, as the default skeleton uses it. Injectable via `semTypes`. */
const DEFAULT_SEM_TYPES = [
  { semTypeId: "fall",   termLabel: "Fall",     weight: 1.0 },
  { semTypeId: "spring", termLabel: "Spring",   weight: 1.0 },
  { semTypeId: "sumA",   termLabel: "Summer 1", weight: 0.5 },
  { semTypeId: "sumB",   termLabel: "Summer 2", weight: 0.5 },
];

/**
 * Read the shape out of one published plan variant.
 *
 * Credit targets come from the plan's own `hours` where it states them, because
 * that is the department saying how loaded it intends each term to be. Where it
 * does not, the cells' own credit is summed — the same number by a longer route.
 *
 * A term whose entries are ALL co-op is a work term. Mixed terms exist (a co-op
 * cell beside a course cell) and are treated as study terms carrying a co-op,
 * because the student is registered for the course either way.
 *
 * @param {object} plan  one entry of plan.json `plans[]`
 * @returns {Shape}
 */
export function shapeFromPlan(plan) {
  const terms = [];
  (plan?.years ?? []).forEach((year, yearIndex) => {
    // A hole in the array, or a term that is not an object. No shipped plan has one,
    // and a crash here would refuse the whole program over a single bad row — the
    // same reasoning as the guards in `allocateNode`.
    for (const term of (year?.terms ?? [])) {
      if (!term || typeof term !== "object") continue;
      const entries = flatten(term.entries);
      const coopCells = entries.filter(e => e.coop).length;
      // A heading, a vacation row and an `either` wrapper are labels, not work.
      const courseCells = entries.filter(e =>
        !e.coop && !e.vacation && !e.heading && !e.either).length;
      // Mixed terms exist — a co-op cell beside a course cell — and are study
      // terms carrying a co-op, because the student is registered either way.
      //
      // ── But they are not study terms of the usual SIZE ────────────
      //
      // That reasoning is right about whether the term is used and wrong about how
      // much it can hold. `work` was the only co-op signal the shape carried, so a
      // term with a co-op and a course fell through as an ordinary study term and was
      // sized at the full-time cap — and CHART put a full course load into terms the
      // student spends employed.
      //
      // So `coop` is recorded independently of `work`. A term can be all three of
      // used, studied in, and constrained by employment, and one boolean could not
      // say that. The BOUND itself lives in `domains.termSlotCap`, as a course count
      // rather than a credit budget — see there for the measured convention (90 mixed
      // terms across 42 programs, targetSH {3:2, 4:86, 16:2}) and for the corrected
      // figures, since the first version of this comment claimed "exactly 1.00 real
      // courses, no variance at all" and that was false in both halves.
      const work = coopCells > 0 && courseCells === 0;
      const unused = !work && courseCells === 0;
      const stated = Number(term.hours);
      const summed = entries.reduce((n, e) => n + (Number(e.sh) || 0), 0);
      terms.push({
        semTypeId: term.type ?? "",
        yearIndex,
        label: year.label ?? `Year ${yearIndex + 1}`,
        termLabel: term.term ?? "",
        work, unused,
        // Carries a co-op, whether or not it also carries courses. `work` answers "is
        // this term used for study"; this answers "is the student employed in it".
        coop: coopCells > 0,
        targetSH: (work || unused) ? 0 : (Number.isFinite(stated) && stated > 0 ? stated : summed),
        weight: weightOf(term.type),
      });
    }
  });
  // ── The plan's own worst term, as a ceiling CHART may not exceed ──
  //
  // A corpus-wide cap of 9 courses keeps CHART inside what SOME department does. It
  // does not keep it inside what THIS department does, and measured per program CHART
  // packed a term harder than the program's own plan in 27 cases. "Never worse than
  // the plan we inherited from" is the stronger and the right bar.
  //
  // Recorded per term weight, because a full term and a summer half are different
  // questions and one number for both would either free the half or strangle the full.
  const coursesIn = (term) => flatten(term.entries)
    .filter(e => !e.coop && !e.vacation && !e.heading && !e.either)
    .reduce((n, e) => n + Math.max(1, e.options?.[0]?.length ?? 1), 0);
  const perWeight = (want) => {
    const counts = (plan?.years ?? []).flatMap(y => (y?.terms ?? [])
      .filter(t => t && typeof t === "object" && (weightOf(t.type) >= 1) === want)
      .map(coursesIn));
    const max = Math.max(0, ...counts);
    return max > 0 ? max : null;
  };
  return {
    pattern: plan?.label ?? "", terms, source: "published",
    maxCoursesFull: perWeight(true),
    maxCoursesHalf: perWeight(false),
  };
}

/** Every entry, co-op and vacation rows included, with nesting flattened. */
function flatten(entries) {
  const out = [];
  const walk = (list) => {
    for (const e of list ?? []) { out.push(e); walk(e.children); }
  };
  walk(entries);
  return out;
}

/** A summer half is half a term. Anything unrecognised is a full term. */
const weightOf = (semTypeId) =>
  (semTypeId === "sumA" || semTypeId === "sumB") ? 0.5 : 1.0;

/**
 * A skeleton for a program that publishes no plan — the majority.
 *
 * Derived, not guessed: enough fall/spring terms to carry the degree's credit at
 * a load the envelope allows, then summers added only if fall and spring alone
 * cannot hold it. Summers are a last resort because a plan that fills them when
 * it does not have to has spent the student's co-op and earning time for nothing.
 *
 * @param {object} opts
 * @param {number} opts.totalSH       credit the plan must carry
 * @param {number} [opts.maxTermSH]   registration cap for a full term
 * @param {number} [opts.targetTermSH] the load to aim for
 * @param {number} [opts.maxYears]
 * @param {object[]} [opts.semTypes]
 * @returns {Shape}
 */
export function defaultShape({
  totalSH, maxTermSH = 19, targetTermSH = 16, maxYears = 5,
  semTypes = DEFAULT_SEM_TYPES,
} = {}) {
  const full = semTypes.filter(s => s.weight >= 1);
  const halves = semTypes.filter(s => s.weight < 1);
  const need = Math.max(0, Number(totalSH) || 0);
  // Aim for the target rather than the cap: a plan generated at 19 SH every term
  // leaves the student no room to drop a course, and `protect slack` is a
  // threshold this design keeps.
  const perYearFull = full.length * Math.min(maxTermSH, targetTermSH);

  let years = Math.min(maxYears, Math.max(1, Math.ceil(need / (perYearFull || 1))));
  const terms = [];
  const push = (t, yearIndex, targetSH) => terms.push({
    semTypeId: t.semTypeId, yearIndex,
    label: `Year ${yearIndex + 1}`, termLabel: t.termLabel,
    work: false, unused: false, targetSH, weight: t.weight,
  });

  // Spread the load evenly rather than filling terms to the cap and leaving the
  // last one nearly empty — `load balance` is a stated objective, and starting
  // from a lopsided skeleton would make it unreachable.
  const fullSlots = years * full.length;
  let perTerm = fullSlots ? Math.ceil(need / fullSlots) : 0;
  const useSummer = perTerm > Math.min(maxTermSH, targetTermSH) && halves.length && years <= maxYears;
  const summerSlots = useSummer ? years * halves.length : 0;
  const weighted = fullSlots + summerSlots * 0.5;
  perTerm = weighted ? need / weighted : 0;

  for (let y = 0; y < years; y++) {
    for (const t of full) push(t, y, Math.min(maxTermSH, Math.round(perTerm)));
    if (useSummer) for (const t of halves) push(t, y, Math.round(perTerm * t.weight));
  }
  return { pattern: "", terms, source: "derived" };
}

// ── Reading a shape ────────────────────────────────────────────────

/**
 * The terms cells may be placed in, in order.
 *
 * Work terms are excluded outright: they carry no course credit and the student is
 * not enrolled.
 *
 * UNUSED terms — the summers a published plan leaves empty — are included but marked
 * `optional`, and the search tries them last. That is a deliberate ranking of two
 * inheritances against each other:
 *
 *   which terms this degree occupies   the department's intent. Soft. It is a
 *                                      convention about how a plan is usually spread.
 *   when a course is actually offered   a fact about the world. Hard.
 *
 * Availability used to lose that contest. A cell whose every candidate is barred from
 * every term the plan uses had the availability constraint RELAXED and was placed
 * anyway — 3 season violations that the published plans, for those two programs, did
 * not have. Scheduling a course in a season it has never run in is the exact defect
 * this engine exists to fix, so it cannot be the thing that gives way.
 *
 * Using a summer the department left blank is a much smaller liberty, and one a
 * student can act on: the report names which optional terms a plan needed.
 */
/**
 * And a HALF term is optional whenever the full terms can absorb the degree.
 *
 * ── Why this belongs in the shape and not in the search ─────────────
 *
 * Every full fall and spring carrying four real courses is not a preference; it is how a
 * degree is built. MEASURED over 3,941 published full terms, 97.7% carry four cells or
 * more and 95.8% carry four of at least 3 SH, and the credit total is designed so that
 * four courses a term across the full terms arrives at the degree.
 *
 * CHART broke it in 13.0% of full terms, always the same way: a course parked in a
 * half-summer while a fall ran three deep. Two fixes were tried at the wrong layer and
 * both were the wrong shape for the rule.
 *
 *   a THRESHOLD with a repair   satisficing, applied after the fact. Cut the failures
 *                              from 13.0% to 7.0% and left a visible gap in year 1,
 *                              because a repair can only move what still has somewhere
 *                              to go.
 *   a PLACEMENT preference     steering the search toward thin terms mid-flight. It
 *                              changes which branch is explored and the search reaches
 *                              its budget in a worse region.
 *
 * The rule is arithmetic, so it belongs where the arithmetic is: a half-summer exists to
 * take the SURPLUS, and there is no surplus until every full term has its four. Marking
 * the halves optional says exactly that, and `byOptional` is the FIRST rank in every
 * branch of the term ordering — so it outranks level targets, load balance and the
 * elective reserve, which is what a hard requirement should do.
 *
 * ── It still yields, and that is deliberate ────────────────────────
 *
 * `optional` means tried last, not forbidden. A degree whose courses genuinely do not fit
 * in its full terms still gets a plan that uses the summers, and the report names them.
 * The alternative — forbidding it — would refuse programs over a rule that their own
 * credit total makes impossible, and architecture, where one studio course is 16 credits,
 * is 4.2% of the published corpus.
 *
 * The surplus is counted in COURSES of at least 3 SH, not credits and not cells: a
 * one-credit lab riding along with a course is not a course, which is the same line the
 * corpus bar draws.
 */
export function studyTerms(shape, studentType = "undergraduate", cal = DEFAULT_CALIBRATION) {
  // ── Only a term the DEPARTMENT left empty is a last resort ────────
  //
  // A surplus rule used to live here: count the real courses, subtract four per full term,
  // and mark every half-summer past that surplus `optional` so the falls would fill first.
  // The arithmetic was right and the conclusion was wrong, and it cost coverage in a way
  // that took three failed hypotheses to find.
  //
  // `optional` is the FIRST rank in every branch of the term ordering — it has to be, since
  // it exists to stop CHART using a summer the department deliberately left blank. So
  // marking a summer optional does not gently deprioritise it; it forces the search to
  // exhaust every arrangement that avoids it first. On an exactly-tight degree that is
  // combinatorially prohibitive.
  //
  // Architecture BS is the case that proved it. 32 real courses, 7 full terms, 5 half terms:
  // 7x4 + 2x2 = 32, exactly tight, so the surplus rule marked 3 of the 5 summers optional —
  // and its studio courses are 8-16 SH, so a term holding one cannot reach four courses
  // inside the 19 SH cap at all. It refused. Measured, with the four-course bar still ON and
  // only this marking removed, it generates.
  //
  // The deeper error: our surplus arithmetic is a heuristic, and the department's own plan is
  // EVIDENCE. A summer the department uses is one it means to use, whatever our count says
  // about whether it is needed. Only a summer left empty carries the opposite evidence, and
  // that is the only one demoted here.
  //
  // ── But removing it outright cost more than it saved ──────────────
  //
  // Measured both ways. Dropping the surplus rule entirely fixed Architecture and improved
  // thin full terms from 2.6% to 0.7% — and coverage on the same sample fell from 85 programs
  // to 68. The marking was doing two jobs: a fatal constraint on an exactly-tight degree, and
  // a genuinely valuable SEARCH HEURISTIC everywhere else, because trying the falls before the
  // summers is usually right and prunes hard.
  //
  // So it stays, with a margin. The arithmetic assumes every full term can hold four courses,
  // and that assumption is what fails: Architecture's 16 SH studios mean a term holding one
  // cannot reach four inside the 19 SH cap, so the real plan needs MORE summers than the count
  // predicts. A margin of two half-terms covers that gap without giving up the pruning — and
  // the same experiment that found the problem confirms the fix, since Architecture generates
  // as soon as the demoted set shrinks.
  //
  // The four-course rule does not depend on any of this: it is enforced by the cardinality
  // propagator in the search and repaired by `fillFullTerms`, both of which act on where cells
  // actually land rather than on which terms are permitted.
  const terms = (shape?.terms ?? []).filter(t => !t.work);
  const fullCount = terms.filter(t => (t.weight ?? 1) >= 1 && !t.unused).length;
  const minCourses = minCoursesFor(cal, studentType);
  if (minCourses <= 0) return terms.map(t => (t.unused ? { ...t, optional: true } : t));

  const surplus = (shape?.realCourses ?? 0) - fullCount * minCourses;
  const halvesNeeded = surplus > 0
    ? Math.ceil(surplus / cal.halfTermCourses) + OPTIONAL_HALF_MARGIN
    : Infinity;   // the bar is unsatisfiable here, so the degree needs every term it has

  let halvesUsed = 0;
  return terms.map((t) => {
    if (t.unused) return { ...t, optional: true };
    if ((t.weight ?? 1) >= 1) return t;
    // Earliest first, because the department's own ordering is the only prior available for
    // WHICH summer a degree leans on.
    if (halvesUsed < halvesNeeded) { halvesUsed += 1; return t; }
    return { ...t, optional: true };
  });
}

/**
 * Extra half-terms kept as real beyond what the surplus arithmetic asks for.
 *
 * Two. The arithmetic assumes a full term can hold `fullTermMinCourses` courses, and a term
 * carrying a 16 SH studio cannot — so on those degrees the plan needs more summers than the
 * count predicts and demoting them refuses the program outright. Two is what the failing case
 * required; a larger margin gives back the pruning that makes this rule worth having.
 */
export const OPTIONAL_HALF_MARGIN = 2;

/**
 * Courses a half term holds. Half the full-term bar, which is what "half term" means and
 * what the published summers do — measured, 2 cells is the median for a Summer A or B.
 */
export const HALF_TERM_COURSES = 2;

/** Credit the shape intends to carry across all study terms. */
export function shapeCapacitySH(shape, { creditMax = () => Infinity, studentType = "undergraduate" } = {}) {
  let n = 0;
  for (const t of studyTerms(shape)) {
    // The cap scales with the term's weight: a summer half is not expected to
    // carry a full 16 SH, and treating it as though it could would let the
    // engine schedule a plan nobody can register for.
    n += Math.min(creditMax(studentType) * t.weight, Math.max(t.targetSH, 0) || Infinity);
  }
  return n;
}

/**
 * Where the first work term begins, as an index into `studyTerms`.
 *
 * The `coop-depth` objective needs a boundary: what counts as "before the first
 * co-op" is the set of study terms preceding it. Returns the study-term count
 * when the plan has no co-op, so the objective degrades to "the whole plan"
 * rather than dividing by zero.
 */
export function firstWorkBoundary(shape) {
  const terms = shape?.terms ?? [];
  let studied = 0;
  for (const t of terms) {
    if (t.work) return studied;
    studied++;
  }
  return studied;
}

/**
 * Add academic years to a shape.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * 16 programs refused with `prereq-chain-longer-than-plan`: a graduate certificate
 * whose department prints three terms, holding a chain of four courses that must be
 * taken in order. No arrangement fits, and refusing was the wrong answer — the
 * interesting fact is not "we cannot plan this" but **"this cannot be completed in
 * the terms the department publishes"**, which is a finding about the program.
 *
 * So the shape stretches and the report says by how much. It is the same ranking the
 * availability fix established: how long a degree takes is the department's
 * convention, and a prerequisite chain is a fact. The convention yields.
 *
 * The added years copy the LAST year's term pattern minus its co-ops, because that is
 * the calendar the program already uses and inventing a different one would be a
 * second guess. Targets come from the pattern too, so a stretched plan is loaded the
 * same way as any other.
 */
export function extendShape(shape, extraYears) {
  if (!(extraYears > 0) || !shape?.terms?.length) return shape;
  const lastYear = Math.max(...shape.terms.map(t => t.yearIndex));
  // The pattern to repeat: the final year's STUDY terms. A co-op is a decision about
  // this student's calendar, not a template — repeating one would invent a work term
  // nobody planned.
  const pattern = shape.terms.filter(t => t.yearIndex === lastYear && !t.work);
  if (!pattern.length) return shape;

  const added = [];
  for (let k = 1; k <= extraYears; k++) {
    const yearIndex = lastYear + k;
    for (const t of pattern) {
      added.push({
        ...t,
        yearIndex,
        label: `Year ${yearIndex + 1}`,
        work: false,
        // Same reasoning as `work`, and it has to be said separately: the spread above
        // copies every field of the pattern term, so a pattern year containing a co-op
        // would give every ADDED year one too — inventing employment nobody planned, and
        // (since a co-op term is slot-capped) silently shrinking the room the extension
        // exists to create.
        coop: false,
        // Not `unused`: an added term exists precisely to be used. Its target is the
        // pattern's, or the pattern's own weight-scaled share where that was empty.
        unused: false,
        targetSH: t.targetSH > 0 ? t.targetSH : Math.round(16 * (t.weight ?? 1)),
      });
    }
  }
  return { ...shape, terms: [...shape.terms, ...added], extendedBy: extraYears };
}

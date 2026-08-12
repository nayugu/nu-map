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
export function studyTerms(shape) {
  return (shape?.terms ?? [])
    .filter(t => !t.work)
    .map(t => (t.unused ? { ...t, optional: true } : t));
}

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
        // Not `unused`: an added term exists precisely to be used. Its target is the
        // pattern's, or the pattern's own weight-scaled share where that was empty.
        unused: false,
        targetSH: t.targetSH > 0 ? t.targetSH : Math.round(16 * (t.weight ?? 1)),
      });
    }
  }
  return { ...shape, terms: [...shape.terms, ...added], extendedBy: extraYears };
}

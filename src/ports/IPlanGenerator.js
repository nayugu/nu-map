// ═══════════════════════════════════════════════════════════════════
// PORT: IPlanGenerator
//
// Generating a Sample Plan of Study, as opposed to loading a published one.
//
// A separate port from IMajorRequirements on purpose. That port answers "what does
// this program require and what has this student satisfied" — a question about DATA.
// This one answers "what is a good order to take it in" — a question about JUDGEMENT,
// with its own confidence level, its own refusals and its own reasons. An institution
// can implement one without the other, and Northeastern's implementation of this one
// is CHART.
//
// ── The output is deliberately the same shape as a published plan ──
//
// `generate` returns a `plan.json` variant — the exact object `applySamplePlan`
// consumes and the same one `loadSamplePlans` yields. So the UI treats a generated
// plan as one more entry in the variant list, and every downstream consumer
// (reservations, candidates, the grid, PDF export, share links) needs no case for it.
//
// ── Refusal is a value, not an exception ───────────────────────────
//
// Roughly a quarter of programs cannot be planned from the data we have: a PhD whose
// requirements are "48 credits of dissertation", a program whose sections total more
// than its own degree, a chain nothing can satisfy. Those return a REFUSAL with a
// sentence a student can act on, because "no plan available, and here is why" is a
// real answer and a spinner that never resolves is not.
// ═══════════════════════════════════════════════════════════════════

/** Port key — use with wire() and usePort() */
export const IPlanGenerator = "planGenerator";

/**
 * @typedef {Object} GeneratedPlan
 * @property {object} plan     one `plan.json` variant: { label, pattern, years[] }
 * @property {PlanReport} report
 */

/**
 * @typedef {Object} PlanRefusal
 * @property {string} reason   a stable code, for tests and telemetry
 * @property {string} detail   one sentence a person can act on
 * @property {object} [data]
 */

/**
 * What the generator wants the student to know about what it did.
 *
 * Every field here is a STATEMENT ABOUT THIS PLAN that the grid cannot show on its
 * own, and each exists because leaving it out would let the plan imply something
 * untrue. They are not diagnostics for the developer.
 *
 * @typedef {Object} PlanReport
 * @property {number} cells                cards the plan contains
 * @property {number} cellsSH              credit it schedules
 * @property {number|null} totalCreditsRequired
 * @property {number} years                academic years it spans — the caller MUST
 *   supply a semester grid at least this long, or the last year is silently dropped
 * @property {number} studyTerms
 * @property {number} workTerms
 * @property {"published"|"derived"} shapeSource  whether the calendar was inherited
 * @property {number} extendedBy           years added because a prerequisite chain
 *   did not fit what the department publishes
 * @property {string[]} optionalTermsUsed  terms the published plan leaves empty that
 *   this plan needed, because a course runs only in that season
 * @property {object[]} warnings           discrepancies in the catalog itself
 * @property {object[]} unscheduledPrereqs courses whose prerequisites this plan does
 *   not schedule — the student may meet them by transfer, AP or an elective
 * @property {object[]} thresholds         soft bars this plan does not clear
 * @property {object[]} trades             what a ranked preference gave up, in units
 * @property {object} scores
 */

/**
 * @typedef {Object} IPlanGenerator
 *
 * @property {(programKey: string, isGrad: boolean) => boolean} canGenerate
 *   Cheap, synchronous, and allowed to be optimistic. It gates whether the CONTROL
 *   appears at all; `generate` decides whether a plan exists. Answering this
 *   accurately would mean doing the work, and a control that flickers away after
 *   appearing is worse than one that sometimes reports a refusal.
 *
 * @property {(args: {
 *   programKey: string, isGrad: boolean, programData: object,
 *   publishedPlan?: object|null, studentType?: string, preferences?: object,
 * }) => Promise<GeneratedPlan|{refused: PlanRefusal}>} generate
 *   `publishedPlan` supplies the SHAPE — how many years, which terms, where the
 *   co-ops fall. Absent, a skeleton is derived. Passing it is what keeps a generated
 *   plan recognisable to the advisor who wrote the published one.
 *
 * @property {() => object} defaultPreferences
 *   The ranked objectives and thresholds a plan is generated under, so the UI can
 *   show what it optimised for without knowing the engine's vocabulary.
 */

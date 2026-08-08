/**
 * plan-binding.js — the scrape-side entry point for requirement binding.
 *
 * The solver itself now lives in src/core/requirementBinding.js. It moved
 * because the RUNTIME needs it too: `applySamplePlan` records a requirement
 * only when the binding was forced, so an ambiguous card arrived knowing
 * nothing and offered the whole catalog. Recomputing at runtime costs no
 * storage, cannot go stale against the next scrape, and sharpens as the student
 * places courses — carrying the answer instead was measured at +54% on the
 * reservations payload.
 *
 * Nothing about the scrape changed. This file exists so `bind-plans.js` and its
 * tests keep one import path, and so the direction of dependency stays honest:
 * scripts import core, never the other way round.
 *
 * See src/core/requirementBinding.js for why binding is a flow problem, why
 * wording can only narrow, and why capacity is counted in cells.
 */

export {
  obligationsOf,
  bindCells,
  specAdmitsSubject,
  specAdmitsRange,
  specIsEmpty,
  courseEligible,
  assertShallowPools,
  GENERAL_ELECTIVE,
  CONCENTRATION,
} from "../../src/core/requirementBinding.js";

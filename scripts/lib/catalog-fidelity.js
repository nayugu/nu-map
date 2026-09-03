/**
 * catalog-fidelity.js — which fields a catalog edition actually publishes.
 *
 * Split out of catalog-course-parser.js, and the reason is a CI constraint
 * rather than tidiness: that module imports `node-html-parser`, and the unit
 * and invariant jobs in .github/workflows/test.yml run WITHOUT `npm ci`. Any
 * test that reached fidelity through the parser therefore pulled an
 * uninstalled package into a dependency-free job, where it fails as one
 * unnamed error at line 1:1 — caught by test-suite-deps, which is the guard
 * that exists for exactly this.
 *
 * Nothing here parses anything. It is a year comparison and a constant, and it
 * is consumed by `derive-retired-union.js` and by the Milestone A guards, so it
 * belongs where both can reach it without a parser.
 *
 * ── The distinction itself ──────────────────────────────────────────
 *
 * Measured 2026-09-03 across seven editions of /course-descriptions/cs/:
 *
 *   2016-2017 … 2020-2021   title + credits + description ONLY. Zero
 *                           `Prerequisite(s):` and zero `Attribute(s):` lines
 *                           exist on the page.
 *   2021-2022 … live        credits parenthesised, plus Prerequisite(s),
 *                           Corequisite(s) and Attribute(s).
 *
 * That boundary is load-bearing and must never be flattened. An empty
 * `prereqs` array on a record from a 2020 page means "this edition did not
 * publish prerequisites", NOT "this course has none" — the same difference as
 * `false` versus absent in term-history, and the same class of bug: a planner
 * that reads unpublished-as-none will schedule a course before the courses it
 * actually requires.
 */

/**
 * The first edition whose course pages publish prerequisites, corequisites and
 * NUPath attributes. Editions strictly below this are `descriptive` fidelity.
 *
 * Stored as the END year, matching the data/northeastern/programs/<year>/
 * convention: the 2021-2022 edition is 2022.
 */
export const FIRST_FULL_FIDELITY_EDITION = 2022;

/** `full` when an edition publishes prereqs/coreqs/NUPath, else `descriptive`. */
export function fidelityOfEdition(year) {
  if (!Number.isFinite(year)) return "full";           // live scrape declares no edition
  return year >= FIRST_FULL_FIDELITY_EDITION ? "full" : "descriptive";
}

/**
 * plan-hints.js — the scrape-side entry point for Northeastern's plan wording.
 *
 * The hints themselves now live in src/adapters/northeastern/planHints.js. They
 * moved because the RUNTIME needs them: binding is recomputed live so an
 * ambiguous card offers its real candidates instead of the whole catalog, and
 * that solve is only as decisive as the evidence it is given. The browser
 * cannot import from scripts/.
 *
 * Nothing about the scrape changed. This file keeps `bind-plans.js` and its
 * tests on one import path.
 */

export { createPlanHints } from "../../src/adapters/northeastern/planHints.js";

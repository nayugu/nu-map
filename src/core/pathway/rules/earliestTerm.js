// ═══════════════════════════════════════════════════════════════════
// RULE: earliestTerm — how early a graduate course may be placed.
//
// Khoury: "First-year students cannot take their first graduate-level course
// during the summer", so the earliest is the fall of the second year.
//
// ── STATED, NOT EVALUATED — and why that is the correct answer ─────
//
// This started as a computable rule comparing each share's term ORDINAL against
// a threshold from the pathway data (`afterTerms: 3`). Driving the real app
// proved that wrong, twice over:
//
//   1. Summer terms occupy ordinals. For a fall-2026 entrant the plan's terms
//      are incoming=0, fall2026=1, spr2027=2, sumA2027=3, sumB2027=4,
//      fall2027=5 — so "the fall of year two" is ordinal 5, and a threshold of
//      3 lands on sumA2027, permitting exactly the summer Khoury forbids.
//   2. The mapping is cohort-dependent. A spring entrant's ordinals differ, so
//      no single number is right for every plan, and NEU has plenty of spring
//      entrants.
//
// Fixing the number would still leave (2). Expressing the rule properly needs
// the term's SEASON and academic year, which is calendar knowledge that belongs
// to the ICalendar port, not to a pure core evaluator parsing "sumA2027" — so
// the honest fix is plumbing that does not exist yet.
//
// Until it does: state the rule and let the student check it. It cost a
// demonstrably false red flag ("1 graduate course(s) sit before term 3" on a
// perfectly legal plan) to learn this, which is the whole argument for the
// project's rule — degrade to less information, never to wrong information.
//
// The kind stays in the vocabulary, classified `informational`, so the rule is
// still visible and re-promoting it to computable later is a one-line change to
// ruleKinds.js once ctx carries term metadata.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";

/**
 * @param {{afterTerms?: number}} rule  retained for when this becomes computable
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function earliestTerm(rule, ctx) {
  return {
    status: STATUS.INFO,
    messageKey: "plusone.rule.earliest.stated",
    params: {},
    evidence: {
      afterTerms: Number.isFinite(Number(rule?.afterTerms)) ? Number(rule.afterTerms) : null,
      evaluated: false,
      reason: "term ordinals are cohort-dependent; needs calendar season/year, not an ordinal",
    },
  };
}

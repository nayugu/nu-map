// ═══════════════════════════════════════════════════════════════════
// RULE: earliestTerm — how early a graduate course may be placed.
//
// Khoury: "First-year students cannot take their first graduate-level course
// during the summer", so the earliest is the fall of the second year.
//
// ── Why this reads the plan's term ORDINAL, not a year label ───────
//
// A plan's timeline is built by core/semGrid.js from the cohort bounds, so the
// only durable way to say "the third term" is the term's position in SEMESTERS.
// `ctx.semIndex` is that map (semId → ordinal), which is the same structure
// planModel.js uses for every other timeline question. Anything derived from a
// year number breaks for a spring entrant, and NEU has plenty.
//
// ── The conservative direction ────────────────────────────────────
//
// When `semIndex` does not contain a share's term — which happens for a
// placement parked outside the current cohort window, a state the planner keeps
// deliberately — this returns UNKNOWN for that share rather than assuming it is
// early. A parked card is not evidence of anything, and inventing a violation
// from missing data is exactly what the safety classification exists to prevent.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";

/**
 * @param {{afterTerms?: number, notSummerOfYear1?: boolean}} rule
 *        afterTerms — a graduate course may not sit in a term whose ordinal is
 *        below this. Ordinals come from ctx.semIndex, which counts the plan's
 *        own terms including the "incoming" pseudo-term at 0.
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function earliestTerm(rule, ctx) {
  const min = Number(rule.afterTerms);
  const semIndex = ctx?.semIndex ?? null;

  if (!Number.isFinite(min) || !semIndex) {
    return {
      status: STATUS.UNKNOWN,
      messageKey: "plusone.rule.earliest.unknown",
      params: {},
      evidence: { afterTerms: Number.isFinite(min) ? min : null, haveSemIndex: !!semIndex },
    };
  }

  const early = [];
  const unplaced = [];
  for (const s of ctx.shares ?? []) {
    if (s.withdrawn || !s.semId) continue;
    const ord = semIndex[s.semId];
    if (ord == null) { unplaced.push(s.gradId); continue; }
    if (ord < min) early.push({ grad: s.gradId, semId: s.semId, ordinal: ord });
  }

  const evidence = { afterTerms: min, early, outsideTimeline: unplaced };

  if (early.length) {
    return {
      status: STATUS.VIOLATED,
      messageKey: "plusone.rule.earliest.tooEarly",
      params: { count: early.length, afterTerms: min },
      evidence,
    };
  }

  // Nothing early, but something we could not place: say so rather than pass.
  if (unplaced.length) {
    return {
      status: STATUS.UNKNOWN,
      messageKey: "plusone.rule.earliest.outsideTimeline",
      params: { count: unplaced.length },
      evidence,
    };
  }

  return {
    status: STATUS.SATISFIED,
    messageKey: "plusone.rule.earliest.ok",
    params: { afterTerms: min },
    evidence,
  };
}

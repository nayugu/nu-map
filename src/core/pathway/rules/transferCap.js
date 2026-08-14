// ═══════════════════════════════════════════════════════════════════
// RULE: transferCap — the SECOND 16 SH limit, and the 14 SH floor beneath it.
//
// Easy to conflate with `shareCap`, and conflating them was the bug: shareCap
// caps what may be SHARED with the bachelor's degree. This caps how much
// graduate credit taken as an undergraduate may ever transfer to the master's
// degree AT ALL — including a graduate course that fills no bachelor's
// requirement at all, because there was none left to fill.
//
// The COE FAQ, verbatim:
//
//   "Additional graduate coursework beyond 16 hours cannot transfer to MS,
//    even if not applied to BS."
//
// A student who takes 24 SH of graduate courses and shares only 12 of them
// with the bachelor's (legal under shareCap) still loses 8 SH here — the
// other 12 SH they took never transfers to the master's either, because 24
// is 8 over this cap.
//
// ── The floor, from the registrar (KB000020031) ────────────────────
//
//   "A minimum of 14 semester hours at the graduate level (after completion
//    of the undergraduate requirements) are required for the master's
//    degree."
//
// Sharing is bounded from BOTH ends. For a master's of `msTotalSH`, at most
// `msTotalSH - floorSH` may ever have been taken before the transition — so
// for anything smaller than a 30 SH master's, the floor binds BEFORE 16 SH
// does. Khoury's programs are all 32 SH, so the floor never binds for what
// ships today (32 - 14 = 18 > 16) — this still has to be computed, not
// assumed, because the next pathway added from _drafts/ may not be 32 SH.
//
// `msTotalSH` is the one input this rule needs that the engine does not
// already have lying around (see PathwayCtx in evaluate.js) — everything
// else is `ctx.gradCreditSH`, from shareSet.pathwayGradCreditSH.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";

const DEFAULTS = { maxSH: 16, floorSH: 14 };

/**
 * @param {{maxSH?: number, floorSH?: number}} rule
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function transferCap(rule, ctx) {
  const maxSH = Number.isFinite(rule.maxSH) ? rule.maxSH : DEFAULTS.maxSH;
  const floorSH = Number.isFinite(rule.floorSH) ? rule.floorSH : DEFAULTS.floorSH;

  const sh = Number(ctx?.gradCreditSH?.semesterHours) || 0;
  const msTotalSH = Number.isFinite(ctx?.msTotalSH) ? ctx.msTotalSH : null;

  // The floor only narrows the cap once the master's own total is known — an
  // unloaded master's degrades to the plain 16 SH limit rather than guessing.
  const floorCap = msTotalSH != null ? msTotalSH - floorSH : null;
  const effectiveCap = floorCap != null ? Math.min(maxSH, floorCap) : maxSH;

  const evidence = { sh, maxSH, floorSH, msTotalSH, floorCap, effectiveCap };
  const params = { sh, maxSH: effectiveCap };

  if (sh <= effectiveCap) {
    return { status: STATUS.SATISFIED, messageKey: "plusone.rule.transferCap.ok", params, evidence };
  }
  return { status: STATUS.VIOLATED, messageKey: "plusone.rule.transferCap.over", params, evidence };
}

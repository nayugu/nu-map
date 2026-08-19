// ═══════════════════════════════════════════════════════════════════
// CORE: creditLoad — is a term's load over the cap, under full time, or fine?
// ═══════════════════════════════════════════════════════════════════
//
// ── Why this is one function and not four ──────────────────────────
//
// Four surfaces draw the same fact and every one of them had its own rule:
//
//     SemRow            fall/spring   compared to the cap, red + ⚠
//     SummerRow         summer        hard-coded `--success`, NEVER compared
//     MiniPlanGrid      preview and the walkthrough, flat `--text-5`, never compared
//     plannerQueryAdapter  MCP        `sem.weight === 1 && sh > shMax`, so never for summer
//
// So a 30 SH summer was green in the planner, grey in the preview and clean over MCP, while
// a 20 SH fall was red in the planner and grey in the preview — the SAME plan reporting four
// different verdicts about the same term depending on which surface a student happened to be
// looking at. The judgement belongs in core, once.
//
// ── What this does NOT decide ──────────────────────────────────────
//
// Only the verdict, never the colour. The planner draws an ordinary term GREEN because the
// number is live and green means "keep going"; the preview and the walkthrough draw it in the
// quiet grey of a document, because forty coloured rows in a walkthrough is noise and the
// reader is there to watch one card move. Those are different presentations of one judgement,
// which is the thing that must not drift — so callers map the state to their own palette.
//
// ── Summer is judged as a WHOLE ────────────────────────────────────
//
// The caller passes the COMBINED load of both halves against the ordinary cap, not each half
// against a scaled one. Two 12 SH halves are 24 SH of summer and that is what a registrar
// would see; judging each half alone passed both.

/** Over the registration cap — needs an overload petition. */
export const LOAD_OVER  = "over";
/** Below the full-time minimum, in a term where full time is expected. */
export const LOAD_UNDER = "under";
/** Nothing to say about it. */
export const LOAD_OK    = "ok";

/**
 * Judge one term's credit load.
 *
 * @param {number} sh    credits placed in the term (for summer, both halves combined)
 * @param {object} opts
 * @param {number} [opts.cap]  the registration cap for this student type; over it is `over`
 * @param {number} [opts.min]  full-time minimum, or 0 where full time is not expected
 *                             (summer, and any special term — SemRow has always exempted
 *                             those, and an empty term is not a part-time term)
 * @returns {"over"|"under"|"ok"}
 */
export function loadState(sh, { cap = Infinity, min = 0 } = {}) {
  // ── Numbers only, and deliberately not coerced ─────────────────────
  //
  // `"20" > 19` is true in JS, so a string load would have produced a verdict off a caller
  // bug. A load we cannot read is a load we say nothing about: degrade to less information,
  // never to wrong information. `Number.isFinite` also takes out NaN, null and undefined,
  // which is how a port that returns nothing arrives here.
  if (!Number.isFinite(sh)) return LOAD_OK;
  // An empty term is not underloaded — it is unplanned, which the grid says by being empty.
  if (sh <= 0) return LOAD_OK;
  // Over the cap wins over under the minimum: they cannot both hold for a sane cap, but
  // stating the order makes it explicit rather than a property of how the branches happen to
  // be written. `Infinity` is the legitimate "no cap" and is not finite, hence the guard.
  if (Number.isFinite(cap) && sh > cap) return LOAD_OVER;
  if (Number.isFinite(min) && min > 0 && sh < min) return LOAD_UNDER;
  return LOAD_OK;
}

/** True where the load needs an overload petition. The `⚠` on every surface is this. */
export function isOverCap(sh, cap) {
  return loadState(sh, { cap }) === LOAD_OVER;
}

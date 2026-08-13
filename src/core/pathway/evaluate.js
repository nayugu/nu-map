// ═══════════════════════════════════════════════════════════════════
// PATHWAY RULE ENGINE — runs a pathway's rules, returns diagnostics.
//
// The engine NEVER switches on rule kind. It looks the kind up in the registry
// (rules/index.js) and calls it through one signature. That is the property the
// whole design exists to buy: docs/plusone-design.md §2 catalogued 73 published
// rules across seven colleges and is certainly still incomplete, so rule 74 has
// to be a new file plus a registry line — not an edit here.
//
// ── The safety invariant is enforced, not trusted ─────────────────
//
// Only a `computable` rule may report a failure. Rather than asking nineteen
// evaluators to each remember that, the engine downgrades any `violated` coming
// from an assertable / unknowable / informational kind to `unknown`. An
// evaluator would have to be actively wrong for this to fire, which is exactly
// when a guard is worth having: the cost of the bug is telling a student their
// degree plan is broken on the basis of a GPA we do not hold.
//
// In development the downgrade also throws, so the mistake surfaces in tests
// instead of being quietly absorbed in production. Same shape as the repo's
// other "conservative in prod, loud in dev" guards.
//
// ── Messages are keys, never text ─────────────────────────────────
//
// Every user-facing string in this project exists in all 8 locales, so core
// returns `{ messageKey, params }` and the UI translates. Core holds no English.
//
// Pure module: no React, no I/O.
// ═══════════════════════════════════════════════════════════════════

import { RULE_KINDS, STATUS, mayViolate, ruleClass } from "./ruleKinds.js";
import { EVALUATORS } from "./rules/index.js";

/**
 * @typedef {Object} Diagnostic
 * @property {string} kind        rule kind that produced it
 * @property {string} status      one of STATUS
 * @property {string} messageKey  locale key; the UI owns the words
 * @property {Object} [params]    interpolation params for the locale string
 * @property {Object} [evidence]  machine-readable detail, for tests and MCP
 * @property {string} [cls]       safety class, so the UI can group by certainty
 */

/**
 * @typedef {Object} PathwayCtx
 * @property {Object}   pathway
 * @property {Array}    shares      ActiveShare[] from shareSet.activeShares
 * @property {Array}    candidates  resolved candidate shares
 * @property {Object}   courseMap   plannerId → course
 * @property {Object}   placements  { placementKey: semId }
 * @property {Set}      [placedOut]
 * @property {Object}   [semIndex]  semId → ordinal, for sequencing rules
 * @property {Object}   [assertions] student-asserted facts; {} when unknown
 * @property {Object}   [totals]    shareSet.shareTotals output
 */

/** A diagnostic every unrecognised kind collapses to. Never a failure. */
function unrecognised(kind) {
  return {
    kind,
    status: STATUS.UNKNOWN,
    messageKey: "plusone.rule.unrecognised",
    params: { kind },
    evidence: { kind },
    cls: null,
  };
}

/**
 * Run one rule. Exported for tests that want a single evaluator in isolation.
 *
 * @param {Object} rule  { kind, ...params }
 * @param {PathwayCtx} ctx
 * @param {Object} [opts]
 * @param {boolean} [opts.strict]      throw on an invariant breach instead of downgrading
 * @param {Object}  [opts.evaluators]  registry override. Two callers want this:
 *        an adapter contributing institution-specific evaluators, and the test
 *        that proves the safety guard actually fires — which needs to hand the
 *        engine a deliberately misbehaving evaluator. Without the seam, that
 *        test can only re-implement the guard and assert its own copy, which
 *        proves nothing about this file.
 * @returns {Diagnostic}
 */
export function evaluateRule(rule, ctx, { strict = false, evaluators = EVALUATORS } = {}) {
  const kind = rule?.kind;
  if (!kind || !RULE_KINDS[kind]) return unrecognised(kind);

  const fn = evaluators[kind];
  // A kind in the vocabulary with no evaluator registered is a wiring mistake,
  // not a student's problem: report "cannot say" rather than crash a panel.
  if (typeof fn !== "function") return unrecognised(kind);

  let d;
  try {
    d = fn(rule, ctx);
  } catch (err) {
    // An evaluator that throws must not take the panel with it. One broken rule
    // degrades to "cannot say"; the rest of the pathway still reports.
    if (strict) throw err;
    return unrecognised(kind);
  }

  if (!d || typeof d !== "object") return unrecognised(kind);

  const cls = ruleClass(kind);
  const out = { ...d, kind, cls };

  // THE INVARIANT. See the header.
  if (out.status === STATUS.VIOLATED && !mayViolate(kind)) {
    if (strict) {
      throw new Error(
        `pathway rule "${kind}" is ${cls} and may never report "violated" ` +
        `(see src/core/pathway/ruleKinds.js). Return STATUS.UNKNOWN instead.`
      );
    }
    return { ...out, status: STATUS.UNKNOWN, evidence: { ...out.evidence, downgradedFrom: STATUS.VIOLATED } };
  }

  return out;
}

/**
 * Run every rule on a pathway.
 *
 * Order is the pathway's own, so a data author controls presentation order and
 * it stays stable across runs. Grouping by status or class is the UI's job.
 *
 * @param {PathwayCtx} ctx
 * @param {{strict?: boolean, evaluators?: Object}} [opts]
 * @returns {Diagnostic[]}
 */
export function evaluatePathway(ctx, opts = {}) {
  const rules = ctx?.pathway?.rules ?? [];
  return rules.map(rule => evaluateRule(rule, ctx, opts));
}

/**
 * Roll diagnostics up into the one thing a header needs to render.
 *
 * `violations` counts only what we actually checked and found wrong. `unknown`
 * is deliberately NOT folded into it: "we cannot tell" and "this is wrong" are
 * different facts, and blending them is how a planner starts lying.
 */
export function summarise(diagnostics = []) {
  const by = { satisfied: 0, violated: 0, unknown: 0, info: 0 };
  for (const d of diagnostics) {
    if (by[d.status] != null) by[d.status] += 1;
  }
  return {
    ...by,
    // Never blocks anything. The project flags and lets the student proceed —
    // same principle as the co-op GPA gate and every prereq violation.
    ok: by.violated === 0,
  };
}

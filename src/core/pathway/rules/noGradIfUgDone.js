// ═══════════════════════════════════════════════════════════════════
// RULE: noGradIfUgDone — mutual exclusion between the two levels.
//
// Khoury, verbatim and on every one of its pathway pages:
//
//   "A student may not take the graduate-level version of a course if they have
//    already completed the undergraduate version."
//
// This is the rule that makes the substitution arrow one-way in a strong sense.
// It is not merely that CS 3000 does not satisfy CS 5800 — taking CS 3000
// FORECLOSES sharing CS 5800 at all.
//
// ── Belt and braces, on purpose ───────────────────────────────────
//
// `shareSet.pathwaySubstitutions` already omits the pair when the undergraduate
// version is placed, so in the normal path the conflict cannot arise: the
// substitution simply is not offered. This evaluator exists for the case where
// the student places BOTH courses anyway — which they are free to do, since NU
// Map flags and never blocks. Then the plan holds a graduate course that cannot
// be shared, and the student needs to be told, because the credit they think is
// double-counting is not.
//
// So the two mechanisms answer different questions: shareSet decides what to
// OFFER, this decides what to SAY about what is actually placed. Collapsing them
// would mean either offering a forbidden swap or silently dropping a course the
// student can see in their plan.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";
import { displayCode, plannerId } from "../ids.js";
import { resolveCandidates, excludedIds } from "../shareSet.js";
import { baseId } from "../../repeatInstances.js";

function isPresent(id, placements, placedOut) {
  if (!id) return false;
  if (placedOut?.has?.(id)) return true;
  return Object.keys(placements ?? {}).some(pid => baseId(pid) === id);
}

/**
 * @param {{}} rule  no parameters
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function noGradIfUgDone(rule, ctx) {
  const { pathway, placements = {}, placedOut = new Set() } = ctx ?? {};
  const excluded = excludedIds(pathway);

  const conflicts = [];
  for (const { share, gradId, targetId } of resolveCandidates(pathway, { excluded })) {
    if (!gradId || !targetId) continue;
    if (!isPresent(gradId, placements, placedOut)) continue;
    if (!isPresent(targetId, placements, placedOut)) continue;
    conflicts.push({ grad: gradId, ug: targetId });
  }

  const evidence = { conflicts };

  if (!conflicts.length) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.exclusive.ok",
      params: {},
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.exclusive.conflict",
    params: {
      count: conflicts.length,
      pairs: conflicts.map(c => `${displayCode(c.grad)} / ${displayCode(c.ug)}`).join(", "),
    },
    evidence,
  };
}

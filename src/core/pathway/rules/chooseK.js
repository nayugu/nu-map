// ═══════════════════════════════════════════════════════════════════
// RULE: chooseK — how many OPTIONAL shares a pathway allows.
//
// Distinct from `shareCap`, which is the university's limit on shared credit.
// This is the pathway's own limit on how many rows of its table a student may
// pick, and it varies:
//
//   · Khoury BSCS → MSCS: four from the table.
//   · Khoury CE → MSCS:   CS 5010 (mandatory), CS 5800 (conditional), and then
//                         "choose two" from the replacements.
//
// ── A known ambiguity, deliberately not guessed ───────────────────
//
// For CE → MSCS the source does not say whether "choose two" is two IN ADDITION
// to the mandatory courses (total four, matching the university cap) or two
// INCLUDING them. Both readings are defensible from the page.
//
// docs/plusone-design.md §13.5 records this as an open question to put to an
// advisor. Until it is answered, `counts` says which reading the DATA asserts,
// and a pathway that has not decided sets `counts: "unknown"` — which makes this
// evaluator return UNKNOWN rather than pick a side. Guessing here would produce
// a confident number that is wrong half the time, which is the expensive failure
// this project is organised around.
// ═══════════════════════════════════════════════════════════════════

import { STATUS } from "../ruleKinds.js";
import { resolveCandidates, excludedIds } from "../shareSet.js";
import { plannerId } from "../ids.js";
import { baseId } from "../../repeatInstances.js";

function isPresent(id, placements, placedOut) {
  if (!id) return false;
  if (placedOut?.has?.(id)) return true;
  return Object.keys(placements ?? {}).some(pid => baseId(pid) === id);
}

/** Planner ids the pathway currently treats as mandatory, given the plan. */
function mandatoryIds(pathway, placements, placedOut) {
  const excluded = excludedIds(pathway);
  const out = new Set();
  for (const { share, gradId } of resolveCandidates(pathway, { excluded })) {
    if (!gradId) continue;
    if (share.mandatory) { out.add(gradId); continue; }
    const unless = share.mandatoryUnless?.completed;
    if (unless && !isPresent(plannerId(unless), placements, placedOut)) out.add(gradId);
  }
  return out;
}

/**
 * @param {{k: number, counts?: "optionalOnly"|"allShares"|"unknown"}} rule
 * @param {import("../evaluate.js").PathwayCtx} ctx
 */
export default function chooseK(rule, ctx) {
  const k = Number(rule.k);
  const counts = rule.counts ?? "optionalOnly";

  if (!Number.isFinite(k) || counts === "unknown") {
    return {
      status: STATUS.UNKNOWN,
      messageKey: "plusone.rule.chooseK.unknown",
      params: { k: Number.isFinite(k) ? k : null },
      evidence: { k: Number.isFinite(k) ? k : null, counts },
    };
  }

  const { pathway, placements = {}, placedOut = new Set(), shares = [] } = ctx ?? {};
  const mandatory = mandatoryIds(pathway, placements, placedOut);

  const active = shares.filter(s => !s.withdrawn);
  const chosen = counts === "allShares"
    ? active
    : active.filter(s => !mandatory.has(s.gradId));

  const evidence = {
    k, counts,
    chosen: chosen.map(s => s.gradId),
    mandatory: [...mandatory],
  };

  if (chosen.length <= k) {
    return {
      status: STATUS.SATISFIED,
      messageKey: "plusone.rule.chooseK.ok",
      params: { chosen: chosen.length, k },
      evidence,
    };
  }

  return {
    status: STATUS.VIOLATED,
    messageKey: "plusone.rule.chooseK.over",
    params: { chosen: chosen.length, k },
    evidence,
  };
}
